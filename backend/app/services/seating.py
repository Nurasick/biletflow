"""Assigned seating & predefined Kazakhstan venue layouts (§4.3.1, §7, §8 Bonus).

Provides an idempotent catalog loader for the predefined venue layout (Palace of
the Republic — Main Hall, Almaty), organizer configuration mapping price
categories to TicketTypes, live seat-map queries, and atomic seat-state
transitions (`available` -> `held` -> `sold`, and back to `available` on hold
expiry, cancellation, or refund).
"""

from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus, SeatingMode
from app.models.hold import Hold
from app.models.seat import EventSeat, EventSeatStatus
from app.models.ticket_type import TicketType
from app.models.user import User
from app.models.venue import Seat, Venue, VenueRow, VenueSection
from app.services import audit

PREDEFINED_VENUE_SLUG = "palace-of-republic-main-hall"

# Predefined Kazakhstan venue fixture (§8 Bonus: one predefined layout, no visual editor).
# 3 sections, 7 rows, 66 seats, 4 accessible seats, 3 price categories (VIP, Premium, Standard).
_PREDEFINED_LAYOUT = {
    "slug": PREDEFINED_VENUE_SLUG,
    "name": "Palace of the Republic — Main Hall",
    "city": "Almaty",
    "address": "Dostyk Ave 56, Almaty",
    "sections": [
        {
            "name": "VIP Parterre",
            "rows": [
                ("A", 8, "VIP", {1, 8}),
                ("B", 8, "VIP", set()),
            ],
        },
        {
            "name": "Main Parterre",
            "rows": [
                ("C", 10, "Premium", {1, 10}),
                ("D", 10, "Premium", set()),
                ("E", 10, "Premium", set()),
            ],
        },
        {
            "name": "Balcony",
            "rows": [
                ("F", 10, "Standard", set()),
                ("G", 10, "Standard", set()),
            ],
        },
    ],
}


class SeatingError(Exception):
    """Domain error for invalid seating configuration or seat transitions."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class VenueNotFound(Exception):
    pass


class EventSeatNotFound(Exception):
    pass


class SeatUnavailable(Exception):
    """The seat is already held, sold, or unavailable."""


class InvalidSeatSelection(Exception):
    """Seat does not belong to this event or does not match the ticket type."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def format_seat_label(
    section_name: str | None, row_label: str | None, seat_number: str | None
) -> str | None:
    if not (section_name and row_label and seat_number):
        return None
    return f"{section_name} · Row {row_label} · Seat {seat_number}"


def ensure_predefined_venues(db: Session) -> Venue:
    """Idempotently ensure the predefined Kazakhstan venue layout exists."""
    existing = db.scalar(select(Venue).where(Venue.slug == PREDEFINED_VENUE_SLUG))
    if existing is not None:
        return existing

    venue = Venue(
        slug=_PREDEFINED_LAYOUT["slug"],
        name=_PREDEFINED_LAYOUT["name"],
        city=_PREDEFINED_LAYOUT["city"],
        address=_PREDEFINED_LAYOUT["address"],
    )
    db.add(venue)
    db.flush()

    for sec_idx, sec_spec in enumerate(_PREDEFINED_LAYOUT["sections"]):
        section = VenueSection(
            venue_id=venue.id,
            name=sec_spec["name"],
            display_order=sec_idx,
        )
        db.add(section)
        db.flush()
        for row_idx, (row_name, count, price_category, accessible_numbers) in enumerate(
            sec_spec["rows"]
        ):
            row = VenueRow(
                venue_section_id=section.id,
                name=row_name,
                display_order=row_idx,
            )
            db.add(row)
            db.flush()
            db.add_all(
                Seat(
                    venue_row_id=row.id,
                    number=str(num),
                    is_accessible=num in accessible_numbers,
                    price_category=price_category,
                    display_order=num,
                )
                for num in range(1, count + 1)
            )
    db.flush()
    return venue


def list_venues(db: Session) -> list[dict]:
    """Return all predefined venue layouts with section and price-category summaries."""
    if db.scalar(select(Venue.id).limit(1)) is None:
        ensure_predefined_venues(db)
        db.commit()

    venues = db.scalars(select(Venue).order_by(Venue.id)).all()
    results = []
    for venue in venues:
        rows = db.execute(
            select(VenueSection, Seat)
            .join(VenueRow, VenueRow.venue_section_id == VenueSection.id)
            .join(Seat, Seat.venue_row_id == VenueRow.id)
            .where(VenueSection.venue_id == venue.id)
            .order_by(VenueSection.display_order, VenueRow.display_order, Seat.display_order)
        ).all()
        sections_map: dict[int, dict] = {}
        all_categories: set[str] = set()
        accessible_count = 0
        for section, seat in rows:
            all_categories.add(seat.price_category)
            if seat.is_accessible:
                accessible_count += 1
            entry = sections_map.setdefault(
                section.id,
                {
                    "id": section.id,
                    "name": section.name,
                    "display_order": section.display_order,
                    "seat_count": 0,
                    "categories": set(),
                },
            )
            entry["seat_count"] += 1
            entry["categories"].add(seat.price_category)
        results.append(
            {
                "id": venue.id,
                "slug": venue.slug,
                "name": venue.name,
                "city": venue.city,
                "address": venue.address,
                "total_seats": len(rows),
                "accessible_seats": accessible_count,
                "price_categories": sorted(all_categories),
                "sections": [
                    {
                        "id": sec["id"],
                        "name": sec["name"],
                        "display_order": sec["display_order"],
                        "seat_count": sec["seat_count"],
                        "price_categories": sorted(sec["categories"]),
                    }
                    for sec in sorted(sections_map.values(), key=lambda s: s["display_order"])
                ],
            }
        )
    return results


def configure_event_seating(
    db: Session,
    event: Event,
    *,
    venue_id: int,
    category_ticket_type_map: dict[str, int],
    unavailable_seat_ids: list[int],
    actor: User,
) -> dict:
    """Attach a predefined venue layout to an assigned-seating event and map
    price categories to ticket types."""
    if event.status in (EventStatus.CANCELLED, EventStatus.SUSPENDED):
        raise SeatingError(f"cannot configure seating for a {event.status.value} event")

    venue = db.get(Venue, venue_id)
    if venue is None:
        raise VenueNotFound

    # Refuse changing/rebuilding seats once tickets are already held or sold.
    has_committed = (
        db.scalar(
            select(EventSeat.id)
            .where(
                EventSeat.event_id == event.id,
                EventSeat.status.in_((EventSeatStatus.HELD, EventSeatStatus.SOLD)),
            )
            .limit(1)
        )
        is not None
    )
    if has_committed:
        raise SeatingError("cannot reconfigure venue layout after seats have been held or sold")

    ticket_type_ids = set(category_ticket_type_map.values())
    known_types = {
        tt.id: tt
        for tt in db.scalars(
            select(TicketType).where(
                TicketType.event_id == event.id, TicketType.id.in_(ticket_type_ids)
            )
        )
    }
    if set(known_types) != ticket_type_ids:
        raise SeatingError("all mapped ticket_type_id values must belong to this event")

    venue_seats = db.scalars(
        select(Seat)
        .join(VenueRow, VenueRow.id == Seat.venue_row_id)
        .join(VenueSection, VenueSection.id == VenueRow.venue_section_id)
        .where(VenueSection.venue_id == venue.id)
        .order_by(VenueSection.display_order, VenueRow.display_order, Seat.display_order)
    ).all()
    if not venue_seats:
        raise SeatingError("selected venue has no seats")

    unavailable_set = set(unavailable_seat_ids)
    missing_categories = {
        seat.price_category
        for seat in venue_seats
        if seat.id not in unavailable_set and seat.price_category not in category_ticket_type_map
    }
    if missing_categories:
        raise SeatingError(
            "missing ticket_type_id mapping for price categories: "
            + ", ".join(sorted(missing_categories))
        )

    # Clear existing uncommitted event_seats for this event and recreate cleanly.
    db.execute(delete(EventSeat).where(EventSeat.event_id == event.id))
    db.flush()

    per_type_counts: Counter[int] = Counter()
    for seat in venue_seats:
        is_unavail = seat.id in unavailable_set
        tt_id = None if is_unavail else category_ticket_type_map[seat.price_category]
        if tt_id is not None:
            per_type_counts[tt_id] += 1
        db.add(
            EventSeat(
                event_id=event.id,
                seat_id=seat.id,
                ticket_type_id=tt_id,
                status=EventSeatStatus.UNAVAILABLE if is_unavail else EventSeatStatus.AVAILABLE,
            )
        )

    # Sync mapped ticket types' quantity_total to match sellable seat counts.
    for tt_id, count in per_type_counts.items():
        tt = known_types[tt_id]
        committed = tt.quantity_sold + tt.quantity_reserved
        if count < committed:
            raise SeatingError(f"ticket type '{tt.name}' already has {committed} committed tickets")
        tt.quantity_total = count

    event.venue_id = venue.id
    event.seating_mode = SeatingMode.ASSIGNED
    event.venue_name = venue.name
    event.venue_city = venue.city
    event.venue_address = venue.address

    audit.record(
        db,
        action="event.seating_configured",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor=actor,
        summary=f"Assigned seating configured with venue '{venue.name}'",
        payload={
            "venue_id": venue.id,
            "sellable_seats": sum(per_type_counts.values()),
            "unavailable_seats": len(venue_seats) - sum(per_type_counts.values()),
        },
    )
    db.commit()
    return get_event_seat_map(db, event)


def update_event_seat(
    db: Session,
    event: Event,
    event_seat_id: int,
    *,
    status: EventSeatStatus,
    ticket_type_id: int | None,
    actor: User,
) -> dict:
    """Toggle an individual seat between `available` and `unavailable`."""
    if event.status in (EventStatus.CANCELLED, EventStatus.SUSPENDED):
        raise SeatingError(f"cannot edit seats for a {event.status.value} event")

    seat_row = db.scalar(
        select(EventSeat)
        .where(EventSeat.id == event_seat_id, EventSeat.event_id == event.id)
        .with_for_update()
    )
    if seat_row is None:
        raise EventSeatNotFound
    if seat_row.status in (EventSeatStatus.HELD, EventSeatStatus.SOLD):
        raise SeatingError(f"cannot modify a seat that is currently {seat_row.status.value}")

    old_status = seat_row.status
    old_tt_id = seat_row.ticket_type_id

    if status == EventSeatStatus.UNAVAILABLE:
        seat_row.status = EventSeatStatus.UNAVAILABLE
        seat_row.ticket_type_id = None
        if old_status == EventSeatStatus.AVAILABLE and old_tt_id is not None:
            old_tt = db.get(TicketType, old_tt_id)
            if old_tt is not None and old_tt.quantity_total > 1:
                old_tt.quantity_total -= 1
    else:
        target_tt_id = ticket_type_id or old_tt_id
        if target_tt_id is None:
            raise SeatingError("ticket_type_id is required when marking a seat available")
        tt = db.scalar(
            select(TicketType).where(TicketType.id == target_tt_id, TicketType.event_id == event.id)
        )
        if tt is None:
            raise SeatingError("ticket_type_id does not belong to this event")
        seat_row.status = EventSeatStatus.AVAILABLE
        seat_row.ticket_type_id = tt.id
        if old_status == EventSeatStatus.UNAVAILABLE:
            tt.quantity_total += 1
        elif old_tt_id is not None and old_tt_id != tt.id:
            old_tt = db.get(TicketType, old_tt_id)
            if old_tt is not None and old_tt.quantity_total > 1:
                old_tt.quantity_total -= 1
            tt.quantity_total += 1

    audit.record(
        db,
        action="event.seat_updated",
        entity_type="event_seat",
        entity_id=seat_row.id,
        event_id=event.id,
        actor=actor,
        summary=f"Seat #{seat_row.id} status set to {seat_row.status.value}",
        payload={"from": old_status.value, "to": seat_row.status.value},
    )
    db.commit()
    return get_event_seat_map(db, event)


def get_event_seat_map(db: Session, event: Event) -> dict:
    """Return the full live seat map for an event."""
    rows = db.execute(
        select(EventSeat, Seat, VenueRow, VenueSection, TicketType)
        .join(Seat, Seat.id == EventSeat.seat_id)
        .join(VenueRow, VenueRow.id == Seat.venue_row_id)
        .join(VenueSection, VenueSection.id == VenueRow.venue_section_id)
        .outerjoin(TicketType, TicketType.id == EventSeat.ticket_type_id)
        .where(EventSeat.event_id == event.id)
        .order_by(VenueSection.display_order, VenueRow.display_order, Seat.display_order)
    ).all()

    active_holds: dict[int, datetime] = {
        seat_id: exp
        for seat_id, exp in db.execute(
            select(Hold.event_seat_id, Hold.expires_at).where(
                Hold.event_seat_id.is_not(None),
                Hold.released_at.is_(None),
                Hold.event_seat_id.in_([es.id for es, *_ in rows]) if rows else False,
            )
        )
    }

    sections_dict: dict[int, dict] = {}
    rows_by_section: dict[int, dict[int, dict]] = defaultdict(dict)
    counts = Counter()

    for es, seat, vrow, vsec, tt in rows:
        status_val = es.status.value if isinstance(es.status, EventSeatStatus) else str(es.status)
        counts["total"] += 1
        counts[status_val] += 1
        if status_val != EventSeatStatus.UNAVAILABLE.value:
            counts["sellable"] += 1

        if vsec.id not in sections_dict:
            sections_dict[vsec.id] = {
                "section_id": vsec.id,
                "name": vsec.name,
                "display_order": vsec.display_order,
                "rows": [],
            }
        if vrow.id not in rows_by_section[vsec.id]:
            row_entry = {
                "row_id": vrow.id,
                "name": vrow.name,
                "display_order": vrow.display_order,
                "seats": [],
            }
            rows_by_section[vsec.id][vrow.id] = row_entry
            sections_dict[vsec.id]["rows"].append(row_entry)

        seat_label = format_seat_label(vsec.name, vrow.name, seat.number) or ""
        price_text = f"{tt.price_minor // 100:,} {tt.currency}" if tt is not None else "N/A"
        accessible_suffix = ", accessible seat" if seat.is_accessible else ""
        accessible_label = f"{seat_label}, {price_text}, {status_val}{accessible_suffix}"

        rows_by_section[vsec.id][vrow.id]["seats"].append(
            {
                "event_seat_id": es.id,
                "seat_id": seat.id,
                "section_name": vsec.name,
                "row_label": vrow.name,
                "seat_number": seat.number,
                "status": status_val,
                "is_accessible": seat.is_accessible,
                "price_category": seat.price_category,
                "ticket_type_id": es.ticket_type_id,
                "ticket_type_name": tt.name if tt is not None else None,
                "price_minor": tt.price_minor if tt is not None else None,
                "currency": tt.currency if tt is not None else None,
                "hold_expires_at": active_holds.get(es.id)
                if status_val == EventSeatStatus.HELD.value
                else None,
                "seat_label": seat_label,
                "accessible_label": accessible_label,
            }
        )

    return {
        "event_id": event.id,
        "seating_mode": str(event.seating_mode),
        "venue_id": event.venue_id,
        "venue_name": event.venue_name,
        "venue_city": event.venue_city,
        "venue_address": event.venue_address,
        "counts": {
            "total": counts["total"],
            "sellable": counts["sellable"],
            "available": counts[EventSeatStatus.AVAILABLE.value],
            "held": counts[EventSeatStatus.HELD.value],
            "sold": counts[EventSeatStatus.SOLD.value],
            "unavailable": counts[EventSeatStatus.UNAVAILABLE.value],
        },
        "sections": sorted(sections_dict.values(), key=lambda s: s["display_order"]),
    }


def claim_seat(
    db: Session, event: Event, event_seat_id: int, ticket_type_id: int
) -> tuple[EventSeat, str, str, str]:
    """Atomically claim one EventSeat (`available` -> `held`) inside the caller's transaction."""
    row = db.execute(
        select(EventSeat, VenueSection.name, VenueRow.name, Seat.number)
        .join(Seat, Seat.id == EventSeat.seat_id)
        .join(VenueRow, VenueRow.id == Seat.venue_row_id)
        .join(VenueSection, VenueSection.id == VenueRow.venue_section_id)
        .where(EventSeat.id == event_seat_id, EventSeat.event_id == event.id)
    ).first()
    if row is None:
        raise InvalidSeatSelection("selected seat does not belong to this event")
    event_seat, section_name, row_label, seat_number = row
    if event_seat.ticket_type_id != ticket_type_id:
        raise InvalidSeatSelection("selected seat does not match the requested ticket type")

    # Conditional UPDATE: only one concurrent checkout can flip 'available' -> 'held'.
    claimed = db.execute(
        update(EventSeat)
        .where(
            EventSeat.id == event_seat_id,
            EventSeat.event_id == event.id,
            EventSeat.status == EventSeatStatus.AVAILABLE,
        )
        .values(status=EventSeatStatus.HELD)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount == 0:
        raise SeatUnavailable
    return event_seat, section_name, row_label, seat_number


def mark_seats_sold(db: Session, event_seat_ids: list[int]) -> int:
    if not event_seat_ids:
        return 0
    res = db.execute(
        update(EventSeat)
        .where(
            EventSeat.id.in_(sorted(set(event_seat_ids))),
            EventSeat.status == EventSeatStatus.HELD,
        )
        .values(status=EventSeatStatus.SOLD)
        .execution_options(synchronize_session=False)
    )
    return res.rowcount


def release_held_seats(db: Session, event_seat_ids: list[int]) -> int:
    if not event_seat_ids:
        return 0
    res = db.execute(
        update(EventSeat)
        .where(
            EventSeat.id.in_(sorted(set(event_seat_ids))),
            EventSeat.status == EventSeatStatus.HELD,
        )
        .values(status=EventSeatStatus.AVAILABLE)
        .execution_options(synchronize_session=False)
    )
    return res.rowcount


def release_sold_seats(db: Session, event_seat_ids: list[int]) -> int:
    if not event_seat_ids:
        return 0
    res = db.execute(
        update(EventSeat)
        .where(
            EventSeat.id.in_(sorted(set(event_seat_ids))),
            EventSeat.status == EventSeatStatus.SOLD,
        )
        .values(status=EventSeatStatus.AVAILABLE)
        .execution_options(synchronize_session=False)
    )
    return res.rowcount


def sellable_seat_count(db: Session, event_id: int) -> int | None:
    """Count of non-unavailable EventSeats for an assigned-seating event, or None if GA/unconfigured."""
    total = db.scalar(select(EventSeat.id).where(EventSeat.event_id == event_id).limit(1))
    if total is None:
        return None
    from sqlalchemy import func

    return int(
        db.scalar(
            select(func.count(EventSeat.id)).where(
                EventSeat.event_id == event_id,
                EventSeat.status != EventSeatStatus.UNAVAILABLE,
            )
        )
        or 0
    )

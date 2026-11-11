"""Promo codes and campaigns (§4.14; docs/data-model/05-campaigns.md).

Two rules run through everything here:

1. The server computes every discount. A client sends a code or a QR token,
   never an amount.
2. Validation happens twice: when the code is applied (so the attendee sees
   the discount before paying, as §4.14 requires) and again, atomically, when
   the order is confirmed (§7), because the last redemption may be gone by then.
"""

import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import as_utc, utcnow
from app.core.config import settings
from app.models.campaign import Campaign, CampaignTicketType, DiscountType, PromoRedemption
from app.models.event import Event
from app.models.order import Order, OrderStatus
from app.models.payment import Refund, RefundStatus
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User
from app.services import audit

RejectCode = Literal[
    "not_found", "disabled", "not_started", "expired", "exhausted", "not_applicable"
]

# §4.14: "Expired, disabled, exhausted, or inapplicable codes shall be rejected
# with a clear message." One message per reason; "invalid code" for all of
# them would fail that requirement.
_MESSAGES: dict[str, str] = {
    "not_found": "This promo code does not exist for this event",
    "disabled": "This promo code has been disabled by the organizer",
    "not_started": "This promo code is not active yet",
    "expired": "This promo code has expired",
    "exhausted": "This promo code has been fully redeemed",
    "not_applicable": "This promo code does not apply to the selected tickets",
}

# Orders whose sale really happened, for campaign reporting.
_COUNTED = (OrderStatus.CONFIRMED, OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED)


class PromoRejected(Exception):
    """The code cannot be used. `code` is machine-readable, `reason` is for people."""

    def __init__(self, code: RejectCode):
        super().__init__(_MESSAGES[code])
        self.code = code
        self.reason = _MESSAGES[code]


class CodeAlreadyUsed(Exception):
    """Another campaign on this event already has this code."""


class UnknownTicketType(Exception):
    """A ticket type listed for the campaign is not on this event."""


class InvalidDiscount(Exception):
    """The edit would leave the campaign with an impossible discount or dates."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Quote:
    """What a campaign takes off a basket: per ticket type, and in total."""

    campaign: Campaign
    per_type: dict[int, int]

    @property
    def total(self) -> int:
        return sum(self.per_type.values())


# --- applying a code ----------------------------------------------------------


def find(db: Session, event: Event, *, code: str | None, token: str | None) -> Campaign:
    """Look a campaign up by typed code or by QR token, always within one event.

    There is deliberately no global lookup: codes are unique per event only,
    and a token for event A must not discount event B.
    """
    query = select(Campaign).where(Campaign.event_id == event.id)
    if token:
        query = query.where(Campaign.qr_token == token)
    elif code and code.strip():
        query = query.where(func.upper(Campaign.code) == code.strip().upper())
    else:
        raise PromoRejected("not_found")
    campaign = db.scalar(query)
    if campaign is None:
        raise PromoRejected("not_found")
    return campaign


def check_usable(campaign: Campaign, now: datetime | None = None) -> None:
    """Raise PromoRejected with the specific reason, or return."""
    now = now or utcnow()
    if not campaign.is_active:
        raise PromoRejected("disabled")
    if campaign.starts_at is not None and now < as_utc(campaign.starts_at):
        raise PromoRejected("not_started")
    if campaign.ends_at is not None and now >= as_utc(campaign.ends_at):
        raise PromoRejected("expired")
    if (
        campaign.max_redemptions is not None
        and campaign.redemption_count >= campaign.max_redemptions
    ):
        raise PromoRejected("exhausted")


def applicable_type_ids(db: Session, campaign: Campaign) -> list[int]:
    """Empty means every ticket type on the event."""
    return sorted(
        db.scalars(
            select(CampaignTicketType.ticket_type_id).where(
                CampaignTicketType.campaign_id == campaign.id
            )
        )
    )


def quote(
    db: Session,
    campaign: Campaign,
    lines: Sequence[tuple[TicketType, int]],
    now: datetime | None = None,
) -> Quote:
    """The discount for a basket of (ticket type, quantity) lines.

    Percent: taken off each applicable line, rounded down to a whole tiyn.
    Fixed: one amount per order, spread over the applicable lines in order and
    never more than those lines cost, so a total cannot go below zero.
    Free lines are never "discounted": there is nothing to take off.
    """
    check_usable(campaign, now)
    restricted = set(applicable_type_ids(db, campaign))
    eligible = [
        (ticket_type, quantity)
        for ticket_type, quantity in lines
        if (not restricted or ticket_type.id in restricted) and ticket_type.price_minor > 0
    ]
    if lines and not eligible:
        raise PromoRejected("not_applicable")

    per_type: dict[int, int] = {}
    if campaign.discount_type == DiscountType.PERCENT:
        for ticket_type, quantity in eligible:
            line_total = ticket_type.price_minor * quantity
            per_type[ticket_type.id] = line_total * campaign.discount_value // 100
    else:
        remaining = campaign.discount_value
        for ticket_type, quantity in eligible:
            taken = min(remaining, ticket_type.price_minor * quantity)
            per_type[ticket_type.id] = taken
            remaining -= taken
    return Quote(campaign, per_type)


def redeem(db: Session, order: Order, now: datetime | None = None) -> None:
    """Count the redemption at the moment the order is confirmed (§7 "atomically").

    The validity check and the increment are ONE statement. A SELECT followed
    by an UPDATE would let two buyers both take the last redemption
    (concurrency.md, promo redemption limits). Here the second buyer blocks on
    the row lock, Postgres re-checks the WHERE, and rowcount is 0.

    Runs inside confirm_order's transaction and does not commit: if this
    raises, the confirmation, the tickets and the charge all roll back.
    """
    if order.campaign_id is None or order.discount_minor == 0:
        # Attributed to a campaign but no discount was granted: nothing to count.
        return
    now = now or utcnow()
    claimed = db.execute(
        update(Campaign)
        .where(
            Campaign.id == order.campaign_id,
            Campaign.is_active,
            or_(
                Campaign.max_redemptions.is_(None),
                Campaign.redemption_count < Campaign.max_redemptions,
            ),
            or_(Campaign.starts_at.is_(None), Campaign.starts_at <= now),
            or_(Campaign.ends_at.is_(None), Campaign.ends_at > now),
        )
        .values(redemption_count=Campaign.redemption_count + 1)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount == 0:
        campaign = db.get(Campaign, order.campaign_id)
        db.refresh(campaign)
        # Says precisely which rule failed; "exhausted" if a race took the
        # last use between the read above and this one.
        check_usable(campaign, now)
        raise PromoRejected("exhausted")
    db.add(
        PromoRedemption(
            campaign_id=order.campaign_id, order_id=order.id, discount_minor=order.discount_minor
        )
    )


# --- the organizer's side ------------------------------------------------------


def new_code() -> str:
    # Same Crockford alphabet as ticket codes: readable off a poster.
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "BF" + "".join(secrets.choice(alphabet) for _ in range(6))


def create(db: Session, event: Event, data, actor: User) -> Campaign:
    fields = data.model_dump(exclude={"ticket_type_ids", "code"})
    campaign = Campaign(
        event_id=event.id,
        code=(data.code or new_code()).strip().upper(),
        # 32 random bytes: campaign links cannot be enumerated to find
        # discounts the organizer has not announced.
        qr_token=secrets.token_urlsafe(32),
        **fields,
    )
    db.add(campaign)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise CodeAlreadyUsed from None
    try:
        _set_ticket_types(db, event, campaign, data.ticket_type_ids)
    except UnknownTicketType:
        db.rollback()
        raise
    audit.record(
        db,
        action="campaign.created",
        entity_type="campaign",
        entity_id=campaign.id,
        event_id=event.id,
        actor=actor,
        summary=f"Promo campaign '{campaign.name}' created with code {campaign.code}",
        payload={
            "discount_type": campaign.discount_type,
            "discount_value": campaign.discount_value,
            "max_redemptions": campaign.max_redemptions,
        },
    )
    db.commit()
    db.refresh(campaign)
    return campaign


def update_campaign(db: Session, event: Event, campaign: Campaign, data, actor: User) -> Campaign:
    changes = data.model_dump(exclude_unset=True)
    type_ids = changes.pop("ticket_type_ids", None)
    if "code" in changes:
        changes["code"] = changes["code"].strip().upper()
    was_active = campaign.is_active
    for field, value in changes.items():
        setattr(campaign, field, value)
    # The schema only sees the request. A PATCH of the type alone has to be
    # checked against the stored value: percent with 5000 is 5000 percent off.
    problem = _invalid(campaign)
    if problem:
        db.rollback()
        raise InvalidDiscount(problem)
    try:
        if type_ids is not None:
            _set_ticket_types(db, event, campaign, type_ids)
    except UnknownTicketType:
        db.rollback()
        raise
    toggled = "is_active" in changes and changes["is_active"] != was_active
    if toggled:
        # §4.16 names "promo-code creation or disabling" as timeline actions.
        action = "campaign.enabled" if campaign.is_active else "campaign.disabled"
        summary = f"Promo code {campaign.code} " + ("enabled" if campaign.is_active else "disabled")
    else:
        action, summary = "campaign.updated", f"Promo campaign '{campaign.name}' edited"
    audit.record(
        db,
        action=action,
        entity_type="campaign",
        entity_id=campaign.id,
        event_id=event.id,
        actor=actor,
        summary=summary,
        payload={k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in changes.items()},
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise CodeAlreadyUsed from None
    db.refresh(campaign)
    return campaign


def _invalid(campaign: Campaign) -> str | None:
    if campaign.discount_type == DiscountType.PERCENT and campaign.discount_value > 100:
        return "a percent discount must be between 1 and 100"
    if (
        campaign.starts_at is not None
        and campaign.ends_at is not None
        and as_utc(campaign.ends_at) <= as_utc(campaign.starts_at)
    ):
        return "ends_at must be after starts_at"
    if (
        campaign.max_redemptions is not None
        and campaign.max_redemptions < campaign.redemption_count
    ):
        return (
            f"{campaign.redemption_count} redemptions already happened; "
            "the limit cannot be set below that"
        )
    return None


def _set_ticket_types(db: Session, event: Event, campaign: Campaign, ids: Sequence[int]) -> None:
    wanted = set(ids)
    if wanted:
        known = set(
            db.scalars(
                select(TicketType.id).where(
                    TicketType.event_id == event.id, TicketType.id.in_(wanted)
                )
            )
        )
        if known != wanted:
            raise UnknownTicketType
    db.execute(delete(CampaignTicketType).where(CampaignTicketType.campaign_id == campaign.id))
    db.add_all(CampaignTicketType(campaign_id=campaign.id, ticket_type_id=i) for i in wanted)
    db.flush()


def list_for_event(db: Session, event: Event) -> Sequence[Campaign]:
    return db.scalars(
        select(Campaign).where(Campaign.event_id == event.id).order_by(Campaign.id.desc())
    ).all()


def get_for_event(db: Session, event: Event, campaign_id: int) -> Campaign | None:
    return db.scalar(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.event_id == event.id)
    )


def link(event: Event, campaign: Campaign) -> str:
    """What the Campaign QR encodes: a plain web link with an opaque token.

    It is a URL, not a signed BF1 payload, so the admission scanner's very
    first step (signature) rejects it (§4.14, §11).
    """
    return f"{settings.PUBLIC_WEB_URL.rstrip('/')}/events/{event.slug}?c={campaign.qr_token}"


def stats(db: Session, campaign: Campaign) -> dict:
    """§4.14: "exact redemptions, orders, tickets sold, gross revenue, discount
    amount, and net revenue for each campaign". Computed from orders every
    time, never stored: a cached total that disagrees with the orders it
    summarizes is worse than a slow page.
    """
    orders, gross, discount = db.execute(
        select(
            func.count(Order.id),
            func.coalesce(func.sum(Order.subtotal_minor), 0),
            func.coalesce(func.sum(Order.discount_minor), 0),
        ).where(Order.campaign_id == campaign.id, Order.status.in_(_COUNTED))
    ).one()
    tickets = db.scalar(
        select(func.count(Ticket.id))
        .join(Order, Order.id == Ticket.order_id)
        .where(Order.campaign_id == campaign.id, Order.status.in_(_COUNTED))
    )
    refunds = db.scalar(
        select(func.coalesce(func.sum(Refund.amount_minor), 0))
        .join(Order, Order.id == Refund.order_id)
        .where(Order.campaign_id == campaign.id, Refund.status == RefundStatus.SUCCEEDED)
    )
    redemptions = db.scalar(select(func.count()).where(PromoRedemption.campaign_id == campaign.id))
    return {
        "redemptions": redemptions,
        "orders": orders,
        "tickets_sold": tickets,
        "gross_minor": int(gross),
        "discount_minor": int(discount),
        "refunds_minor": int(refunds),
        "net_minor": int(gross) - int(discount) - int(refunds),
    }

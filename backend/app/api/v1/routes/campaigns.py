"""Promo campaigns (§4.14): the organizer's builder and the attendee's
"apply a code" check. See docs/data-model/05-campaigns.md."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app.api.deps import EVENT_NOT_FOUND, CurrentUser, DbSession, OwnedEvent
from app.models.campaign import Campaign
from app.models.event import Event
from app.models.ticket_type import TicketType
from app.schemas.campaign import (
    CampaignCreate,
    CampaignRead,
    CampaignUpdate,
    PromoQuote,
    PromoQuoteRequest,
)
from app.services import campaign as campaign_service
from app.services import campaign_qr
from app.services import event as event_service

router = APIRouter(tags=["campaigns"])

CAMPAIGN_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Campaign not found")
CODE_TAKEN = HTTPException(
    status.HTTP_409_CONFLICT, "Another campaign of this event already uses this code"
)
UNKNOWN_TYPE = HTTPException(
    status.HTTP_422_UNPROCESSABLE_CONTENT, "A listed ticket type is not part of this event"
)


def _read(db: DbSession, event: Event, campaign: Campaign) -> dict:
    return {
        **{
            field: getattr(campaign, field)
            for field in CampaignRead.model_fields
            if field not in ("ticket_type_ids", "link", "stats")
        },
        "ticket_type_ids": campaign_service.applicable_type_ids(db, campaign),
        "link": campaign_service.link(event, campaign),
        "stats": campaign_service.stats(db, campaign),
    }


def _owned(db: DbSession, event: Event, campaign_id: int) -> Campaign:
    # Scoped by event: one organizer cannot reach another's campaign by id.
    campaign = campaign_service.get_for_event(db, event, campaign_id)
    if campaign is None:
        raise CAMPAIGN_NOT_FOUND
    return campaign


# --- organizer -----------------------------------------------------------------


@router.get("/organizer/events/{event_id}/campaigns", response_model=list[CampaignRead])
def list_campaigns(event: OwnedEvent, db: DbSession) -> list[dict]:
    return [_read(db, event, c) for c in campaign_service.list_for_event(db, event)]


@router.post(
    "/organizer/events/{event_id}/campaigns",
    response_model=CampaignRead,
    status_code=status.HTTP_201_CREATED,
)
def create_campaign(
    event: OwnedEvent, data: CampaignCreate, user: CurrentUser, db: DbSession
) -> dict:
    """Creates the campaign, its promo code and its QR token in one step."""
    try:
        campaign = campaign_service.create(db, event, data, user)
    except campaign_service.CodeAlreadyUsed:
        raise CODE_TAKEN from None
    except campaign_service.UnknownTicketType:
        raise UNKNOWN_TYPE from None
    return _read(db, event, campaign)


@router.patch("/organizer/events/{event_id}/campaigns/{campaign_id}", response_model=CampaignRead)
def update_campaign(
    event: OwnedEvent, campaign_id: int, data: CampaignUpdate, user: CurrentUser, db: DbSession
) -> dict:
    """Edit or disable a campaign. Past redemptions keep the discount they got."""
    campaign = _owned(db, event, campaign_id)
    try:
        campaign = campaign_service.update_campaign(db, event, campaign, data, user)
    except campaign_service.CodeAlreadyUsed:
        raise CODE_TAKEN from None
    except campaign_service.UnknownTicketType:
        raise UNKNOWN_TYPE from None
    except campaign_service.InvalidDiscount as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.reason) from None
    return _read(db, event, campaign)


@router.get(
    "/organizer/events/{event_id}/campaigns/{campaign_id}/qr.svg",
    response_class=Response,
    responses={200: {"content": {"image/svg+xml": {}}}},
)
def campaign_qr_image(event: OwnedEvent, campaign_id: int, db: DbSession) -> Response:
    """The Campaign QR as a print-ready SVG. It encodes a link, not a ticket:
    the door scanner answers `invalid` if someone shows it (§11)."""
    campaign = _owned(db, event, campaign_id)
    body = campaign_qr.svg(campaign_service.link(event, campaign), campaign.code, event.title)
    return Response(
        body,
        media_type="image/svg+xml",
        headers={"Content-Disposition": f'inline; filename="promo-{campaign.code}.svg"'},
    )


# --- attendee ------------------------------------------------------------------


@router.post("/events/{slug}/promo", response_model=PromoQuote)
def quote_promo(slug: str, data: PromoQuoteRequest, db: DbSession) -> dict:
    """Check a promo code (typed) or campaign token (from a QR link) against a
    basket and return the discount, so the attendee sees the new total before
    paying (§4.14). 409 with the specific reason if the code cannot be used.

    Nothing is reserved or redeemed here; checkout validates again.
    """
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise EVENT_NOT_FOUND
    ids = [line.ticket_type_id for line in data.items]
    types = {
        t.id: t
        for t in db.scalars(
            select(TicketType).where(TicketType.event_id == event.id, TicketType.id.in_(ids))
        )
    }
    if len(types) != len(set(ids)):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown ticket type for this event"
        )
    lines = [(types[line.ticket_type_id], line.quantity) for line in data.items]
    try:
        campaign = campaign_service.find(db, event, code=data.code, token=data.token)
        quote = campaign_service.quote(db, campaign, lines)
    except campaign_service.PromoRejected as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    subtotal = sum(ticket_type.price_minor * quantity for ticket_type, quantity in lines)
    return {
        "code": campaign.code,
        "name": campaign.name,
        "discount_type": campaign.discount_type,
        "discount_value": campaign.discount_value,
        "ticket_type_ids": campaign_service.applicable_type_ids(db, campaign),
        "subtotal_minor": subtotal,
        "discount_minor": quote.total,
        "total_minor": subtotal - quote.total,
    }

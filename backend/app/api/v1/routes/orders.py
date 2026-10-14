from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.core.security import create_order_token
from app.models.order import Order
from app.schemas.order import CheckoutRequest, CheckoutResponse, OrderRead
from app.services import event as event_service
from app.services import hold as hold_service
from app.services import order as order_service

router = APIRouter(tags=["orders"])

ORDER_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")


def _read(db: DbSession, order: Order) -> dict:
    tickets = [
        {
            "public_code": ticket.public_code,
            "ticket_type_id": ticket.ticket_type_id,
            "status": ticket.status,
            "attendee_name": name,
        }
        for ticket, name in order_service.order_tickets(db, order)
    ]
    body = OrderRead.model_validate(
        {
            # There are no relationship() attributes on the models, so the two
            # lists are loaded separately rather than read off the order.
            **{
                field: getattr(order, field)
                for field in OrderRead.model_fields
                if field not in ("items", "tickets")
            },
            "items": order_service.order_items(db, order),
            "tickets": tickets,
        }
    )
    return body.model_dump()


@router.post(
    "/events/{slug}/orders",
    response_model=CheckoutResponse,
    status_code=status.HTTP_201_CREATED,
)
def checkout(slug: str, data: CheckoutRequest, user: OptionalUser, db: DbSession) -> dict:
    """Reserve and order in one request. Free orders come back `confirmed`
    with tickets; paid ones come back `pending` until payments exist.
    """
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    try:
        order = order_service.checkout(db, event, data, user)
    except order_service.UnknownTicketType:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown ticket type for this event"
        ) from None
    except hold_service.QuantityNotAllowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Quantity exceeds the per-order limit"
        ) from None
    except hold_service.NotOnSale as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Not on sale: {exc.reason}") from None
    except hold_service.SoldOut:
        # Expected even when the page said tickets were available: someone
        # else's checkout landed first. The frontend shows "sold out".
        raise HTTPException(status.HTTP_409_CONFLICT, "Sold out") from None
    return _read(db, order) | {"access_token": create_order_token(order.id)}


@router.get("/orders/{order_number}", response_model=OrderRead)
def read_order(
    order_number: str,
    db: DbSession,
    user: OptionalUser,
    token: Annotated[str | None, Query(description="The signed link token for guests")] = None,
) -> dict:
    order = order_service.get_order_by_number(db, order_number)
    # Missing and not-yours are the same 404, so order numbers cannot be probed.
    if order is None or not order_service.can_view(order, user, token):
        raise ORDER_NOT_FOUND
    return _read(db, order)


@router.get("/users/me/orders", response_model=list[OrderRead])
def list_my_orders(user: CurrentUser, db: DbSession) -> list[dict]:
    return [_read(db, order) for order in order_service.list_user_orders(db, user)]

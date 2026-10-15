from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.order import Order
from app.schemas.order import OrderCreate, OrderRead
from app.services import order as order_service

router = APIRouter(tags=["orders"])

MAX_PAGE_SIZE = 100


@router.post("/orders", response_model=OrderRead, status_code=status.HTTP_201_CREATED)
def create_order(
    data: OrderCreate,
    user: CurrentUser,
    db: DbSession,
) -> Order:
    try:
        return order_service.create_order(db, user, data)
    except order_service.TicketsNotAvailable:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "One or more requested tickets are no longer available"
        ) from None


@router.get("/orders", response_model=list[OrderRead])
def list_my_orders(
    user: CurrentUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Sequence[Order]:
    return order_service.list_user_orders(db, user=user, limit=limit, offset=offset)


@router.get("/orders/{order_id}", response_model=OrderRead)
def read_order(
    order_id: int,
    user: CurrentUser,
    db: DbSession,
) -> Order:
    # Non-existent order or order belonging to another user returns 404
    order = order_service.get_user_order(db, user=user, order_id=order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


@router.post("/orders/{order_id}/cancel", response_model=OrderRead)
def cancel_order(
    order_id: int,
    user: CurrentUser,
    db: DbSession,
) -> Order:
    order = order_service.get_user_order(db, user=user, order_id=order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    try:
        return order_service.cancel_order(db, order)
    except order_service.OrderNotCancellable:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Only pending orders can be cancelled"
        ) from None

from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Numeric,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base

if TYPE_CHECKING:
    from app.models.ticket import Ticket


class OrderStatus(StrEnum):
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


def _check_list(enum: type[StrEnum]) -> str:
    return ", ".join(f"'{member.value}'" for member in enum)


def _string_enum(enum: type[StrEnum], length: int) -> SQLEnum:
    return SQLEnum(
        enum,
        native_enum=False,
        length=length,
        create_constraint=False,
        values_callable=lambda e: [member.value for member in e],
    )


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)

    total_amount: Mapped[float] = mapped_column(Numeric(10, 2))
    status: Mapped[OrderStatus] = mapped_column(
        _string_enum(OrderStatus, 20), server_default=OrderStatus.PENDING.value
    )

    # Резерв заказа сгорает через определенное время (например, 15 минут)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    tickets: Mapped[list["Ticket"]] = relationship("Ticket", back_populates="order")

    __table_args__ = (
        CheckConstraint(f"status IN ({_check_list(OrderStatus)})", name="order_status"),
        CheckConstraint("total_amount >= 0", name="total_amount_non_negative"),
        Index("ix_orders_user_id_status", "user_id", "status"),
    )

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
    String,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base

if TYPE_CHECKING:
    from app.models.order import Order


class TicketStatus(StrEnum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    SOLD = "sold"
    CANCELLED = "cancelled"


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


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), index=True)
    order_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("orders.id"), index=True, nullable=True
    )

    ticket_code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    seat_number: Mapped[str | None] = mapped_column(String(50))
    price: Mapped[float] = mapped_column(Numeric(10, 2))

    status: Mapped[TicketStatus] = mapped_column(
        _string_enum(TicketStatus, 20), server_default=TicketStatus.AVAILABLE.value
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    order: Mapped["Order | None"] = relationship("Order", back_populates="tickets")

    __table_args__ = (
        CheckConstraint(f"status IN ({_check_list(TicketStatus)})", name="ticket_status"),
        CheckConstraint("price >= 0", name="price_non_negative"),
        Index("ix_tickets_event_id_status", "event_id", "status"),
    )

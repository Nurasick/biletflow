from datetime import datetime

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class TicketType(Base):
    __tablename__ = "ticket_types"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    price_minor: Mapped[int] = mapped_column(BigInteger, server_default="0")
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="KZT")
    quantity_total: Mapped[int] = mapped_column(Integer)
    quantity_sold: Mapped[int] = mapped_column(Integer, server_default="0")
    quantity_reserved: Mapped[int] = mapped_column(Integer, server_default="0")
    sales_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sales_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_per_order: Mapped[int | None] = mapped_column(Integer)
    is_hidden: Mapped[bool] = mapped_column(Boolean, server_default=false())
    position: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    __table_args__ = (
        CheckConstraint(
            "quantity_sold + quantity_reserved <= quantity_total", name="inventory_within_total"
        ),
        CheckConstraint(
            "quantity_sold >= 0 AND quantity_reserved >= 0", name="counters_non_negative"
        ),
        CheckConstraint("price_minor >= 0", name="price_non_negative"),
        CheckConstraint("max_per_order IS NULL OR max_per_order>0", name="max_per_order_positive"),
        CheckConstraint(
            "sales_start_at IS NULL OR sales_end_at IS NULL OR sales_end_at > sales_start_at",
            name="sales_window_order",
        ),
    )

"""Physical venue hierarchy: venues -> sections -> rows -> seats (§4.3.1, §8 Bonus).

These describe chairs that exist in a building and are reused across events.
Per-event availability and pricing live in `event_seats` (app/models/seat.py).
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class Venue(Base):
    __tablename__ = "venues"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    name: Mapped[str] = mapped_column(String(300))
    city: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class VenueSection(Base):
    __tablename__ = "venue_sections"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    venue_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("venues.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    __table_args__ = (UniqueConstraint("venue_id", "name", name="uq_venue_sections_venue_name"),)


class VenueRow(Base):
    __tablename__ = "venue_rows"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    venue_section_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("venue_sections.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(20))
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    __table_args__ = (
        UniqueConstraint("venue_section_id", "name", name="uq_venue_rows_section_name"),
    )


class Seat(Base):
    __tablename__ = "seats"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    venue_row_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("venue_rows.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[str] = mapped_column(String(10))
    is_accessible: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    price_category: Mapped[str] = mapped_column(String(50))
    display_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    __table_args__ = (UniqueConstraint("venue_row_id", "number", name="uq_seats_row_number"),)

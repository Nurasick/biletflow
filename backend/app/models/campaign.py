from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class DiscountType(StrEnum):
    PERCENT = "percent"
    FIXED = "fixed"


class Campaign(Base):
    """A promotional campaign and its one promo code (§4.14).

    §6 lists "Promotional Campaign" and "Promo Code" separately; they are one
    table because §4.14 gives each campaign exactly one code and one QR
    (docs/data-model/05-campaigns.md#a-note-on-the-entity-list).
    """

    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # What the attendee types: STUDENT20. Unique per event, not globally, so
    # two organizers can both run the obvious word.
    code: Mapped[str] = mapped_column(String(64))
    # Opaque and unguessable; it is what the Campaign QR link carries. Never a
    # discount amount: the server looks the campaign up and computes it.
    qr_token: Mapped[str] = mapped_column(String(64), unique=True)
    discount_type: Mapped[DiscountType] = mapped_column(string_enum(DiscountType, 20))
    # percent: 0..100. fixed: KZT minor units, like every other money column.
    discount_value: Mapped[int] = mapped_column(Integer)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # NULL means unlimited.
    max_redemptions: Mapped[int | None] = mapped_column(Integer)
    # A counter, moved only by the atomic UPDATE in services/campaign.redeem.
    redemption_count: Mapped[int] = mapped_column(Integer, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("event_id", "code", name="uq_campaigns_event_id_code"),
        CheckConstraint(f"discount_type IN ({check_list(DiscountType)})", name="discount_type"),
        # Without this, percent + 5000 is a 5000% discount.
        CheckConstraint(
            "discount_type <> 'percent' OR discount_value BETWEEN 0 AND 100", name="percent_range"
        ),
        CheckConstraint("discount_value >= 0", name="value_non_negative"),
        # The backstop under the atomic UPDATE (§7).
        CheckConstraint(
            "max_redemptions IS NULL OR redemption_count <= max_redemptions",
            name="within_redemption_limit",
        ),
        CheckConstraint(
            "ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at", name="dates_ordered"
        ),
    )


class CampaignTicketType(Base):
    """Which ticket types a campaign discounts. No rows = every type on the
    event, including ones added later (05-campaigns.md#campaign_ticket_types)."""

    __tablename__ = "campaign_ticket_types"

    campaign_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True
    )
    ticket_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ticket_types.id"), primary_key=True
    )


class PromoRedemption(Base):
    """One row per order that actually received a discount."""

    __tablename__ = "promo_redemptions"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    campaign_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("campaigns.id"), index=True)
    # UNIQUE: one promo code per order. Stacking is where discount logic gets
    # hard, and §4.14 never asks for it.
    order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("orders.id"), unique=True)
    # A snapshot of what was granted. Editing the campaign later must not
    # rewrite the discount on past orders.
    discount_minor: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("discount_minor >= 0", name="discount_non_negative"),)

from sqlalchemy import BigInteger, ForeignKey, Identity, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class Attendee(Base):
    """The person a ticket admits. Not a synonym for the buyer or for a user.

    Buy four tickets for friends and the order has one purchaser and four
    attendees with different names (§4.6, §4.7). One row per ticket.
    """

    __tablename__ = "attendees"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("orders.id"), index=True)
    # Which line of the order this person's ticket comes from. Without it,
    # confirming a two-line order (2 VIP + 1 General) would have to guess
    # which attendee gets which ticket type.
    order_item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("order_items.id"), index=True)
    # Set only when the attendee happens to have an account.
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(32))

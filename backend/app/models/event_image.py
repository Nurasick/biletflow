from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class EventImage(Base):
    """One uploaded picture of an event (§4.2 "images", plural).

    The bytes live in file storage, never in the database: rows store where to
    find them. Position 0 is the cover, and events.cover_image_url is kept
    equal to its url so list endpoints need no join.
    """

    __tablename__ = "event_images"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), index=True)
    # The key inside the storage backend, e.g. events/12/3f9c….webp. The public
    # url is derived from it by the storage layer, so moving to S3 later means
    # changing that layer, not rewriting rows.
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    url: Mapped[str] = mapped_column(String(512))
    content_type: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint("position >= 0", name="position_non_negative"),
    )

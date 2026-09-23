from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class StaffRole(StrEnum):
    ADMIN = "event_admin"


_STAFF_ROLE_LIST = ", ".join(f"'{s.value}'" for s in StaffRole)
STAFF_ROLE = SQLEnum(
    StaffRole,
    native_enum=False,
    length=20,
    values_callable=lambda enum: [member.value for member in enum],
)


class StaffAssignment(Base):
    __tablename__ = "staff_assignments"
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"),index=True)
    role: Mapped[StaffRole] = mapped_column(STAFF_ROLE, server_default=StaffRole.ADMIN)
    assigned_by_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(f"role in ({_STAFF_ROLE_LIST})", name="role"),
        UniqueConstraint("event_id", "user_id", name="uq_staff_assignments_event_id_user_id"),
    )

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Identity,
    String,
    false,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


_STATUS_LIST = ", ".join(f"'{s.value}'" for s in UserStatus)

# Coerces to UserStatus on the way out of the database, so `Mapped[UserStatus]`
# is the truth rather than an aspiration. Storage stays VARCHAR(20): a native
# Postgres ENUM cannot gain a value without an ALTER TYPE.
#
# create_constraint stays False and the CHECK below is written by hand. The one
# this type would emit is attached by a DDL listener rather than to the table's
# metadata, so alembic autogenerate cannot see it and proposes dropping the
# real one on every run.
#
# values_callable is not optional: SQLAlchemy persists an enum member's *name*
# by default, which would write "ACTIVE" where every existing row says "active".
USER_STATUS = SQLEnum(
    UserStatus,
    native_enum=False,
    length=20,
    values_callable=lambda enum: [member.value for member in enum],
)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    hashed_password: Mapped[str] = mapped_column(String())

    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))

    is_email_verified: Mapped[bool] = mapped_column(Boolean, server_default=false())
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, server_default=false())

    status: Mapped[UserStatus] = mapped_column(USER_STATUS, server_default=UserStatus.ACTIVE.value)
    locale: Mapped[str] = mapped_column(String(5), server_default="ru")

    __table_args__ = (
        CheckConstraint(f"status IN ({_STATUS_LIST})", name="status"),
        CheckConstraint("locale IN ('kk','ru','en')", name="locale"),
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

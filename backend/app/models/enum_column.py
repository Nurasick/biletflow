from enum import StrEnum

from sqlalchemy import Enum as SQLEnum


def check_list(enum: type[StrEnum]) -> str:
    """The `'a', 'b', 'c'` list for a hand-written `status IN (...)` CHECK."""
    return ", ".join(f"'{member.value}'" for member in enum)


def string_enum(enum: type[StrEnum], length: int) -> SQLEnum:
    # Same shape as USER_STATUS in app/models/user.py, which explains each
    # argument: VARCHAR storage, values rather than names, and the CHECK
    # written by hand in __table_args__ so autogenerate can see it.
    return SQLEnum(
        enum,
        native_enum=False,
        length=length,
        create_constraint=False,
        values_callable=lambda e: [member.value for member in e],
    )

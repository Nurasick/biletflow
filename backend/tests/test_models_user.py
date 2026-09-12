"""The status column's contract with the database."""

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.user import User, UserStatus
from tests.conftest import make_user


def _persist(db: Session, **overrides) -> User:
    user = make_user(id=None, **overrides)
    db.add(user)
    db.commit()
    return user


def test_status_comes_back_as_the_enum_not_a_string(db):
    _persist(db)

    user = db.scalars(select(User)).one()

    assert isinstance(user.status, UserStatus)
    assert user.status is UserStatus.ACTIVE


def test_status_is_stored_as_the_value_not_the_member_name(db):
    """SQLAlchemy persists an enum member's name unless told otherwise.

    Without values_callable this column would write "SUSPENDED", which no
    existing row uses and the CHECK constraint would reject.
    """
    _persist(db, status=UserStatus.SUSPENDED)

    stored = db.execute(text("SELECT status FROM users")).scalar_one()

    assert stored == "suspended"


def test_a_status_string_still_round_trips_to_the_enum(db):
    """Rows written before the column was typed still load correctly."""
    _persist(db, status="suspended")

    user = db.scalars(select(User)).one()

    assert user.status is UserStatus.SUSPENDED

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.user import User
from app.schemas.user import UserCreate, UserRead, UserUpdate


def make_user(**overrides) -> User:
    defaults = dict(
        id=1,
        email="example@example.com",
        hashed_password="$argon2id$fake",
        first_name="example",
        last_name="example",
        phone=None,
        is_email_verified=False,
        is_platform_admin=False,
        status="active",
        locale="ru",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    return User(**(defaults | overrides))


def test_user_read_can_be_built_from_orm_object():
    user = make_user(first_name="Aigerim", status="suspended")

    schema = UserRead.model_validate(user)

    assert schema.id == 1
    assert schema.first_name == "Aigerim"
    assert schema.status == "suspended"
    assert isinstance(schema.created_at, datetime)


def test_user_read_never_exposes_hashed_password():
    assert "hashed_password" not in UserRead.model_fields


@pytest.mark.parametrize("raw", ["Abai@Example.com", "ABAI@EXAMPLE.COM", "abai@example.com"])
def test_user_create_lowercases_the_email_local_part(raw):
    schema = UserCreate(
        email=raw,
        first_name="example",
        last_name="example",
        password="correct horse",
        locale="ru",
    )
    assert schema.email == "abai@example.com"
    assert schema.email.split("@")[0] == "abai"


def test_user_update_accepts_an_empty_body():
    schema = UserUpdate()
    assert schema.model_dump(exclude_unset=True) == {}


def test_user_update_reports_only_the_fields_that_were_sent():
    schema = UserUpdate(first_name="Aigerim")
    assert schema.model_dump(exclude_unset=True) == {"first_name": "Aigerim"}


def test_user_create_rejects_unsupported_locale():
    with pytest.raises(ValidationError) as excinfo:
        UserCreate(
            email="abai@example.com",
            first_name="example",
            last_name="example",
            password="correct horse",
            locale="fr",  # type:ignore[arg-type] -- invalid on purpose
        )
    errors = excinfo.value.errors()
    assert [e["loc"] for e in errors] == [("locale",)]


def test_user_create_reject_short_password():
    with pytest.raises(ValidationError) as excinfo:
        UserCreate(
            email="abai@example.com",
            first_name="example",
            last_name="example",
            password="horse",
            locale="ru",
        )
    errors = excinfo.value.errors()
    assert [e["loc"] for e in errors] == [("password",)]

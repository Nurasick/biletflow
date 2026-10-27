"""Organizer profile, sandbox payout and event staff (§4.1, 01-identity.md)."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.organizer import PayoutAccount
from tests.test_events import add_event, add_organizer, add_user, auth

PROFILE = "/api/v1/organizer/profile"
STAFF = "/api/v1/organizer/events/{event_id}/staff"


def profile_body(**overrides) -> dict:
    return {
        "display_name": "  Jazz KZ  ",
        "contact_email": "Hello@JazzKZ.example",
        "contact_phone": "+7 (701) 123-45-67",
        "description": "",
        "payout_provider": "sandbox_wallet",
        "payout_reference": "demo_wallet_7",
    } | overrides


def test_first_save_makes_the_account_an_organizer(api, db: Session):
    user = add_user(db, "new@example.com")
    assert api.get(PROFILE, headers=auth(user)).status_code == 404

    saved = api.put(PROFILE, headers=auth(user), json=profile_body())
    me = api.get("/api/v1/users/me", headers=auth(user)).json()

    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["display_name"] == "Jazz KZ"
    assert body["contact_email"] == "hello@jazzkz.example"
    assert body["description"] is None
    assert body["verification_status"] == "unverified"
    assert body["payout_account"] == {
        "provider": "sandbox_wallet",
        "external_account_ref": "demo_wallet_7",
        "status": "active",
        "is_simulated": True,
    }
    assert me["is_organizer"] is True


def test_saving_again_replaces_the_payout_account_instead_of_adding_one(api, db):
    user = add_user(db, "new@example.com")
    api.put(PROFILE, headers=auth(user), json=profile_body())

    api.put(PROFILE, headers=auth(user), json=profile_body(payout_reference="demo_wallet_8"))
    cleared = api.put(
        PROFILE, headers=auth(user), json=profile_body(payout_provider=None, payout_reference="")
    )

    assert cleared.json()["payout_account"] is None
    assert db.scalars(select(PayoutAccount)).all() == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"display_name": "   "},
        {"payout_reference": "123456789"},
        {"payout_provider": "real_bank"},
        {"payout_provider": None},
        {"contact_phone": "12"},
        {"description": "x" * 2001},
    ],
)
def test_invalid_profiles_are_rejected(api, db, overrides):
    user = add_user(db, "new@example.com")

    assert api.put(PROFILE, headers=auth(user), json=profile_body(**overrides)).status_code == 422


def test_simulated_verification_marks_the_profile_verified(api, db):
    user, _ = add_organizer(db, "org@example.com")

    body = api.post(PROFILE + "/verify", headers=auth(user)).json()

    assert body["verification_status"] == "verified"


def test_assign_list_and_remove_event_staff(api, db):
    user, profile = add_organizer(db, "org@example.com")
    event = add_event(db, profile)
    door = add_user(db, "door@example.com")
    url = STAFF.format(event_id=event.id)

    assigned = api.post(url, headers=auth(user), json={"email": "DOOR@example.com"})
    duplicate = api.post(url, headers=auth(user), json={"email": "door@example.com"})
    unknown = api.post(url, headers=auth(user), json={"email": "nobody@example.com"})
    removed = api.delete(f"{url}/{door.id}", headers=auth(user))

    assert assigned.status_code == 201
    assert [s["email"] for s in assigned.json()] == ["door@example.com"]
    assert duplicate.status_code == 409
    assert unknown.status_code == 404
    assert removed.status_code == 204
    assert api.get(url, headers=auth(user)).json() == []
    actions = list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))
    assert actions == ["staff.assigned", "staff.removed"]


def test_staff_of_someone_elses_event_is_404(api, db):
    _, profile = add_organizer(db, "org@example.com")
    event = add_event(db, profile)
    stranger, _ = add_organizer(db, "x@example.com")

    response = api.get(STAFF.format(event_id=event.id), headers=auth(stranger))

    assert response.status_code == 404


def test_users_me_can_be_updated(api, db):
    user = add_user(db, "me@example.com")

    body = api.patch(
        "/api/v1/users/me", headers=auth(user), json={"first_name": " Aru ", "locale": "en"}
    ).json()

    assert (body["first_name"], body["locale"], body["is_organizer"]) == ("Aru", "en", False)

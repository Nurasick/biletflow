"""Rules the backend and the web form must agree on (audit findings #16, #24, #25),
and slug generation for events created without one."""

from datetime import timedelta

import pytest

from app.services.slugs import slugify
from tests.test_events import ENDS, STARTS, add_event, add_organizer, auth, event_payload

EVENTS = "/api/v1/events"


@pytest.fixture
def organizer(db):
    return add_organizer(db, "organizer@example.com")


@pytest.mark.parametrize("zone", ["GMT", "EST", "Japan", "Etc/Unknown", "+05:00"])
def test_legacy_timezone_aliases_are_refused_like_the_web_form(api, organizer, zone):
    user, _ = organizer

    assert (
        api.post(EVENTS, headers=auth(user), json=event_payload(timezone=zone)).status_code == 422
    )


@pytest.mark.parametrize("zone", ["UTC", "Asia/Almaty", "America/Argentina/Buenos_Aires"])
def test_canonical_timezones_are_accepted(api, organizer, zone):
    user, _ = organizer

    response = api.post(EVENTS, headers=auth(user), json=event_payload(timezone=zone))

    assert response.status_code == 201


@pytest.mark.parametrize("field", ["registration_opens_at", "registration_closes_at"])
def test_registration_cannot_open_or_close_after_the_event_starts(api, organizer, field):
    user, _ = organizer
    late = (STARTS + timedelta(minutes=30)).isoformat()

    response = api.post(EVENTS, headers=auth(user), json=event_payload(**{field: late}))

    assert response.status_code == 422


def test_moving_the_start_before_stored_registration_is_refused(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, registration_closes_at=STARTS - timedelta(hours=1))

    response = api.patch(
        f"/api/v1/organizer/events/{event.id}",
        headers=auth(user),
        json={"starts_at": (STARTS - timedelta(hours=2)).isoformat()},
    )

    assert response.status_code == 422
    assert "registration_closes_at" in response.json()["detail"]


@pytest.mark.parametrize(
    "overrides",
    [{"title": "   "}, {"venue_address": "x" * 2001}, {"description": "x" * 10_001}],
)
def test_text_limits_match_the_web_form(api, organizer, overrides):
    user, _ = organizer

    assert api.post(EVENTS, headers=auth(user), json=event_payload(**overrides)).status_code == 422


def test_blank_names_cannot_register(api):
    response = api.post(
        "/api/v1/auth/register",
        json={
            "email": "a@example.com",
            "password": "long-enough",
            "first_name": "  ",
            "last_name": "S",
            "locale": "ru",
        },
    )

    assert response.status_code == 422


def test_an_event_without_a_slug_gets_one_from_its_title(api, organizer):
    user, _ = organizer
    body = event_payload(title="Джаз кеші — Алматы")
    del body["slug"]

    first = api.post(EVENTS, headers=auth(user), json=body).json()
    second = api.post(EVENTS, headers=auth(user), json=body).json()

    assert first["slug"] == "dzhaz-keshi-almaty"
    assert second["slug"] == "dzhaz-keshi-almaty-2"
    assert first["ends_at"].startswith(ENDS.date().isoformat())


@pytest.mark.parametrize(
    ("title", "slug"),
    [("Jazz Night!", "jazz-night"), ("Қазақ", "qazaq"), ("?!", "event"), ("Café Ü", "cafe-u")],
)
def test_slugify(title, slug):
    assert slugify(title) == slug

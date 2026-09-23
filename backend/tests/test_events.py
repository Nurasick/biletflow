from datetime import UTC, datetime

import pytest
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.models.event import Event, EventStatus, EventVisibility
from app.models.organizer import OrganizerProfile
from app.models.user import User

EVENTS = "/api/v1/events"
MY_EVENTS = "/api/v1/organizer/events"

STARTS = datetime(2030, 11, 30, 14, 0, tzinfo=UTC)
ENDS = datetime(2030, 11, 30, 17, 0, tzinfo=UTC)


def add_user(db: Session, email: str) -> User:
    user = User(
        email=email,
        hashed_password="$argon2id$fake",
        first_name="Abai",
        last_name="Kunanbayev",
    )
    db.add(user)
    db.commit()
    return user


def add_organizer(db: Session, email: str) -> tuple[User, OrganizerProfile]:
    user = add_user(db, email)
    profile = OrganizerProfile(user_id=user.id, display_name="Jazz KZ", contact_email=email)
    db.add(profile)
    db.commit()
    return user, profile


def auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def event_payload(**overrides) -> dict:
    return (
        dict(
            slug="jazz-night-almaty",
            title="Jazz Night",
            venue_name="Almaty Arena",
            venue_address="Momyshuly 1",
            starts_at=STARTS.isoformat(),
            ends_at=ENDS.isoformat(),
            timezone="Asia/Almaty",
        )
        | overrides
    )


def add_event(db: Session, profile: OrganizerProfile, **overrides) -> Event:
    fields = (
        dict(
            slug="jazz-night-almaty",
            title="Jazz Night",
            venue_name="Almaty Arena",
            venue_address="Momyshuly 1",
            starts_at=STARTS,
            ends_at=ENDS,
            timezone="Asia/Almaty",
            organizer_profile_id=profile.id,
        )
        | overrides
    )
    event = Event(**fields)
    db.add(event)
    db.commit()
    return event


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


# --- create -----------------------------------------------------------------


def test_create_event_starts_as_a_draft_owned_by_the_caller(api, organizer):
    user, profile = organizer

    response = api.post(EVENTS, json=event_payload(), headers=auth(user))

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "draft"
    assert body["organizer_profile_id"] == profile.id
    assert body["timezone"] == "Asia/Almaty"


def test_create_event_ignores_a_client_supplied_status_and_owner(api, db, organizer):
    user, profile = organizer
    _, other = add_organizer(db, "other@example.com")

    response = api.post(
        EVENTS,
        json=event_payload(status="published", organizer_profile_id=other.id),
        headers=auth(user),
    )

    assert response.status_code == 201
    assert response.json()["status"] == "draft"
    assert response.json()["organizer_profile_id"] == profile.id


def test_create_event_requires_authentication(api):
    assert api.post(EVENTS, json=event_payload()).status_code == 401


def test_create_event_requires_an_organizer_profile(api, db):
    user = add_user(db, "attendee@example.com")

    response = api.post(EVENTS, json=event_payload(), headers=auth(user))

    assert response.status_code == 403


def test_create_event_rejects_a_duplicate_slug(api, organizer):
    user, _ = organizer
    api.post(EVENTS, json=event_payload(), headers=auth(user))

    response = api.post(EVENTS, json=event_payload(), headers=auth(user))

    assert response.status_code == 409


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param(dict(ends_at=STARTS.isoformat()), id="ends-equal-to-start"),
        pytest.param(dict(timezone="+05:00"), id="offset-instead-of-iana-name"),
        pytest.param(dict(timezone="Mars/Olympus"), id="unknown-timezone"),
        pytest.param(dict(starts_at="2030-11-30T14:00:00"), id="naive-datetime"),
        pytest.param(dict(slug="Jazz Night"), id="slug-with-spaces"),
        pytest.param(dict(capacity=0), id="zero-capacity"),
        pytest.param(
            dict(
                registration_opens_at="2030-11-01T00:00:00Z",
                registration_closes_at="2030-10-01T00:00:00Z",
            ),
            id="registration-closes-before-it-opens",
        ),
    ],
)
def test_create_event_rejects_invalid_input(api, organizer, overrides):
    user, _ = organizer

    response = api.post(EVENTS, json=event_payload(**overrides), headers=auth(user))

    assert response.status_code == 422


# --- public reads -----------------------------------------------------------


def test_list_events_shows_only_published_public_events_that_have_not_ended(api, db, organizer):
    _, profile = organizer
    add_event(db, profile, slug="live", status=EventStatus.PUBLISHED)
    add_event(db, profile, slug="draft")
    add_event(db, profile, slug="hidden", status=EventStatus.PUBLISHED, visibility="unlisted")
    add_event(
        db,
        profile,
        slug="over",
        status=EventStatus.PUBLISHED,
        starts_at=datetime(2020, 1, 1, 10, tzinfo=UTC),
        ends_at=datetime(2020, 1, 1, 12, tzinfo=UTC),
    )

    response = api.get(EVENTS)

    assert response.status_code == 200
    assert [e["slug"] for e in response.json()] == ["live"]


def test_list_events_rejects_an_oversized_page(api):
    assert api.get(EVENTS, params={"limit": 101}).status_code == 422


def test_read_event_hides_drafts(api, db, organizer):
    _, profile = organizer
    add_event(db, profile)

    assert api.get(f"{EVENTS}/jazz-night-almaty").status_code == 404


@pytest.mark.parametrize("visibility", list(EventVisibility))
def test_read_event_reaches_a_published_event_by_link_whatever_its_visibility(
    api, db, organizer, visibility
):
    _, profile = organizer
    add_event(db, profile, status=EventStatus.PUBLISHED, visibility=visibility)

    response = api.get(f"{EVENTS}/jazz-night-almaty")

    assert response.status_code == 200
    assert response.json()["visibility"] == visibility


# --- organizer --------------------------------------------------------------


def test_list_my_events_returns_only_the_callers_events(api, db, organizer):
    user, profile = organizer
    _, other = add_organizer(db, "other@example.com")
    add_event(db, profile, slug="mine")
    add_event(db, other, slug="theirs")

    response = api.get(MY_EVENTS, headers=auth(user))

    assert response.status_code == 200
    assert [e["slug"] for e in response.json()] == ["mine"]


def test_update_event_changes_only_the_fields_sent(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, description="Old")

    response = api.patch(
        f"{MY_EVENTS}/{event.id}", json={"title": "Jazz Night II"}, headers=auth(user)
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Jazz Night II"
    assert response.json()["description"] == "Old"


def test_update_event_cannot_change_status(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)

    response = api.patch(
        f"{MY_EVENTS}/{event.id}", json={"status": "published"}, headers=auth(user)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "draft"


def test_update_event_returns_404_for_someone_elses_event(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    intruder, _ = add_organizer(db, "intruder@example.com")

    response = api.patch(
        f"{MY_EVENTS}/{event.id}", json={"title": "Mine now"}, headers=auth(intruder)
    )

    assert response.status_code == 404


def test_update_event_rejects_an_end_before_the_stored_start(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)

    response = api.patch(
        f"{MY_EVENTS}/{event.id}",
        json={"ends_at": "2030-11-30T13:00:00Z"},
        headers=auth(user),
    )

    assert response.status_code == 422


def test_update_event_refuses_a_cancelled_event(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.CANCELLED)

    response = api.patch(f"{MY_EVENTS}/{event.id}", json={"title": "Back"}, headers=auth(user))

    assert response.status_code == 409


def test_create_event_ignores_a_client_supplied_published_at(api, organizer):
    # Extra keys are ignored rather than rejected; this pins that behaviour so
    # a future `extra="allow"` cannot quietly reopen the status hole.
    user, _ = organizer

    response = api.post(
        EVENTS, json=event_payload(published_at="2030-01-01T00:00:00Z"), headers=auth(user)
    )

    assert response.json()["published_at"] is None

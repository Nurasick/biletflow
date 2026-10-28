from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.event import EventStatus
from app.models.organizer import OrganizerProfile
from app.models.user import User
from tests.test_events import add_event, add_organizer, auth
from tests.test_ticket_types import add_ticket_type

PUBLISH = "/api/v1/organizer/events/{event_id}/publish"


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


def test_publish_moves_draft_to_published_and_stamps_published_at(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    add_ticket_type(db, event.id)

    response = api.post(PUBLISH.format(event_id=event.id), headers=auth(user))

    assert response.status_code == 200
    assert response.json()["status"] == "published"
    db.refresh(event)
    assert event.published_at is not None


def test_publish_requires_a_visible_ticket_type(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    add_ticket_type(db, event.id, is_hidden=True)

    response = api.post(PUBLISH.format(event_id=event.id), headers=auth(user))

    assert response.status_code == 409
    assert "ticket type" in response.json()["detail"]
    db.refresh(event)
    assert event.status == EventStatus.DRAFT


def test_publish_refuses_an_event_that_already_started(api, db, organizer):
    user, profile = organizer
    past = datetime.now(UTC) - timedelta(days=1)
    event = add_event(db, profile, starts_at=past, ends_at=past + timedelta(hours=2))
    add_ticket_type(db, event.id)

    response = api.post(PUBLISH.format(event_id=event.id), headers=auth(user))

    assert response.status_code == 409
    assert "future" in response.json()["detail"]


@pytest.mark.parametrize("status", [EventStatus.PUBLISHED, EventStatus.CANCELLED])
def test_publish_only_works_from_draft(api, db, organizer, status):
    user, profile = organizer
    event = add_event(db, profile, status=status)
    add_ticket_type(db, event.id)

    response = api.post(PUBLISH.format(event_id=event.id), headers=auth(user))

    assert response.status_code == 409


def test_publish_returns_404_for_someone_elses_event(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    add_ticket_type(db, event.id)
    intruder, _ = add_organizer(db, "intruder@example.com")

    response = api.post(PUBLISH.format(event_id=event.id), headers=auth(intruder))

    assert response.status_code == 404
    db.refresh(event)
    assert event.status == EventStatus.DRAFT

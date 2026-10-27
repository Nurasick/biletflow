"""Event images (§4.2, audit finding #14): stored as files, checked by content."""

import base64

import pytest
from sqlalchemy.orm import Session

from app.core.config import settings
from tests.test_events import add_event, add_organizer, auth

IMAGES = "/api/v1/organizer/events/{event_id}/images"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def data_url(content: bytes, content_type: str = "image/png") -> str:
    return f"data:{content_type};base64,{base64.b64encode(content).decode()}"


@pytest.fixture(autouse=True)
def media(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def owned(db: Session):
    user, profile = add_organizer(db, "org@example.com")
    return user, add_event(db, profile)


def test_upload_stores_the_file_and_sets_the_cover(api, db, owned, media):
    user, event = owned

    response = api.post(
        IMAGES.format(event_id=event.id), headers=auth(user), json={"data_url": data_url(PNG)}
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["position"] == 0 and body["url"].endswith(".png")
    stored = list(media.rglob("*.png"))
    assert len(stored) == 1 and stored[0].read_bytes() == PNG
    db.refresh(event)
    assert event.cover_image_url == body["url"]


def test_content_that_does_not_match_its_declared_type_is_refused(api, owned, media):
    user, event = owned

    response = api.post(
        IMAGES.format(event_id=event.id),
        headers=auth(user),
        json={"data_url": data_url(b"<html>not an image</html>")},
    )

    assert response.status_code == 422
    assert list(media.rglob("*.*")) == []


def test_at_most_five_images(api, owned, monkeypatch):
    user, event = owned
    url = IMAGES.format(event_id=event.id)
    for _ in range(settings.MAX_EVENT_IMAGES):
        api.post(url, headers=auth(user), json={"data_url": data_url(JPEG, "image/jpeg")})

    response = api.post(url, headers=auth(user), json={"data_url": data_url(PNG)})

    assert response.status_code == 409


def test_deleting_the_cover_promotes_the_next_image(api, db, owned, media):
    user, event = owned
    url = IMAGES.format(event_id=event.id)
    first = api.post(url, headers=auth(user), json={"data_url": data_url(PNG)}).json()
    second = api.post(
        url, headers=auth(user), json={"data_url": data_url(JPEG, "image/jpeg")}
    ).json()

    assert api.delete(f"{url}/{first['id']}", headers=auth(user)).status_code == 204

    remaining = api.get(url, headers=auth(user)).json()
    assert [(i["id"], i["position"]) for i in remaining] == [(second["id"], 0)]
    db.refresh(event)
    assert event.cover_image_url == second["url"]
    assert len(list(media.rglob("*.*"))) == 1


def test_public_event_page_includes_images(api, db, owned):
    user, event = owned
    event.status = "published"
    db.commit()
    api.post(IMAGES.format(event_id=event.id), headers=auth(user), json={"data_url": data_url(PNG)})

    body = api.get(f"/api/v1/events/{event.slug}").json()

    assert len(body["images"]) == 1
    assert body["organizer_name"] == "Jazz KZ"
    assert body["paid_sales_active"] is False

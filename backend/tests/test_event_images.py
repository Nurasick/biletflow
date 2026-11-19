"""Event images (§4.2, audit finding #14): stored as files, checked by content."""

import base64
from urllib.parse import parse_qs, urlsplit

import pytest
from boto3.session import Session as AwsSession
from botocore.stub import ANY, Stubber
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.main import create_app
from app.services import storage
from tests.test_events import add_event, add_organizer, auth

IMAGES = "/api/v1/organizer/events/{event_id}/images"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def data_url(content: bytes, content_type: str = "image/png") -> str:
    return f"data:{content_type};base64,{base64.b64encode(content).decode()}"


@pytest.fixture(autouse=True)
def media(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_ROOT", str(tmp_path))
    monkeypatch.setattr(settings, "AWS_S3_BUCKET", "")
    return tmp_path


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setattr(settings, "AWS_S3_BUCKET", "biletflow-test")
    monkeypatch.setattr(settings, "AWS_REGION", "ap-southeast-2")
    monkeypatch.setattr(
        storage,
        "Session",
        lambda: AwsSession(aws_access_key_id="test", aws_secret_access_key="test"),
    )
    storage._s3_client.cache_clear()
    try:
        with Stubber(storage._s3_client(settings.AWS_REGION)) as stubber:
            yield stubber
            stubber.assert_no_pending_responses()
    finally:
        storage._s3_client.cache_clear()


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


def test_s3_photo_upload_redirect_and_deletion(api, owned, media, s3):
    user, event = owned
    uploads = IMAGES.format(event_id=event.id)
    s3.add_response(
        "put_object",
        {},
        {"Bucket": "biletflow-test", "Key": ANY, "Body": PNG, "ContentType": "image/png"},
    )

    response = api.post(uploads, headers=auth(user), json={"data_url": data_url(PNG)})

    assert response.status_code == 201, response.text
    image = response.json()
    path = urlsplit(image["url"]).path
    prefix = f"{settings.MEDIA_URL_PATH}/"
    assert path.startswith(f"{prefix}s3/events/{event.id}/")
    assert not list(media.rglob("*.png"))

    redirect = api.get(path, follow_redirects=False)
    assert redirect.status_code == 307
    assert redirect.headers["Cache-Control"] == "no-store"
    signed = urlsplit(redirect.headers["Location"])
    assert signed.scheme == "https"
    assert signed.hostname == "biletflow-test.s3.ap-southeast-2.amazonaws.com"
    key = path.removeprefix(f"{prefix}s3/")
    assert signed.path == f"/{key}"
    assert parse_qs(signed.query)["X-Amz-Expires"] == ["300"]

    s3.add_response("delete_object", {}, {"Bucket": "biletflow-test", "Key": key})
    assert api.delete(f"{uploads}/{image['id']}", headers=auth(user)).status_code == 204
    assert api.get(path, follow_redirects=False).status_code == 404


def test_failed_s3_upload_leaves_gallery_empty(api, owned, s3):
    user, event = owned
    uploads = IMAGES.format(event_id=event.id)
    s3.add_client_error("put_object", service_error_code="AccessDenied", http_status_code=403)

    response = api.post(uploads, headers=auth(user), json={"data_url": data_url(PNG)})

    assert response.status_code == 503
    assert api.get(uploads, headers=auth(user)).json() == []


def test_disk_photo_still_serves_after_enabling_s3(monkeypatch):
    key, url = storage.save("events/1", PNG, "image/png")
    monkeypatch.setattr(settings, "AWS_S3_BUCKET", "biletflow-test")
    path = urlsplit(url).path

    with TestClient(create_app()) as client:
        response = client.get(path)
        assert response.status_code == 200
        assert response.content == PNG
        storage.delete(key)
        assert client.get(path).status_code == 404

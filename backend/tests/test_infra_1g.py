"""Tests for Section 1G: PostgreSQL sslmode engine configuration, S3-compatible
custom endpoints & path addressing style, and application-level field encryption."""

import base64
from urllib.parse import urlsplit

import pytest
from boto3.session import Session as AwsSession
from botocore.stub import ANY, Stubber
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.config import settings
from app.db.session import build_engine
from app.models.organizer import PayoutAccount
from app.services import storage
from tests.test_events import add_user, auth


def test_build_engine_applies_sslmode_only_for_postgres(monkeypatch):
    captured: dict = {}

    def fake_create_engine(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return object()

    import app.db.session as db_session

    monkeypatch.setattr(db_session, "create_engine", fake_create_engine)

    build_engine("postgresql+psycopg://u:p@host:5432/db", sslmode="require")
    assert captured["kwargs"]["connect_args"] == {"sslmode": "require"}

    build_engine("postgresql+psycopg://u:p@host:5432/db", sslmode="")
    assert captured["kwargs"]["connect_args"] == {}

    build_engine("sqlite://", sslmode="require")
    assert captured["kwargs"]["connect_args"] == {}


def test_s3_compatible_endpoint_and_path_addressing_style(monkeypatch):
    monkeypatch.setattr(settings, "AWS_S3_BUCKET", "biletflow-media")
    monkeypatch.setattr(settings, "AWS_REGION", "auto")
    monkeypatch.setattr(settings, "AWS_S3_ENDPOINT_URL", "https://minio.local:9000")
    monkeypatch.setattr(settings, "AWS_S3_ADDRESSING_STYLE", "path")
    monkeypatch.setattr(
        storage,
        "Session",
        lambda: AwsSession(aws_access_key_id="minioadmin", aws_secret_access_key="minioadmin"),
    )
    storage._s3_client.cache_clear()
    try:
        client = storage._s3_client(settings.AWS_REGION)
        with Stubber(client) as stubber:
            stubber.add_response(
                "put_object",
                {},
                {
                    "Bucket": "biletflow-media",
                    "Key": ANY,
                    "Body": b"\x89PNG\r\n\x1a\n1234",
                    "ContentType": "image/png",
                },
            )
            key, _url = storage.save("events/42", b"\x89PNG\r\n\x1a\n1234", "image/png")
            signed = urlsplit(storage.s3_read_url(key))
            assert signed.scheme == "https"
            assert signed.hostname == "minio.local"
            assert signed.port == 9000
            assert signed.path.startswith("/biletflow-media/events/42/")
            stubber.assert_no_pending_responses()
    finally:
        storage._s3_client.cache_clear()


def test_field_encryption_kms_roundtrip_and_payout_account_storage(api, db: Session, monkeypatch):
    # Register a deterministic reversible KMS stub to test end-to-end DB storage.
    def fake_enc(plain: str) -> str:
        return base64.urlsafe_b64encode(plain.encode("utf-8")).decode("ascii")

    def fake_dec(token: str) -> str:
        return base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")

    crypto.register_kms_provider(fake_enc, fake_dec)
    try:
        user = add_user(db, "enc-org@example.com")
        resp = api.put(
            "/api/v1/organizer/profile",
            json={
                "display_name": "Encrypted Org",
                "contact_email": "enc-org@example.com",
                "payout_provider": "sandbox_bank",
                "payout_reference": "demo_secret_acct_77",
            },
            headers=auth(user),
        )
        assert resp.status_code == 200, resp.text
        # API transparently returns decrypted payout reference.
        assert resp.json()["payout_account"]["external_account_ref"] == "demo_secret_acct_77"

        # Database stores ciphertext tagged with enc:v1:, never plaintext!
        stored = db.scalar(select(PayoutAccount.external_account_ref))
        assert stored is not None
        assert stored.startswith(crypto.ENC_PREFIX)
        assert "demo_secret_acct_77" not in stored

        # Saving the exact same payout reference again is idempotent (no redundant deactivation).
        resp2 = api.put(
            "/api/v1/organizer/profile",
            json={
                "display_name": "Encrypted Org Updated",
                "contact_email": "enc-org@example.com",
                "payout_provider": "sandbox_bank",
                "payout_reference": "demo_secret_acct_77",
            },
            headers=auth(user),
        )
        assert resp2.status_code == 200
        assert len(db.scalars(select(PayoutAccount)).all()) == 1
    finally:
        crypto.register_kms_provider(None, None)

    # Without KMS or Fernet key, reading an encrypted value fails closed.
    monkeypatch.setattr(settings, "FIELD_ENCRYPTION_KEY", "")
    with pytest.raises(crypto.EncryptionConfigurationError):
        crypto.decrypt_field(crypto.ENC_PREFIX + "abc")

"""Outgoing email (§9 "Transactional email provider", §2.1).

Three backends behind one `send()`:

- console (default): the message is written to the log, which is also how a
  developer clicks the link in it. Tests read `outbox` instead.
- SMTP, when SMTP_HOST is set (or EMAIL_PROVIDER=smtp). `docker compose up`
  points it at Mailpit, a local inbox at http://localhost:8025.
- Resend HTTP API, when RESEND_API_KEY is set (or EMAIL_PROVIDER=resend),
  supporting HTML bodies and base64-encoded PDF attachments without SMTP ports.

Callers that must not wait on email delivery (checkout, refunds) do not call
this directly: they queue a row with services.notify and the background sender
calls `send()` for them with automatic retry & exponential backoff.
"""

import base64
import json
import logging
import smtplib
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("biletflow.mail")


@dataclass(frozen=True)
class Attachment:
    filename: str
    content_type: str
    data: bytes


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    body: str
    html: str | None = None
    attachments: tuple[Attachment, ...] = ()


# Tests read this to fetch the link/attachments a flow "sent". Bounded so a
# long-running dev server does not grow it forever.
outbox: list[Message] = []
_OUTBOX_LIMIT = 100


def send(
    to: str,
    subject: str,
    body: str,
    *,
    html: str | None = None,
    attachments: Sequence[Attachment] = (),
) -> None:
    message = Message(to, subject, body, html=html, attachments=tuple(attachments))
    outbox.append(message)
    del outbox[:-_OUTBOX_LIMIT]
    logger.info(
        "email to %s: %s (attachments=%d)\n%s",
        to,
        subject,
        len(message.attachments),
        body,
    )
    provider = _active_provider()
    if provider == "resend":
        _send_resend(message)
    elif provider == "smtp":
        _send_smtp(message)


def _active_provider() -> str:
    mode = settings.EMAIL_PROVIDER
    if mode == "console":
        return "console"
    if mode == "resend":
        return "resend"
    if mode == "smtp":
        return "smtp"
    if settings.RESEND_API_KEY:
        return "resend"
    if settings.SMTP_HOST:
        return "smtp"
    return "console"


def _build_mime(message: Message) -> EmailMessage:
    email = EmailMessage()
    email["From"] = settings.MAIL_FROM
    email["To"] = message.to
    email["Subject"] = message.subject
    email.set_content(message.body)
    if message.html:
        email.add_alternative(message.html, subtype="html")
    for attachment in message.attachments:
        if "/" in attachment.content_type:
            maintype, subtype = attachment.content_type.split("/", 1)
        else:
            maintype, subtype = "application", "octet-stream"
        email.add_attachment(
            attachment.data,
            maintype=maintype,
            subtype=subtype,
            filename=attachment.filename,
        )
    return email


def _send_smtp(message: Message) -> None:
    email = _build_mime(message)
    # A short timeout: an unreachable mail server must fail this one send, not
    # hang the worker thread that is running it.
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        if settings.SMTP_STARTTLS:
            smtp.starttls()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(email)


def _send_resend(message: Message) -> None:
    if not settings.RESEND_API_KEY:
        raise RuntimeError("EMAIL_PROVIDER=resend requires RESEND_API_KEY")
    payload: dict = {
        "from": settings.MAIL_FROM,
        "to": [message.to],
        "subject": message.subject,
        "text": message.body,
    }
    if message.html:
        payload["html"] = message.html
    if message.attachments:
        payload["attachments"] = [
            {
                "filename": att.filename,
                "content": base64.b64encode(att.data).decode("ascii"),
                "content_type": att.content_type,
            }
            for att in message.attachments
        ]
    req = urllib.request.Request(
        settings.RESEND_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "BiletFlow/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status >= 400:
            raise RuntimeError(f"Resend API returned HTTP {resp.status}")

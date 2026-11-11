"""Outgoing email (§9 "Transactional email provider", §2.1).

Two backends behind one `send()`:

- console (default): the message is written to the log, which is also how a
  developer clicks the link in it. Tests read `outbox` instead.
- SMTP, when SMTP_HOST is set. `docker compose up` points it at Mailpit, a
  local inbox at http://localhost:8025, so a demo shows real emails arriving
  without any real address ever being mailed.

Callers that must not wait on SMTP (checkout, refunds) do not call this
directly: they queue a row with services.notify and the background sender
calls `send()` for them.
"""

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("biletflow.mail")


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    body: str


# Tests read this to fetch the link a flow "sent". Bounded so a long-running
# dev server does not grow it forever.
outbox: list[Message] = []
_OUTBOX_LIMIT = 100


def send(to: str, subject: str, body: str) -> None:
    message = Message(to, subject, body)
    outbox.append(message)
    del outbox[:-_OUTBOX_LIMIT]
    logger.info("email to %s: %s\n%s", to, subject, body)
    if settings.SMTP_HOST:
        _send_smtp(message)


def _send_smtp(message: Message) -> None:
    email = EmailMessage()
    email["From"] = settings.MAIL_FROM
    email["To"] = message.to
    email["Subject"] = message.subject
    email.set_content(message.body)
    # A short timeout: an unreachable mail server must fail this one send, not
    # hang the worker thread that is running it.
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
        if settings.SMTP_STARTTLS:
            smtp.starttls()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(email)

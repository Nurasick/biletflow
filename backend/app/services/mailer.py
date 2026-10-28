"""Outgoing email. A console backend until a provider is chosen (§9, §2.1).

The notifications slice (07) will put a queue in front of this; until then the
few emails the account flows need are sent inline. In local and test runs the
message is written to the log, which is also how a developer clicks the link.
"""

import logging
from dataclasses import dataclass

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

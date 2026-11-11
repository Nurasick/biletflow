"""Calendar export (§4.11, UC6): one event as a standard iCalendar file.

The requirements, each of which is a line in the file below:

- "a stable event identifier so updated event details can replace an earlier
  calendar entry"  ->  UID never changes; SEQUENCE grows with every edit.
- "preserve the event's configured time zone"  ->  DTSTART;TZID=Asia/Almaty,
  the wall-clock time the organizer typed, not a UTC instant.
- "when an event is cancelled ... an updated cancellation calendar file"  ->
  the same UID with STATUS:CANCELLED and METHOD:CANCEL.
- "shall not require ... write access to an attendee's calendar account"  ->
  it is a file the attendee opens themselves. Nothing is pushed anywhere.

Written by hand against RFC 5545 rather than with a library: it is forty
lines, and the two rules that trip people up (escaping and 75-octet line
folding) are easier to test when they are visible.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.clock import as_utc, utcnow
from app.core.config import settings
from app.models.event import Event, EventStatus


def event_url(event: Event) -> str:
    return f"{settings.PUBLIC_WEB_URL.rstrip('/')}/events/{event.slug}"


def build(event: Event, now: datetime | None = None) -> str:
    now = now or utcnow()
    zone = ZoneInfo(event.timezone)
    start = as_utc(event.starts_at).astimezone(zone)
    end = as_utc(event.ends_at).astimezone(zone)
    cancelled = event.status == EventStatus.CANCELLED
    updated = as_utc(event.updated_at) if event.updated_at else now
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//BiletFlow//Events//EN",
        "CALSCALE:GREGORIAN",
        f"METHOD:{'CANCEL' if cancelled else 'PUBLISH'}",
        *_vtimezone(event.timezone, start),
        "BEGIN:VEVENT",
        # Stable for the life of the event: a calendar that already has this
        # UID replaces its entry instead of adding a second one.
        f"UID:event-{event.id}@biletflow",
        f"DTSTAMP:{now:%Y%m%dT%H%M%SZ}",
        # Whole seconds since the epoch of the last edit: strictly increasing,
        # which is all a calendar needs to know which copy is newer.
        f"SEQUENCE:{int(updated.timestamp())}",
        f"DTSTART;TZID={event.timezone}:{start:%Y%m%dT%H%M%S}",
        f"DTEND;TZID={event.timezone}:{end:%Y%m%dT%H%M%S}",
        f"SUMMARY:{_escape(event.title)}",
        f"LOCATION:{_escape(f'{event.venue_name}, {event.venue_address}')}",
        f"DESCRIPTION:{_escape(_description(event))}",
        f"URL:{event_url(event)}",
        f"STATUS:{'CANCELLED' if cancelled else 'CONFIRMED'}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    # RFC 5545 §3.1: CRLF line endings, including after the last line.
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


def _description(event: Event) -> str:
    text = (event.description or "").strip()
    return f"{text}\n\n{event_url(event)}".strip()


def _vtimezone(name: str, at: datetime) -> list[str]:
    """A minimal definition of the zone at the time of the event.

    Calendar apps recognise IANA names on their own; this block is for the
    ones that insist a TZID be defined in the file. One fixed offset is exact
    for Kazakhstan, which has no daylight saving time.
    """
    offset = at.utcoffset() or timedelta()
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    hhmm = f"{sign}{abs(minutes) // 60:02d}{abs(minutes) % 60:02d}"
    return [
        "BEGIN:VTIMEZONE",
        f"TZID:{name}",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        f"TZOFFSETFROM:{hhmm}",
        f"TZOFFSETTO:{hhmm}",
        f"TZNAME:{at.tzname() or name}",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]


def _escape(text: str) -> str:
    # RFC 5545 §3.3.11. Backslash first, or the others get escaped twice.
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    """Lines longer than 75 octets continue on the next line after a space.

    Octets, not characters: a Cyrillic letter is two bytes in UTF-8, and a
    multi-byte character must never be split across the fold.
    """
    parts: list[str] = []
    current = ""
    size = 0
    limit = 75
    for char in line:
        width = len(char.encode("utf-8"))
        if size + width > limit:
            parts.append(current)
            current, size = "", 0
            limit = 74  # continuation lines start with one space
        current += char
        size += width
    parts.append(current)
    return "\r\n ".join(parts)

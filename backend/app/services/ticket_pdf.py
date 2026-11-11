"""Printable tickets (§4.7, UC7): a server-generated PDF, one A4 page per ticket.

Built from the canonical ticket record (§9), not from whatever the browser
happens to be showing, so the paper copy and the on-screen copy are the same
ticket: one public_code, one QR payload, one admission.

What makes the page scannable from paper, including a grayscale printout:

- the QR is drawn as vector squares, pure black on white, never an image that
  a printer driver may dither;
- error correction level Q (25 % of the code can be damaged) and the standard
  four-module quiet zone;
- it is 70 mm wide, so each module is over 1 mm even for our longest payload.

Nothing about the payment is printed (§4.7: no card details on the ticket).
"""

import io
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

import segno
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

from app.core.clock import as_utc

QR_SIZE = 70 * mm
QUIET_ZONE = 4  # modules, per the QR specification

# Event titles and attendee names are Kazakh and Russian, and the PDF's
# built-in Helvetica has no Cyrillic. The first font found here is embedded.
# The Docker image installs DejaVu; the Windows and macOS paths cover
# development machines.
_FONT_CANDIDATES: tuple[tuple[str, str], ...] = (
    (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
    (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ),
)


@dataclass(frozen=True)
class PrintableTicket:
    """Everything §4.7 says a printed ticket shall include."""

    public_code: str
    qr_payload: str
    event_title: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    venue_name: str
    venue_address: str
    ticket_type_name: str
    attendee_name: str
    order_number: str
    # Section / row / seat for assigned seating; None for general admission.
    seat_label: str | None = None


@lru_cache(maxsize=1)
def _fonts() -> tuple[str, str]:
    """(regular, bold) font names, registering a Unicode font once if one exists."""
    for regular, bold in _FONT_CANDIDATES:
        if Path(regular).exists() and Path(bold).exists():
            pdfmetrics.registerFont(TTFont("Ticket", regular))
            pdfmetrics.registerFont(TTFont("Ticket-Bold", bold))
            return "Ticket", "Ticket-Bold"
    # No Unicode font on this machine: Latin text still renders correctly.
    return "Helvetica", "Helvetica-Bold"


def render(tickets: list[PrintableTicket]) -> bytes:
    """A PDF with one page per ticket."""
    buffer = io.BytesIO()
    canvas = Canvas(buffer, pagesize=A4)
    canvas.setTitle("BiletFlow tickets")
    canvas.setAuthor("BiletFlow")
    for ticket in tickets:
        _page(canvas, ticket)
        canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def _page(canvas: Canvas, ticket: PrintableTicket) -> None:
    regular, bold = _fonts()
    width, height = A4
    left, right = 20 * mm, width - 20 * mm
    y = height - 25 * mm

    canvas.setFillGray(0)
    canvas.setFont(bold, 20)
    canvas.drawString(left, y, "BiletFlow")
    canvas.setFont(regular, 9)
    canvas.drawRightString(right, y, "ADMISSION TICKET · БИЛЕТ")
    y -= 5 * mm
    canvas.setLineWidth(1.2)
    canvas.line(left, y, right, y)

    y -= 14 * mm
    canvas.setFont(bold, 18)
    for line in _wrap(ticket.event_title, bold, 18, right - left)[:3]:
        canvas.drawString(left, y, line)
        y -= 8 * mm

    # Left column: the facts. Right column: the QR. They share the top edge.
    top = y - 4 * mm
    qr_left = right - QR_SIZE
    text_width = qr_left - left - 8 * mm
    y = top
    for label, value in _fields(ticket):
        canvas.setFont(regular, 8)
        canvas.setFillGray(0.35)
        canvas.drawString(left, y, label.upper())
        y -= 5 * mm
        canvas.setFillGray(0)
        canvas.setFont(bold, 12)
        for line in _wrap(value, bold, 12, text_width)[:3]:
            canvas.drawString(left, y, line)
            y -= 5.5 * mm
        y -= 3 * mm

    _qr(canvas, ticket.qr_payload, qr_left, top - QR_SIZE + 4 * mm)
    canvas.setFont(bold, 13)
    canvas.drawCentredString(qr_left + QR_SIZE / 2, top - QR_SIZE - 4 * mm, ticket.public_code)

    y = min(y, top - QR_SIZE - 12 * mm) - 4 * mm
    canvas.setLineWidth(0.5)
    canvas.setDash(3, 3)
    canvas.line(left, y, right, y)
    canvas.setDash()
    y -= 8 * mm
    canvas.setFont(regular, 9)
    canvas.setFillGray(0.25)
    for note in (
        "Show this QR code at the entrance. Покажите этот QR-код на входе. "
        "Осы QR-кодты кіреберісте көрсетіңіз.",
        "One ticket admits one person once: a printed copy and the copy on your "
        "phone are the same ticket.",
        f"Order {ticket.order_number} · Ticket {ticket.public_code}",
    ):
        for line in _wrap(note, regular, 9, right - left):
            canvas.drawString(left, y, line)
            y -= 4.6 * mm
    canvas.setFillGray(0)


def _fields(ticket: PrintableTicket) -> list[tuple[str, str]]:
    zone = ZoneInfo(ticket.timezone)
    start = as_utc(ticket.starts_at).astimezone(zone)
    end = as_utc(ticket.ends_at).astimezone(zone)
    same_day = start.date() == end.date()
    when = (
        f"{start:%d.%m.%Y %H:%M} – {end:%H:%M}"
        if same_day
        else (f"{start:%d.%m.%Y %H:%M} – {end:%d.%m.%Y %H:%M}")
    )
    fields = [
        ("Date and time · Дата и время", f"{when} ({ticket.timezone})"),
        ("Venue · Место", f"{ticket.venue_name}, {ticket.venue_address}"),
        ("Ticket type · Тип билета", ticket.ticket_type_name),
        ("Attendee · Участник", ticket.attendee_name),
    ]
    if ticket.seat_label:
        fields.append(("Section / row / seat · Место в зале", ticket.seat_label))
    return fields


def _qr(canvas: Canvas, payload: str, x: float, y: float) -> None:
    """Draw the code as filled vector squares with its quiet zone."""
    matrix = [list(row) for row in segno.make(payload, error="q", micro=False).matrix]
    modules = len(matrix) + 2 * QUIET_ZONE
    cell = QR_SIZE / modules
    canvas.setFillGray(1)
    canvas.rect(x, y, QR_SIZE, QR_SIZE, stroke=0, fill=1)
    canvas.setFillGray(0)
    for row_index, row in enumerate(matrix):
        for column_index, dark in enumerate(row):
            if not dark:
                continue
            # PDF's origin is bottom-left; the matrix's first row is the top.
            canvas.rect(
                x + (column_index + QUIET_ZONE) * cell,
                y + QR_SIZE - (row_index + QUIET_ZONE + 1) * cell,
                # A hair wider than a cell, so viewers that anti-alias do not
                # show white seams between adjacent dark modules.
                cell * 1.02,
                cell * 1.02,
                stroke=0,
                fill=1,
            )


def _wrap(text: str, font: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if pdfmetrics.stringWidth(candidate, font, size) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]

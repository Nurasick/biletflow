"""The Campaign QR image (§4.14): a poster-ready SVG.

§4.14 requires it to be "visually and functionally distinct from an
admission-ticket QR code". Functionally it encodes a web link, which the door
scanner rejects at its first step. Visually it is everything a ticket QR is
not: orange instead of black, framed, and labelled in three languages as a
promo code that does not admit anyone.

SVG rather than PNG because posters get scaled, and vector squares stay sharp
at any size. The text is escaped: the campaign code is organizer input.
"""

from html import escape

import segno

ORANGE = "#D9431F"
MODULE = 8  # px per QR module
QUIET_ZONE = 4
PADDING = 28
HEADER = 64
FOOTER = 92


def svg(link: str, code: str, event_title: str) -> str:
    matrix = [list(row) for row in segno.make(link, error="m", micro=False).matrix]
    size = (len(matrix) + 2 * QUIET_ZONE) * MODULE
    width = size + 2 * PADDING
    height = HEADER + size + FOOTER
    squares = "".join(
        f'<rect x="{PADDING + (x + QUIET_ZONE) * MODULE}" '
        f'y="{HEADER + (y + QUIET_ZONE) * MODULE}" width="{MODULE}" height="{MODULE}"/>'
        for y, row in enumerate(matrix)
        for x, dark in enumerate(row)
        if dark
    )
    centre = width / 2
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'width="{width}" height="{height}" role="img" '
        f'aria-label="Promo code {escape(code)}: not an admission ticket">'
        f'<rect width="{width}" height="{height}" rx="24" fill="{ORANGE}"/>'
        f'<text x="{centre}" y="28" text-anchor="middle" font-family="Arial, sans-serif" '
        f'font-size="19" font-weight="700" fill="#fff">PROMO CODE · ПРОМОКОД</text>'
        f'<text x="{centre}" y="50" text-anchor="middle" font-family="Arial, sans-serif" '
        f'font-size="13" fill="#fff">NOT A TICKET · НЕ БИЛЕТ · БИЛЕТ ЕМЕС</text>'
        f'<rect x="{PADDING}" y="{HEADER}" width="{size}" height="{size}" rx="12" fill="#fff"/>'
        f'<g fill="{ORANGE}">{squares}</g>'
        f'<text x="{centre}" y="{HEADER + size + 40}" text-anchor="middle" '
        f'font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#fff" '
        f'letter-spacing="2">{escape(code)}</text>'
        f'<text x="{centre}" y="{HEADER + size + 68}" text-anchor="middle" '
        f'font-family="Arial, sans-serif" font-size="14" fill="#fff">'
        f"{escape(event_title[:48])}</text>"
        "</svg>"
    )

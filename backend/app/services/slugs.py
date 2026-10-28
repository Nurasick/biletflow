"""Turning an event title into a URL slug (`events.slug`, 02-events.md).

Titles here are as often Kazakh or Russian as English, and a slug of only
the Latin letters would turn "Джаз кеші" into nothing. So Cyrillic is
transliterated first, with the Kazakh letters included.
"""

import re
import unicodedata

_CYRILLIC = {
    "а": "a", "ә": "a", "б": "b", "в": "v", "г": "g", "ғ": "g", "д": "d", "е": "e",
    "ё": "yo", "ж": "zh", "з": "z", "и": "i", "й": "y", "і": "i", "к": "k", "қ": "q",
    "л": "l", "м": "m", "н": "n", "ң": "n", "о": "o", "ө": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ұ": "u", "ү": "u", "ф": "f", "х": "kh", "һ": "h",
    "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e",
    "ю": "yu", "я": "ya",
}  # fmt: skip

MAX_BASE = 80


def slugify(text: str) -> str:
    """'Jazz Night — Алматы!' -> 'jazz-night-almaty'. Never empty: falls back to 'event'."""
    lowered = "".join(_CYRILLIC.get(ch, ch) for ch in text.lower())
    # Strip accents (é -> e), then drop anything still outside a-z0-9.
    ascii_only = unicodedata.normalize("NFKD", lowered).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")[:MAX_BASE].strip("-")
    return slug if len(slug) >= 3 else f"event-{slug}".strip("-")

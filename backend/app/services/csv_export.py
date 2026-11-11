"""CSV downloads (§4.12 "Export basic operational reports").

One helper so every export is encoded the same way: UTF-8 with a byte-order
mark, because without it Excel opens Kazakh and Russian text as mojibake.
"""

import csv
import io
from collections.abc import Iterable, Sequence

from fastapi import Response

_FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def _safe(value: object) -> object:
    """Stop spreadsheet formula injection: a name that begins with "=" would
    otherwise run as a formula when an admin opens the export."""
    if isinstance(value, str) and value.startswith(_FORMULA_STARTS):
        return "'" + value
    return value


def csv_response(filename: str, header: Sequence[str], rows: Iterable[Sequence]) -> Response:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        writer.writerow([_safe(value) for value in row])
    return Response(
        "﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )

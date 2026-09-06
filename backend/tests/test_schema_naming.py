from collections.abc import Iterator

import pytest

from app.db.base import Base

PG_IDENTIFIER_LIMIT = 63


def _identifiers() -> Iterator[str]:
    for table in Base.metadata.tables.values():
        yield table.name
        for c in table.constraints:
            if c.name is not None and not str(c.name).startswith("_"):
                yield str(c.name)
        for i in table.indexes:
            yield str(i.name)


@pytest.mark.parametrize("name", sorted(set(_identifiers())))
def test_identifier_fits_postgres_limit(name):
    assert len(name) <= PG_IDENTIFIER_LIMIT, f"{name!r} is {len(name)} chars"

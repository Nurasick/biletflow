# BiletFlow Backend (FastAPI + PostgreSQL 17)

The backend API service for BiletFlow, built with **FastAPI**, **SQLAlchemy 2.0**, **Alembic**, and **PostgreSQL 17**.

## Structure

```
backend/
├── app/
│   ├── alembic/          # Reversible Alembic schema migrations
│   ├── api/v1/routes/    # HTTP routers (auth, events, orders, seating, check-in, support, admin, ...)
│   ├── core/             # Config, JWT/Argon2id security, QR signing, clock, field crypto
│   ├── db/               # Engine/session builder and model registry (base.py)
│   ├── models/           # SQLAlchemy 2.0 models with explicit CHECK & partial unique constraints
│   ├── schemas/          # Pydantic v2 request/response contracts
│   └── services/         # Domain logic (holds, orders, seating, payments, analytics, PDF, ICS, email)
├── scripts/
│   ├── backup_db.sh      # Compressed pg_dump + SHA-256 verification + retention pruning
│   ├── export_openapi.py # Generates ../docs/openapi.json from the FastAPI app
│   ├── seed_demo.py      # The one demo seeder: scenarios, public catalog, seating gala, support
│   ├── seed_catalog.py   # The 15 public catalog listings used by seed_demo.py
│   ├── seed_media.py     # Event photos from seed_assets/ (generated poster as fallback)
│   └── seed_assets/      # Event photos, one folder per event slug
└── tests/                # Unit, integration, API, and multi-threaded PostgreSQL concurrency tests
```

## Local Setup

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Interactive OpenAPI documentation is served at `http://localhost:8000/docs`.

## Seed Demo Data

```bash
cd backend
uv run python scripts/seed_demo.py
```

Seeds sample accounts, events (including an assigned-seating event at the predefined **Palace of the Republic — Main Hall** venue in Almaty), ticket types, and promo campaigns idempotently.

## Testing & Quality Checks

```bash
cd backend

# Lint & formatting
uv run ruff check .
uv run ruff format --check .

# Fast local test run (in-memory SQLite + Postgres concurrency tests if DATABASE_URL is reachable)
uv run pytest

# Full PostgreSQL 17 parity run (same mode used in GitHub Actions CI)
TEST_USE_POSTGRES=1 uv run pytest

# Verify Alembic migrations apply cleanly and reverse to base
uv run alembic downgrade base && uv run alembic upgrade head

# Regenerate the shared OpenAPI contract after schema/route changes
uv run python scripts/export_openapi.py
```

## Database Backups

See [`../docs/backup-recovery.md`](../docs/backup-recovery.md) for scheduled backups, encryption at rest, and restore verification commands using `scripts/backup_db.sh`.

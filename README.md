# BiletFlow

BiletFlow is a full-stack event ticketing platform built for **attendees**, **event organizers**, **door check-in staff**, and **platform administrators**. Attendees discover public or invite-only events, reserve general-admission or assigned seats with promotional codes, complete simulated checkout, receive printable QR/PDF tickets and one-click calendar exports, and open support threads; organizers manage events, paid-sales activation, campaigns, payouts, and real-time analytics; gate staff scan and verify tickets on web or mobile; and platform admins oversee moderation, disputes, escalations, and operational reporting across Kazakh (`kk`), Russian (`ru`), and English (`en`).

## Stack

| Part | Tech |
|---|---|
| Backend | FastAPI, SQLAlchemy 2.x, Alembic, PostgreSQL 17 |
| Web | Vite + React 19 + TypeScript + Tailwind |
| Mobile | Expo (React Native) — iOS, Android & Web |
| Tooling | uv, ruff, pytest, Docker Compose, Caddy TLS, GitHub Actions |

## Repository layout

```
backend/     FastAPI service — API, business rules, Alembic migrations, PDF/QR/email services
web/         Web client (attendee, organizer, staff & admin portals)
mobile/      Expo React Native app (attendee flows + door QR ticket scanner)
docs/        Data model, state machines, OpenAPI contract, ADR, backup & demo guides
```

The API contract is committed at [`docs/openapi.json`](docs/openapi.json). It is generated from the backend, never edited by hand, and CI fails if it drifts from the code. Web and mobile build against that file.

## Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- [uv](https://docs.astral.sh/uv/) — for backend work outside Docker
- Node.js 22+ — for web and mobile

## Quickstart (Development)

```bash
git clone <repo-url>
cd biletflow
cp .env.example .env    # generate SECRET_KEY and review settings
docker compose up --build
```

Compose waits for PostgreSQL, applies Alembic migrations, and then starts the API. If a migration fails, the API does not start. The web app is available at `http://localhost:5173`, the API docs at `http://localhost:8000/docs`, and local development emails arrive in Mailpit at `http://localhost:8025`.

For web development alone, run `docker compose up -d --build web`. The web server forwards `/api/` and `/media/` to FastAPI. Open `http://localhost:5173/api/v1/health` to verify the connection through the web server.

## Production Deployment

Production uses `docker-compose.prod.yml` with the hardened Nginx `runtime` target, multi-worker `uvicorn`, non-root containers, isolated `internal` database networking, automated Alembic migration gating, and a Caddy TLS reverse proxy (`:80` → `:443` redirect + HSTS):

```bash
cp .env.example .env    # set strong POSTGRES_PASSWORD, SECRET_KEY, TLS_DOMAIN, CORS_ORIGINS, DB_SSLMODE
docker compose -f docker-compose.prod.yml up -d --build
```

See [`docs/backup-recovery.md`](docs/backup-recovery.md) for encryption at rest, automated backups (`backend/scripts/backup_db.sh`), and restore verification drills.

## Environment

Copy `.env.example` to `.env` and fill in the required values. `.env` is gitignored and must never be committed.

Generate a `SECRET_KEY` with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

For host development, `DATABASE_URL` uses `localhost:5433` (published by `docker-compose.yml`). Compose overrides it to `db:5432` inside the API container. To run migrations manually against a running Compose stack:

```bash
docker compose exec api alembic upgrade head
```

### Event photo & attachment storage

Set `AWS_S3_BUCKET` and `AWS_REGION` to store uploaded event photos and support attachments in a private S3 bucket. For S3-compatible providers (MinIO, Cloudflare R2, DigitalOcean Spaces), also set `AWS_S3_ENDPOINT_URL` and `AWS_S3_ADDRESSING_STYLE=path`. When `AWS_S3_BUCKET` is empty, uploads are stored on local disk under `MEDIA_ROOT`.

To migrate existing local event photos to S3:

```bash
docker compose exec api python scripts/migrate_event_photos.py
docker compose exec api python scripts/migrate_event_photos.py --delete-local
```

## Backend development

See [`backend/README.md`](backend/README.md) for full instructions, or run:

```bash
cd backend
uv sync                                  # install dependencies
uv run alembic upgrade head               # apply migrations before serving
uv run uvicorn app.main:app --reload     # serve on :8000
uv run pytest                            # tests (add TEST_USE_POSTGRES=1 for Postgres 17 mode)
uv run ruff check --fix .                # lint
uv run ruff format .                     # format
```

## Contributing

- Branch off `main`; `main` is protected and takes changes only by PR.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`.
- CI must be green before review: backend (ruff, migrations, PostgreSQL 17 pytest, OpenAPI drift check), web (typecheck, lint, test, build), mobile (typecheck, unit tests, export check, Playwright E2E), and Docker builds.

## Documentation

- [`docs/architecture-rationale.md`](docs/architecture-rationale.md) — FastAPI + PostgreSQL 17 architecture decision record (SRS §9)
- [`docs/backup-recovery.md`](docs/backup-recovery.md) — encryption, automated backups, and restore drill runbook
- [`docs/data-model/`](docs/data-model/) — relational data model, one file per domain slice
- [`docs/state-machines.md`](docs/state-machines.md) — event, activation, order, ticket, and support lifecycles
- [`docs/openapi.json`](docs/openapi.json) — generated OpenAPI contract
- [`docs/testing-guide.md`](docs/testing-guide.md) — automated checks and manual test plan (web + mobile)
- [`docs/demo-guide.md`](docs/demo-guide.md) — live demonstration script, preparation, and recovery

## Team & Roles

| Role | Responsibility |
|---|---|
| **Lead — Backend, Data, Security & Infrastructure** | FastAPI API, PostgreSQL 17 schema & Alembic migrations, concurrency & auth hardening, assigned-seating engine, email/PDF/calendar services, production Docker/TLS/backups, CI pipeline, ADR |
| **Web — Attendee Experience** | Event discovery, private-event unlock, checkout & hold countdown, calendar export menu, Web interactive seat map, attendee account & tickets |
| **Web — Organizer Workspace** | Event creation/editing/duplication, gallery & venue layout management, 5-metric inventory & activation UI, sales/refunds, promo campaigns, analytics & timeline |
| **Web — Admin, Support, Check-In & Accessibility** | Platform admin moderation, disputes/payouts/exports, support escalation UI, notifications, cross-browser Web QR scanner, WCAG 2.1 AA compliance & E2E tests |
| **Mobile App (Expo / React Native)** | Native iOS/Android build configuration, attendee browsing/seating/checkout/tickets, door-staff QR ticket scanner, campaign QR validation & mobile E2E tests |

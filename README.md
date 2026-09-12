# BiletFlow

Event ticketing platform — browse events, buy tickets, and validate them at the
door by QR scan.

> TODO: replace with two or three sentences from the SRS. Say who the users are
> (attendee, organizer, gate staff) and what the core flow is.

## Stack

| Part | Tech |
|---|---|
| Backend | FastAPI, SQLAlchemy 2.x, Alembic, PostgreSQL 17 |
| Web | Vite + TypeScript + Tailwind |
| Mobile | Expo (React Native) |
| Tooling | uv, ruff, pytest, Docker Compose, GitHub Actions |

## Repository layout

```
backend/     FastAPI service — the API and the database live here
web/         Web client
mobile/      Expo app (includes the ticket scanner)
docs/        ERD, state machines, exported openapi.json
```

The API contract is committed at `docs/openapi.json`. It is generated from the
backend, never edited by hand, and CI fails if it drifts from the code. Web and
mobile build against that file.

## Prerequisites

- Docker Desktop
- [uv](https://docs.astral.sh/uv/) — for backend work outside Docker
- Node.js — for web and mobile

## Quickstart

```bash
git clone <repo-url>
cd biletflow
cp .env.example .env    # then fill in the blanks
docker compose up --build
```

Compose waits for PostgreSQL, applies Alembic migrations, and then starts the
API. If a migration fails, the API does not start. The web app is available at
http://localhost:5173 and the API docs at http://localhost:8000/docs.

## Environment

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored and must
never be committed.

Generate a `SECRET_KEY` with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

For host development, `DATABASE_URL` should use `localhost:5433`. Compose
overrides it to use `db:5432` inside the API container. Migrations run
automatically when the Compose API starts. To apply them to an already running
API (for example, after a `relation "users" does not exist` error):

```bash
docker compose exec api alembic upgrade head
```

## Backend development

```bash
cd backend
uv sync                                  # install dependencies
uv run alembic upgrade head               # apply migrations before serving
uv run uvicorn app.main:app --reload     # serve on :8000
uv run pytest                            # tests
uv run ruff check --fix .                # lint
uv run ruff format .                     # format
```

Interactive API docs: http://localhost:8000/docs

### Migrations

Never write a migration by hand, and never merge one you have not read.

```bash
uv run alembic revision --autogenerate -m "what changed"
# read the generated file in app/alembic/versions/ before applying it
uv run alembic upgrade head
```

Autogenerate only sees models that are imported in `app/db/base.py`. If a new
model is missing from that file, the generated migration will be silently empty.

## Contributing

- Branch off `main`; `main` is protected and takes changes only by PR.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`.
- CI must be green before review: ruff, pytest, docker build, openapi drift check.
- Reviews route automatically via `CODEOWNERS`.

## Documentation

- [`docs/data-model/`](docs/data-model/) — data model, one file per slice
- [`docs/state-machines.md`](docs/state-machines.md) — order and ticket lifecycles
- [`docs/openapi.json`](docs/openapi.json) — generated API contract

> TODO: add team members and roles.

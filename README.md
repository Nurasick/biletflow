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

> TODO: fill this in once the backend actually boots. Write it by copying the
> commands you really ran, in the order you ran them, the first time it worked.
> Then verify it by deleting `.venv/`, running `docker compose down -v`, and
> following your own instructions literally.

```bash
git clone <repo-url>
cd biletflow
cp .env.example .env    # then fill in the blanks
```

## Environment

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored and must
never be committed.

Generate a `SECRET_KEY` with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Note that `DATABASE_URL` uses `db` as the host, not `localhost` — that is the
service name inside Docker Compose. Run migrations through the container:

```bash
docker compose exec api alembic upgrade head
```

## Backend development

```bash
cd backend
uv sync                                  # install dependencies
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

- [`docs/erd.md`](docs/erd.md) — data model
- [`docs/state-machines.md`](docs/state-machines.md) — order and ticket lifecycles
- [`docs/openapi.json`](docs/openapi.json) — generated API contract

> TODO: add team members and roles.

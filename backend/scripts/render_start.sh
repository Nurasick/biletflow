#!/bin/sh
# Start command for the Render free web service (set as its Docker Command:
# `sh scripts/render_start.sh`). Render's free plan has no pre-deploy hook, so
# migrations run here, before the API starts; a failed migration stops the
# deploy just as the `migrate` service does in docker-compose.prod.yml.
# Render's Docker Command field keeps literal quotes, hence a script instead
# of an inline `sh -c "..."`.
set -e
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

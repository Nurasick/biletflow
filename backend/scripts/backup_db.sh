#!/usr/bin/env bash
# Automated PostgreSQL backup with custom format compression, integrity check,
# SHA-256 manifest, and retention pruning (§7, §9).
#
# Usage:
#   DATABASE_URL="postgresql://user:pass@host:5432/biletflow" ./backend/scripts/backup_db.sh
#   # or with standard PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env vars
#
# Optional environment variables:
#   BACKUP_DIR             Destination directory (default: ./backups)
#   BACKUP_RETENTION_DAYS  Delete dumps older than N days (default: 14)

set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if ! [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE_PATH="${BACKUP_DIR}/biletflow-${TIMESTAMP}.dump"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

# Convert SQLAlchemy driver prefix (postgresql+psycopg://) to libpq URI if needed.
LIBPQ_URL=""
if [[ -n "${DATABASE_URL:-}" ]]; then
  LIBPQ_URL="${DATABASE_URL/postgresql+psycopg:\/\//postgresql:\/\/}"
fi

echo "[backup] starting PostgreSQL custom-format dump -> ${ARCHIVE_PATH}"
if [[ -n "${LIBPQ_URL}" ]]; then
  pg_dump \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --file="${ARCHIVE_PATH}" \
    "${LIBPQ_URL}"
else
  pg_dump \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges \
    --file="${ARCHIVE_PATH}"
fi

echo "[backup] verifying archive readability via pg_restore --list"
pg_restore --list "${ARCHIVE_PATH}" >/dev/null

echo "[backup] writing and verifying SHA-256 checksum"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${ARCHIVE_PATH}" > "${CHECKSUM_PATH}"
  sha256sum --check "${CHECKSUM_PATH}" >/dev/null
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${ARCHIVE_PATH}" > "${CHECKSUM_PATH}"
  shasum -a 256 --check "${CHECKSUM_PATH}" >/dev/null
else
  echo "ERROR: neither sha256sum nor shasum is installed" >&2
  exit 1
fi

if [[ "${BACKUP_RETENTION_DAYS}" -gt 0 ]]; then
  echo "[backup] pruning backups older than ${BACKUP_RETENTION_DAYS} days in ${BACKUP_DIR}"
  find "${BACKUP_DIR}" -maxdepth 1 -type f \( -name "biletflow-*.dump" -o -name "biletflow-*.dump.sha256" \) \
    -mtime "+${BACKUP_RETENTION_DAYS}" -delete
fi

SIZE_BYTES="$(wc -c < "${ARCHIVE_PATH}" | tr -d '[:space:]')"
echo "[backup] complete: ${ARCHIVE_PATH} (${SIZE_BYTES} bytes)"

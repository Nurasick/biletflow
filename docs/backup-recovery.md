# BiletFlow — Database Backup, Encryption at Rest & Recovery Runbook

This runbook documents how BiletFlow protects PostgreSQL 17 data at rest and in transit, automates daily backups, and verifies point-in-time / dump recovery procedures (SRS §7, §9).

---

## 1. Encryption in Transit & At Rest

### In Transit
- **Public edge (HTTPS/TLS):** `docker-compose.prod.yml` terminates TLS 1.2/1.3 at the Caddy edge proxy on `:443`, automatically redirects HTTP `:80 -> HTTPS :443`, and emits `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- **Database connection (PostgreSQL TLS):** Set `DB_SSLMODE=require` (or `verify-full` with CA certs on managed Postgres/RDS) in `.env`. `backend/app/db/session.py` passes `sslmode` directly to `psycopg` for PostgreSQL URLs.

### At Rest
- **Database volumes:** Production deployments MUST mount PostgreSQL data (`pgdata_prod`) on encrypted block storage (cloud KMS-encrypted EBS/Persistent Disk or host-level LUKS2/dm-crypt) and enable server-side encryption (SSE-KMS / SSE-S3) on the backup object-storage bucket.
- **Sensitive application fields:** `backend/app/core/crypto.py` provides an opt-in application-level encryption wrapper (`enc:v1:` prefix) supporting either a pluggable KMS provider or a Fernet key (`FIELD_ENCRYPTION_KEY`) for stored payout references. Because ciphertexts are version-prefixed, key rollout and rotation do not break reading existing rows.
- **No card data stored:** Per SRS §7, BiletFlow never stores raw PAN, CVV, or bank account numbers; only opaque provider references are persisted.

---

## 2. Backup Strategy & Schedule

| Layer | Mechanism | Frequency | Retention | Target RPO / RTO |
| :--- | :--- | :--- | :--- | :--- |
| **Logical full dumps** | `backend/scripts/backup_db.sh` (`pg_dump --format=custom --compress=9`) | Daily at 02:00 UTC (cron / systemd timer) | 14 days local (`BACKUP_RETENTION_DAYS=14`), 30+ days off-host encrypted S3/R2 | RPO ≤ 24 h / RTO ≤ 15 min |
| **WAL archiving (PITR)** | PostgreSQL `archive_mode = on` + `pgBackRest` / managed RDS automated snapshots | Continuous WAL segments (≤ 5 min) | 7–14 days | RPO ≤ 5 min / RTO ≤ 30 min |

### Running a Backup Manually

```bash
export DATABASE_URL="postgresql+psycopg://biletflow:<password>@db-host:5432/biletflow"
export BACKUP_DIR="/var/backups/biletflow"
export BACKUP_RETENTION_DAYS="14"

./backend/scripts/backup_db.sh
```

Or against the production Compose container:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-privileges \
  > "./backups/biletflow-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

### What `backup_db.sh` Guarantees
1. Enforces `umask 077` so dump files are readable only by the backup owner.
2. Produces a compressed PostgreSQL custom archive (`--format=custom --compress=9 --no-owner --no-privileges`).
3. Immediately validates archive integrity via `pg_restore --list`.
4. Computes and verifies a `.sha256` checksum manifest alongside each dump.
5. Prunes local dumps and checksums older than `BACKUP_RETENTION_DAYS`.

### Recommended Cron Entry (02:00 UTC Daily)

```cron
0 2 * * * /opt/biletflow/backend/scripts/backup_db.sh >> /var/log/biletflow-backup.log 2>&1
```

Upload completed `.dump` and `.sha256` files immediately afterward to an encrypted off-host S3/R2 bucket with object versioning and lifecycle expiration enabled.

---

## 3. Restore & Verification Drill Procedure

Run a restore drill into a throwaway database at least once per release cycle (and before every major schema migration).

### Step 1: Verify Checksum & Archive Contents

```bash
sha256sum --check /var/backups/biletflow/biletflow-YYYYMMDDTHHMMSSZ.dump.sha256
pg_restore --list /var/backups/biletflow/biletflow-YYYYMMDDTHHMMSSZ.dump | head -n 30
```

### Step 2: Restore Into a Clean Target Database

```bash
# Create an isolated verification or recovery database
createdb -h localhost -U biletflow biletflow_restore_check

# Restore schema, constraints, indexes, sequences, and rows atomically
pg_restore \
  --dbname="postgresql://biletflow:<password>@localhost:5432/biletflow_restore_check" \
  --no-owner \
  --no-privileges \
  --single-transaction \
  --exit-on-error \
  /var/backups/biletflow/biletflow-YYYYMMDDTHHMMSSZ.dump
```

### Step 3: Verify Application & Schema Health

```bash
# 1. Confirm Alembic head matches the repository
DATABASE_URL="postgresql+psycopg://biletflow:<password>@localhost:5432/biletflow_restore_check" \
  uv run --directory backend alembic current

# 2. Sanity-check critical domain counts (users, events, orders, tickets, audit_logs)
psql "postgresql://biletflow:<password>@localhost:5432/biletflow_restore_check" -c "
  SELECT 'users' AS tbl, count(*) FROM users
  UNION ALL SELECT 'events', count(*) FROM events
  UNION ALL SELECT 'orders', count(*) FROM orders
  UNION ALL SELECT 'tickets', count(*) FROM tickets
  UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
"

# 3. Tear down the verification database after drill sign-off
dropdb -h localhost -U biletflow biletflow_restore_check
```

### Point-in-Time Recovery (Managed Postgres / WAL Archiving)
When recovering from accidental bulk deletion or bad operational changes on managed PostgreSQL (RDS / Cloud SQL / pgBackRest):
1. Identify the UTC timestamp immediately preceding the incident from `audit_logs.created_at`.
2. Provision a PITR clone restored to `recovery_target_time = '<timestamp>'`.
3. Verify restored `orders`, `tickets`, `payments`, and `event_seats` rows against the audit trail.
4. Cut over `DATABASE_URL` during a brief maintenance window and re-run `GET /api/v1/health`.

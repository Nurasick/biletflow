# BiletFlow — Backend & Database Architecture Rationale (ADR)

**Status:** Accepted  
**Applies to:** BiletFlow MVP & Hardening (SRS v0.3 §9)  
**Selected Stack:** Python 3.12 + **FastAPI** + SQLAlchemy 2.0 + Alembic + **PostgreSQL 17**

---

## 1. Context

SRS §9 requires selecting and documenting a backend framework and relational database based on four concrete engineering criteria:
1. **Team familiarity**
2. **Development speed**
3. **Data-model requirements**
4. **Deployment complexity**

BiletFlow combines public event discovery, strictly non-overselling ticket & seat inventory under concurrent checkouts, simulated payments/refunds/payouts, QR check-in admission, multi-role support chat, reporting/analytics, and immutable audit trails — all delivered by a 5-person student engineering team across Web (React/Vite) and Mobile (Expo/React Native) clients sharing a single OpenAPI contract.

---

## 2. Backend Framework Selection: FastAPI

### Candidates Evaluated

| Criterion (SRS §9) | **FastAPI (Selected)** | Django + DRF | Express / NestJS (Node.js) |
| :--- | :--- | :--- | :--- |
| **Team familiarity** | High — Python is the team's primary backend language; type hints + Pydantic match TypeScript mental models. | Medium — familiar Python, but DRF serializer/viewset conventions and Django ORM idioms add ramp-up overhead. | Medium — team uses TypeScript on Web/Mobile, but Node ORM/migration ecosystems (Prisma/TypeORM) had less team experience for complex SQL locks. |
| **Development speed** | **Highest** — Pydantic v2 schemas validate inputs, serialize responses, and auto-generate `docs/openapi.json` with zero boilerplate. | High for admin CRUD, slower for custom non-CRUD workflows (state machines, atomic hold sweeps, PDF/QR streaming). | Medium–High — requires separate OpenAPI/Zod/Swagger wiring to keep Web & Mobile contracts synced. |
| **Data-model requirements** | **Excellent** — SQLAlchemy 2.0 gives first-class access to `SELECT ... FOR UPDATE`, conditional `UPDATE ... RETURNING`, partial unique indexes, and explicit SQL `CHECK` constraints. | Good, though complex `UPDATE ... RETURNING` and partial-index DDL often require dropping to raw SQL. | Good with raw SQL, but ORM abstractions hide transaction isolation and row-level locking semantics. |
| **Deployment complexity** | **Low** — single `python:3.12-slim` image with `uv sync --locked --no-dev`, `alembic upgrade head`, and multi-worker `uvicorn`. | Low–Medium — heavier runtime, staticfiles handling, and extra middleware not needed for an API-only backend. | Low — comparable container footprint, but requires bundling/transpiling TS build artifacts. |

### Key Reasons FastAPI Won
- **Single-source-of-truth API contract:** `backend/scripts/export_openapi.py` exports `docs/openapi.json` directly from FastAPI routes and Pydantic v2 models, enforced in CI (`git diff --exit-code -- ../docs/openapi.json`) so Web and Mobile never drift from backend contracts.
- **Explicit transactional control:** Pairing FastAPI with SQLAlchemy 2.0 Core/ORM lets every concurrency-critical path (ticket holds, assigned-seat claims, payment confirmation, promo redemption caps, activation fees, refunds, and door check-in) execute explicit atomic SQL statements inside well-defined transactions.
- **Built-in document & crypto ecosystem:** Generating Unicode Kazakh/Russian/English ticket PDFs (`reportlab`), QR codes (`segno`), Argon2id password hashes (`pwdlib`), and JWT tokens (`pyjwt`) works cleanly in one runtime with zero auxiliary microservices.

---

## 3. Database Selection: PostgreSQL 17

### Candidates Evaluated

| Criterion (SRS §9) | **PostgreSQL 17 (Selected)** | MySQL 8 | MongoDB (Document Store) |
| :--- | :--- | :--- | :--- |
| **Team familiarity** | High — standard SQL, widely used across coursework and local Docker setups. | High — familiar SQL, minor syntax/dialect differences. | Medium — easy for prototypes, error-prone for relational financial/inventory invariants. |
| **Development speed** | High — native `JSONB`, `TIMESTAMPTZ`, `RETURNING`, CTEs, and Alembic autogenerate minimize application glue code. | Medium — lacks partial unique indexes (`WHERE ...`) and `UPDATE ... RETURNING` (requiring extra round trips). | Low for relational integrity — multi-collection joins and financial reconciliation require heavy application code. |
| **Data-model requirements** | **Best fit** — enforces every BiletFlow invariant in the database itself (partial unique indexes, `CHECK` constraints, `FOR UPDATE`, `TIMESTAMPTZ`, `JSONB`). | Partial — cannot natively express partial unique indexes for active seat holds or live tickets without trigger workarounds. | Poor fit — ticket inventory, orders, payments, refunds, disputes, payouts, and audit timelines are inherently relational and ACID-critical. |
| **Deployment complexity** | **Low** — official `postgres:17-alpine` container, built-in `pg_isready` healthchecks, `pg_dump --format=custom`, and universal managed cloud support. | Low — comparable container and managed hosting story. | Medium — replica set required even for multi-document ACID transactions. |

### Specific PostgreSQL Features BiletFlow Relies On
1. **Partial unique indexes (`WHERE ...`)**:
   - `uq_holds_active_event_seat` (`WHERE released_at IS NULL AND event_seat_id IS NOT NULL`) prevents two buyers from holding the same assigned seat concurrently.
   - `uq_tickets_live_event_seat` (`WHERE status IN ('valid', 'checked_in') AND event_seat_id IS NOT NULL`) prevents double-issuing a seat while still allowing re-sale after cancellation or refund.
   - `uq_promo_redemptions_campaign_order` prevents duplicate promo redemptions.
2. **Row-level locking & conditional `UPDATE ... RETURNING`**:
   - Checkout holds, seat claims, order confirmation, refund processing, activation fees, and QR ticket admission use `SELECT ... FOR UPDATE` and conditional `UPDATE ... WHERE status = ... RETURNING ...` so overselling, double check-ins, and duplicate refunds are mathematically impossible under concurrency (verified by multi-threaded Postgres tests in `backend/tests/test_*_concurrency.py`).
3. **Database-enforced invariants (`CHECK` constraints)**:
   - Non-negative inventory counters, `quantity_sold + quantity_reserved <= quantity_total`, positive payment/refund/dispute/payout amounts, valid enum state sets, and `sender = 'staff' OR NOT is_internal_note` on `support_messages` act as a second wall below application validation.
4. **Timezone-aware timestamps (`TIMESTAMPTZ`) & `JSONB`**:
   - All schedules are stored in UTC `TIMESTAMPTZ` and rendered in the event's IANA timezone (`Asia/Almaty`, etc.); `audit_logs.payload` and `notifications.payload` store structured JSON metadata cleanly.

---

## 4. Operational Trade-Offs & Mitigations

- **In-process background loops vs. external worker queue:** For MVP simplicity (SRS §9 deployment complexity), hold sweeping (`HOLD_SWEEP_INTERVAL_SECONDS`) and notification outbox delivery (`NOTIFY_INTERVAL_SECONDS`) run via transactional DB locks (`UPDATE ... WHERE status = ...`) so multiple `uvicorn` workers never double-release holds or double-send emails. When scale outgrows a single node, the same transactional outbox tables (`holds`, `notifications`) can be drained by dedicated worker processes without schema changes.
- **SQLite fast-path vs. Postgres CI parity:** Developers can run unit/API tests against in-memory SQLite in seconds locally, while GitHub Actions CI runs the **entire** test suite (`TEST_USE_POSTGRES=1`) plus multi-threaded concurrency tests and reversible Alembic migrations (`downgrade base && upgrade head`) against real **PostgreSQL 17**.

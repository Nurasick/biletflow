← [Index](README.md)

# Concurrency — How Overselling Is Prevented

Cross-cutting. Read this before writing [03 — Ordering](03-ordering.md).

**SRS:** §7 — "checkout shall use an atomic reservation process to prevent
double-selling a seat"; §4.8 — a ticket cannot be used twice; §7 — "promo-code
validation and redemption limits shall be enforced atomically."

Three different requirements, one solution.

---

## The bug

This is the version everyone writes first:

```sql
SELECT quantity_sold FROM ticket_types WHERE id = 1;   -- 95 of 100
-- application decides: "5 left, fine"
UPDATE ticket_types SET quantity_sold = quantity_sold + 1 WHERE id = 1;
```

Two buyers run it at the same time. Both read 95. Both decide there's room. Both
write. You sold 101 tickets.

This is called **check-then-act**, or TOCTOU (time-of-check to time-of-use).

### Postgres's default isolation does not save you

`READ COMMITTED` gives every *statement* a fresh view of committed data. Both
`SELECT`s are legal. Both `UPDATE`s are legal. Nothing conflicts — because **the
decision happened in Python, where the database cannot see it.** The database has
no idea you made a promise based on that `SELECT`.

---

## Measured, on this project's database

20 buyers released simultaneously, racing for the last 5 of 100 tickets, against
the Postgres 17 container in `docker-compose.yml`. Correct answer every time:
**5 granted, `sold` = 100.**

| Strategy | Granted | Final `sold` | Result |
|---|---:|---:|---|
| Naive check-then-act, `READ COMMITTED` | 20 | **115** | **oversold by 15** |
| Naive + `CHECK (sold <= total)` | 5 | 100 | correct — 15 raw DB errors |
| `SELECT … FOR UPDATE` | 5 | 100 | correct |
| **Atomic conditional `UPDATE`** | **5** | **100** | **correct** |
| Naive at `REPEATABLE READ`, no retry | **2** | **97** | safe but **undersold** |
| Naive at `REPEATABLE READ` + retry | 5 | 100 | correct — 67 retries |
| Naive at `SERIALIZABLE` + retry | 5 | 100 | correct — 60 retries |

Three things in that table matter more than the prose around it.

**Row 1 — the failure is worse than the number.** All 20 buyers were told they
succeeded. You don't get 15 error pages; you get 15 people at the door holding a
valid confirmation and no ticket.

**Row 5 — "safe" is not the same as "correct."** `REPEATABLE READ` with no retry
loop never oversells, but it granted only **2** tickets and left **3 unsold**
while 18 buyers hit a database error. Lost revenue *and* a broken experience. A
concurrency strategy without a retry policy is half a strategy.

**Rows 6–7 — correctness has a price.** 60–67 retries to sell 5 tickets. Under
real contention that's the database burning CPU on work it throws away.

---

## What BiletFlow uses

### General admission — one atomic statement

The check and the write cannot be separated, so there is no window between them:

```sql
UPDATE ticket_types
   SET quantity_reserved = quantity_reserved + :n
 WHERE id = :id
   AND quantity_total - quantity_sold - quantity_reserved >= :n;
```

`rowcount = 0` means sold out → return `409`. `rowcount = 1` means you hold the
inventory → create the `holds` row.

**Why this is safe at `READ COMMITTED`:** the `UPDATE` takes a row lock. The
second transaction *blocks*, and when it wakes up Postgres **re-evaluates the
`WHERE` clause against the updated row**, not against its original snapshot.
(This mechanism is called EvalPlanQual.) So the second buyer correctly sees the
new count and fails.

No retry loop. No explicit transaction juggling. No lock held across application
logic.

**The cost:** `quantity_reserved` is a denormalized counter, so it can drift
from the real hold rows. See [expiry](#hold-expiry) below.

### Assigned seating — a `UNIQUE` constraint

A seat is a **row**, not a number. Claiming it twice is physically impossible:

```sql
CONSTRAINT uq_event_seats_event_id_seat_id UNIQUE (event_id, seat_id)
```

This is the only mechanism that works for seating, and it's what §4.3.1 reduces
to when it says the system "shall prevent two orders from purchasing the same
seat." See [08 — Seating](08-seating-bonus.md).

### Underneath both — the `CHECK` constraint

```sql
CONSTRAINT ck_ticket_types_inventory_within_total
    CHECK (quantity_sold + quantity_reserved <= quantity_total)
```

This is **not the strategy** — it's the backstop. Row 2 of the table shows it
works even when the application code is wrong. It is what still holds when
someone runs an `UPDATE` by hand in `psql`, or when a teammate adds a new code
path in week 10 that forgets the rules.

Always add it. It's free.

---

## The same primitive, three more times

### Check-in (§4.8)

"Record a successful check-in and prevent the same ticket from being used twice."

```sql
UPDATE tickets SET status = 'checked_in'
 WHERE id = :id AND status = 'valid';
-- rowcount = 0  =>  already used, or cancelled/refunded
```

Identical shape. **Never** `SELECT` the status, decide in Python, then `UPDATE` —
the same QR scanned at two doors simultaneously would admit two people.

### Promo redemption limits (§7)

"The server shall … prevent redemption beyond the campaign limit."

```sql
UPDATE campaigns SET redemption_count = redemption_count + 1
 WHERE id = :id
   AND (max_redemptions IS NULL OR redemption_count < max_redemptions);
```

### Order confirmation

A payment webhook can be delivered twice. The transition to `confirmed` must be
conditional on the current status, or you issue two sets of tickets for one
payment. See [state-machines.md §4](../state-machines.md#4-order).

---

## The rule

> **Never let correctness depend on a decision your Python made between two
> queries.**

Either the check and the write are one statement, or you hold a lock across
both, or the schema makes the bad state unrepresentable.

---

## Hold expiry

`quantity_reserved` counts live holds, so something must give the inventory back
when a checkout is abandoned. §4.3.1: "A seat hold shall expire and release the
seat when checkout is abandoned or its time limit is reached."

**Never rely on the client to release a hold.** The browser that abandoned
checkout is exactly the one that will not call your API.

A periodic task:

```sql
UPDATE holds SET released_at = now()
 WHERE released_at IS NULL AND expires_at < now()
 RETURNING ticket_type_id, quantity;
```

then decrements `quantity_reserved` by the returned amounts, **in the same
transaction**.

If you ever run more than one sweeper, select the rows with
`FOR UPDATE SKIP LOCKED` so the two workers take disjoint batches instead of
fighting.

### Detecting drift

Because the counter is denormalized, it can diverge from reality. This query
finds it:

```sql
SELECT tt.id,
       tt.quantity_reserved AS counter,
       COALESCE(SUM(h.quantity), 0) AS actual
  FROM ticket_types tt
  LEFT JOIN holds h
    ON h.ticket_type_id = tt.id
   AND h.released_at IS NULL
   AND h.expires_at > now()
 GROUP BY tt.id, tt.quantity_reserved
HAVING tt.quantity_reserved <> COALESCE(SUM(h.quantity), 0);
```

Run it in a test after a simulated checkout storm. It should return zero rows.

---

## Approaches considered and rejected

For the record, and for the defence.

| Approach | Why not |
|---|---|
| `SELECT … FOR UPDATE` | Correct, and a fine fallback. But it serializes every buyer of a ticket type for the whole transaction — and if a payment call happens inside it, everyone queues behind a network round trip |
| Optimistic locking (version column) | You own the retry loop. Better suited to low-contention edits like an organizer changing event details in two tabs |
| `SERIALIZABLE` isolation | Correct, zero drift, no sweeper needed for correctness — but a mandatory retry loop, and serialization failures spike exactly when the demo is busiest |
| Materializing every GA unit as a row | 10,000 rows before a single sale. Right for seats, wrong for GA |
| Postgres advisory locks | Invisible coupling — nothing in the schema tells the next developer the lock exists. Niche |
| Redis distributed lock (Redlock) | Adds a second datastore that can disagree with Postgres, and distributed locks are famously hard to get right under partitions — to solve a problem one SQL statement already solves |
| Queue / single-writer per event | How Ticketmaster-scale on-sales work. Correct, and vastly more infrastructure than this project has |

**The trade actually being made:** a denormalized counter plus a background
sweeper, in exchange for no retry loops. A serialization-failure retry storm
mid-demonstration is a worse failure mode than counter drift, which a
reconciliation query detects.

---

## What to test

1. **Concurrent buyers, one winner.** N threads race for the last ticket;
   exactly one succeeds and `quantity_sold` is exact.
2. **Same for check-in.** Two threads scan one ticket; exactly one gets
   `checked_in`, the other gets "already used."
3. **Same for promo redemption** at the campaign limit.
4. **The `CHECK` constraint refuses** a hand-written over-limit `UPDATE`.
5. **The sweeper releases** expired holds and the drift query returns nothing.
6. **A duplicate payment webhook** issues one set of tickets, not two.

Use real threads and real connections — a mocked session cannot reproduce a race.

---

## Sources

- [PostgreSQL: Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html)
- [PostgreSQL: Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)
- [PostgreSQL: `SELECT … FOR UPDATE` / `SKIP LOCKED`](https://www.postgresql.org/docs/17/sql-select.html#SQL-FOR-UPDATE-SHARE)

---

← [Index](README.md) · [03 — Ordering](03-ordering.md)

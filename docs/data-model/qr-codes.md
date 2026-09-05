← [Index](README.md)

# QR Codes

Cross-cutting. Referenced by [03 — Ordering](03-ordering.md),
[04 — Check-in](04-checkin.md), and [05 — Campaigns](05-campaigns.md).

**SRS:** §4.7, §4.8, §4.14, §11

---

## Two kinds of QR code exist, and they must never be confused

BiletFlow generates two visually similar, functionally opposite things:

| | **Admission ticket** | **Campaign** |
|---|---|---|
| Purpose | Lets one person through a door | Opens an event page with a discount pre-applied |
| Lives on | A `tickets` row | A `campaigns` row |
| Encodes | A signed token | A signed HTTPS link |
| Claim `typ` | `"adm"` | `"cmp"` |
| Accepted by the scanner | yes | **never** |

§4.14 states the rule directly: "The mobile ticket-verification app and admission
endpoint shall never accept a Campaign QR Code as permission to enter an event."

§11 makes it a **success criterion for the whole project**: "An admission scanner
rejects Campaign QR Codes while continuing to accept valid ticket QR codes."

So this is not a detail. It is something the demonstration will be graded on, and
it is trivially easy to get wrong if both codes are just "a string the server
looks up."

---

## Tamper-resistance comes from a signature, not a secret

§4.7 requires a "tamper-resistant QR code." People's first instinct is to make
the ID unguessable — a long random string, so nobody can construct someone else's
ticket.

That is the wrong mechanism. **The right one is an HMAC signature.**

With a signed payload, an attacker who changes *any* field — the ticket code, the
event, the type claim — invalidates the signature, and the server rejects it. They
cannot produce a valid signature without `SECRET_KEY`. Guessability becomes
irrelevant, which is why `tickets.public_code` can be short and human-readable
(`BF-3K9P-22XM`) and printed on paper without risk.

This is the same reasoning §4.14 applies to campaigns from the other direction:
the link carries "an opaque campaign or promo token **rather than a discount
amount trusted by the client**."

> **The server calculates and verifies everything. The client is never believed.**

---

## Payload

Signed with HMAC keyed on `settings.SECRET_KEY`. Minimum contents:

| Field | Purpose |
|---|---|
| `typ` | `"adm"` or `"cmp"` — **the discriminator the scanner checks** |
| `tid` | `tickets.public_code` |
| `eid` | `events.id` — lets the scanner reject a ticket for the wrong event before any database work |
| `nonce` | `tickets.qr_nonce` — lets a single ticket's QR be invalidated without changing its identity |
| `v` | Key version, so `SECRET_KEY` can be rotated without invalidating every printed ticket |

`qr_nonce` is stored on the ticket. Rotating it invalidates the old QR while the
ticket keeps its `public_code`, its history, and its row — useful if a ticket is
mistakenly shared publicly.

**Do not put attendee names, emails, or phone numbers in the payload.** §4.14
requires that even analytics never receive "attendee names, email addresses,
phone numbers, ticket identifiers, or other direct personal information," and a
QR code is photographed, forwarded, and posted to social media constantly.

---

## Verification order at the scanner

Each step assumes the previous one passed. §4.8 and §11.

```
1. Verify the HMAC signature          → fail: "invalid"
2. Assert typ == "adm"                → fail: "invalid"   ← campaign QRs die here
3. Assert eid == the event being scanned → fail: "wrong event"
4. Assert the scanning admin has a staff_assignments row for this event
                                       → fail: 403
5. Conditional UPDATE:
     UPDATE tickets SET status='checked_in'
      WHERE id = :id AND status = 'valid'
   rowcount 1 → "valid, checked in"
   rowcount 0 → read the current status and report the specific reason
```

**Step 2 is the §11 success criterion.** It costs one line and it is the entire
difference between passing and failing that requirement. Write the test for it
the same day you write the endpoint.

**Step 5 must be a conditional `UPDATE`**, never a `SELECT` then a decision then
an `UPDATE` — the same QR scanned at two doors simultaneously would otherwise
admit two people. See [concurrency.md](concurrency.md).

### Five outcomes, not a boolean

§4.8 requires the app to display "a clear **valid, invalid, cancelled, refunded,
or already-used** result." That's five distinct responses.

| Outcome | Reached when |
|---|---|
| valid | Step 5 returned `rowcount = 1` |
| invalid | Signature failed, or `typ != "adm"`, or wrong event |
| cancelled | `rowcount = 0`, current status is `cancelled` |
| refunded | `rowcount = 0`, current status is `refunded` |
| already used | `rowcount = 0`, current status is `checked_in` |

A scanner that returns "ok / not ok" **fails the requirement.** The distinction
also matters at a real door: "already used" means find the person who came in
with it; "refunded" means they got their money back and shouldn't be here.

---

## Campaign QR codes

§4.14. A campaign QR encodes an **HTTPS link**, not a token to be scanned by your
app — it's designed for a phone's built-in camera, which opens a browser.

```
https://biletflow.kz/e/{event_slug}?c={campaigns.qr_token}
```

`qr_token` is opaque and carries **no discount value**. The server looks it up,
validates it (active, in date, under the redemption limit, applicable to the
selected ticket types), and computes the discount. §4.14: "The server shall
calculate and validate all discounts."

§4.14 also requires campaign codes to be "visually and functionally distinct"
from admission tickets. Functionally, that's the `typ` claim. Visually, that's a
frontend job — different frame, different colour, an explicit label. Two
near-identical black-and-white squares with opposite meanings is a design
problem, not just a code problem.

---

## Printed tickets

§4.7 requires a print-optimized PDF whose QR "shall remain large and clear enough
to be scanned from a paper copy, including when printed in grayscale."

Practical consequences:

- **Server-generated PDF**, not a browser print stylesheet. §9 says "server-generated
  PDF based on the canonical ticket record."
- **High error-correction level** (Q or H). Paper gets folded and stained.
- **Adequate quiet zone** — the blank margin around the code. Cramming it against
  a border is the most common reason a printed QR won't scan.
- **Pure black on white.** No coloured or gradient QR codes; grayscale printing
  must preserve contrast.
- The PDF carries: event name, date/time, venue, ticket type, attendee name,
  section/row/seat if assigned, `public_code`, and the QR.
- §4.7: **no payment-card details** or other unnecessary sensitive data.

**Digital and printed copies share one `public_code` and one ticket row.** §4.7:
they "shall not create separate admissions." Printing is a rendering of the same
ticket, never a new one — which the conditional `UPDATE` in step 5 enforces for
free.

---

## For the frontend

- **Never construct a QR payload client-side.** Request the image or the signed
  token from the server. A client that can build payloads is a client that can
  build fake tickets.
- Render the two kinds of QR **visibly differently** (§4.14). Label them.
- The scanner UI needs **five distinct result states**, with colour *and* text —
  a door is loud, bright, and rushed.
- §7 wants validation in under two seconds. Show an immediate scanning state; don't
  leave the operator wondering whether it registered.
- Offline is explicitly out of scope (§4.8, §10). A lost connection is an honest
  error state, not something to queue and sync.

---

## What to test

1. A tampered payload (any field altered) is rejected.
2. **A campaign QR is rejected by the admission endpoint** (§11).
3. A valid ticket scanned twice: first succeeds, second returns "already used."
4. A refunded ticket is rejected with `refunded`, not a generic failure.
5. An admin without a `staff_assignments` row for the event gets `403`.
6. Two concurrent scans of one ticket produce exactly one check-in.
7. A generated PDF's QR decodes after being rasterized to grayscale.

---

## Sources

- `BiletFlow_SRS_Initial_Draft.pdf` §4.7, §4.8, §4.14, §11
- [RFC 2104 — HMAC](https://datatracker.ietf.org/doc/html/rfc2104)
- [ISO/IEC 18004 — QR code error correction levels](https://www.iso.org/standard/62021.html)

---

← [Index](README.md) · [04 — Check-in](04-checkin.md)

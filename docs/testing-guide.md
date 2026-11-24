# BiletFlow testing guide

How to verify every part of BiletFlow (backend, web, and the mobile app) against
SRS v0.3. It has three parts:

1. [Setup](#1-setup): one-time machine setup.
2. [Automated checks](#2-automated-checks): run these before every merge and before the demo.
3. [Manual test plan](#3-manual-test-plan): per-requirement checks on web **and** mobile.

The mobile app must cover everything the web does, not only scanning. Section 3 lists every
requirement with the web route and the mobile screen side by side.

For the live demonstration script, see [demo-guide.md](demo-guide.md).

---

## 1. Setup

### 1.1 Prerequisites

| Tool | Used for |
|---|---|
| Docker Desktop (running) | database, API, web, Mailpit, Expo dev server |
| [uv](https://docs.astral.sh/uv/) | backend tests and lint outside Docker |
| Node.js 20+ | web and mobile checks |
| Microsoft Edge | the Playwright suites use the installed Edge (`PLAYWRIGHT_CHANNEL=msedge`) |
| Expo Go on a phone (SDK 57) | camera scanning on a real device |

### 1.2 First start

```bash
cp .env.example .env          # fill in SECRET_KEY (see README)
docker compose up -d --build  # db, api, web, mailpit, mobile
```

In `.env`, `CORS_ORIGINS` must include every browser origin that calls the API:

```
CORS_ORIGINS=http://localhost:5173,http://localhost:8081,http://127.0.0.1:8081
```

Restart the API after changing it: `docker compose up -d api`.

| URL | What |
|---|---|
| http://localhost:5173 | web app |
| http://localhost:8000/docs | API (Swagger) |
| http://localhost:8025 | Mailpit: every verification, reset, ticket and notification email |
| http://localhost:8081 | mobile app in a browser (Expo web, served by the `mobile` container) |

### 1.3 Install client dependencies (once per clone)

```bash
cd web && npm ci && cd ..
cd mobile && npm ci && cd ..
```

If `mobile/node_modules` is empty, every mobile check fails with
`Cannot find module 'typescript'` or `'tsc' is not recognized`. That means
dependencies are missing, not that the code is broken.

### 1.4 Demo data

The seed script creates a story built for the SRS use cases. It only runs on an
**empty** database; `--reset` wipes every table first.

```bash
docker compose exec api python scripts/seed_demo.py           # empty DB only
docker compose exec api python scripts/seed_demo.py --reset   # WIPES ALL DATA, then seeds
```

Password for every seeded account: `Demo12345!`

| Account | Role | Seeded data |
|---|---|---|
| admin@example.com | Platform Admin | sees everything, including a reported scam event |
| organizer@example.com | Organizer (Almaty Jazz Club) | owns 6 events covering every phase |
| staff@example.com | Event Admin | assigned to Jazz Night, Open Mic, and **Startup Meetup (live today)** |
| attendee@example.com | Attendee | has orders and tickets |

Seeded events: *Almaty Jazz Night* (paid, activated, 2 campaigns), *Open Mic* (free),
*Startup Meetup: Live Today* (scan here), *Winter Hackathon* (completed, with a refund),
*Kazakh Cinema Evening* (cancelled), *Nauryz Spring Concert* (draft paid event for UC2),
*FREE iPhone…* (reported, for admin suspension).

### 1.5 Windows pitfalls (seen on the team machine)

- **Port 5433 on loopback can belong to something else.** A native Windows Postgres
  or `wslrelay` may hold `127.0.0.1:5433` / `[::1]:5433`. Then host-side tests reach
  the wrong server, and the Postgres-only tests **skip silently**. Check:
  ```powershell
  Get-NetTCPConnection -LocalPort 5433 -State Listen | Select LocalAddress,OwningProcess
  ```
  If anything other than Docker owns loopback, point `DATABASE_URL` at your LAN IP
  (e.g. `192.168.0.193:5433`). That reaches Docker's `0.0.0.0` binding.
- **The Expo container does not hot-reload edits made on Windows.** After changing
  mobile code, run `docker compose restart mobile`. Alternatively, run Expo on the
  host (see 1.6).

### 1.6 Running the mobile app on a phone

The phone and the PC must be on the same Wi-Fi. Allow ports 8000 and 8081 through
Windows Firewall (private networks).

```powershell
cd mobile
$env:EXPO_PUBLIC_API_URL = "http://<your-LAN-IP>:8000"   # e.g. http://192.168.0.193:8000
npx expo start
```

Scan the QR code in the terminal with Expo Go (Android) or the Camera app (iOS).
`localhost` on a phone means the phone itself, so the LAN IP is required. The
Android emulator uses `http://10.0.2.2:8000` automatically.

---

## 2. Automated checks

Run them all from the repo root. Expected results are from the last full run on this branch.

### 2.1 Backend

```bash
cd backend
uv run ruff check .
uv run ruff format --check .
uv run alembic upgrade head
uv run pytest -rs                     # -rs prints WHY anything was skipped
uv run python scripts/export_openapi.py && git diff --exit-code -- ../docs/openapi.json
```

Expected: **638 passed, 0 skipped** with the compose DB reachable. If the summary
shows `13 skipped`, the Postgres concurrency tests did not reach Postgres (see 1.5).
Those 13 tests are the proof for:

- seat and ticket double-selling under concurrent checkout (`test_checkout_concurrency.py`, `test_holds_concurrency.py`)
- one admission per ticket under concurrent scans (`test_check_in_concurrency.py`)
- an admin suspension racing an in-flight payment (`test_payment_suspension_race.py`)

To run only those (PowerShell):

```powershell
$env:DATABASE_URL = "postgresql+psycopg://biletflow:<password>@<LAN-IP>:5433/biletflow"
uv run pytest tests/test_checkout_concurrency.py tests/test_holds_concurrency.py tests/test_check_in_concurrency.py tests/test_payment_suspension_race.py
```

### 2.2 Web

```bash
cd web
npx tsc -b        # types
npm test          # 98 unit tests
npm run lint      # oxlint; 2 known warnings, 0 errors
npm run build
```

### 2.3 Mobile

```bash
cd mobile
npm run typecheck          # TypeScript, whole app
npm test                   # 54 unit tests, including translation coverage
npm run test:integration   # real API + fresh PostgreSQL in throwaway Docker containers
npm run test:e2e:fresh     # exports the web build, serves it on :8090, runs 8 Playwright UI tests
npm run export:check       # Android + iOS + web bundles build
```

| Suite | Proves |
|---|---|
| `npm test` | API adapters, scan gating, support privacy, date/time-zone conversion, staff-queue filters, **every UI string has Russian and Kazakh** |
| `test:integration` | 15 groups against a real backend: bearer login, assigned-event scoping, single admission, duplicate rejection, **Campaign QR rejected**, cancelled/refunded rejected, concurrent scans, manual check-in and undo, attendance totals, support authorization, internal notes hidden |
| `test:e2e:fresh` | rendered UI for check-in, uncertain-network handling, support, language switch, auth screens |

`npm test` fails with `ru is missing: …` when a new `t('…')` string has no
translation. Add it to `src/i18n/messages.ts` (attendee/staff screens) or
`src/i18n/messages-management.ts` (organizer/admin screens) as `[en, ru, kk]`.

### 2.4 Pre-demo gate

All of these must be green on the commit you demo:

- [ ] backend: ruff, format, pytest **0 skipped**, OpenAPI unchanged
- [ ] web: tsc, test, build
- [ ] mobile: typecheck, test, test:integration, test:e2e:fresh, export:check
- [ ] the manual smoke in 3.13, done on a **real phone**

---

## 3. Manual test plan

Every row is one check. **W** is the web route and **M** is the mobile screen (the *Menu*
tab is the mobile hub for organizer, admin and support tools). Run each
check on both clients unless marked otherwise.

Use two browsers or profiles (or one browser + the phone) so the organizer and the
attendee are signed in at the same time.

### 3.1 Accounts (SRS 4.1)

| # | Do | W | M | Expect |
|---|---|---|---|---|
| A1 | Register a new account | `/signup` | Login → *Sign up* | "check your email"; message in Mailpit |
| A2 | Click the verification link / enter token | `/verify-email` | Login → *Verify email* | account shows *Email verified* |
| A3 | Sign out, sign in | header menu | Menu → *Sign out* | session ends / restores |
| A4 | Forgot password → reset via Mailpit token | `/forgot-password` | Login → *Forgot password?* → *I have a reset token* | new password works, old one fails |
| A5 | Edit name/phone | `/account` | Menu tab → account row | saved |
| A6 | Non-admin opens admin | `/admin` | `/admin` | blocked: "not a platform administrator" |

### 3.2 Organizer profile and events (SRS 4.1, 4.2, UC1)

| # | Do | W | M | Expect |
|---|---|---|---|---|
| O1 | New account opens organizer tools | `/organizer/profile` | Menu tab → *Organizer tools* | empty "Become an organizer" form, contact email prefilled, **no red error** |
| O2 | Save profile with sandbox payout `demo_account` | same | same | "Organizer profile saved." |
| O3 | Run simulated identity verification | `/organizer/events/:id/edit` (activation) | *Run simulated identity verification* | status *verified* |
| O4 | Create a draft: title, venue, address, start/end, capacity, registration window, category, visibility | `/organizer/events/new` | *Create a draft event*: date `YYYY-MM-DD` + time `HH:MM` fields | draft created; times stored in Asia/Almaty (19:00 → 14:00Z) |
| O5 | Type an impossible date (`2026-02-30`) | — | date field | red hint; save refused with "Check the date and time fields." |
| O6 | Edit details; change the time zone | `/organizer/events/:id/edit` | event → *Overview* | wall-clock time kept, instant moves (19:00 Moscow → 16:00Z) |
| O7 | Upload / remove an image (max 5) | edit page | *Capture and add event image* | gallery updates |
| O8 | **Preview before publishing** | `/organizer/events/:id/preview` | *Overview* → *Preview event* | attendee view + checklist; "visible ticket type" ✗ until a ticket exists |
| O9 | Publish, unpublish, publish again | preview page | preview → *Publish event* / *Overview* | public page appears / disappears |
| O10 | Visibility unlisted / private | edit | *Visibility* | not in public search; unlisted still opens by link |
| O11 | Phase grouping: Upcoming / Active / Completed / Cancelled | `/organizer/events` | *Your events* → *Show: …* | each seeded event lands in its group |
| O12 | Duplicate a completed event (UC12) | events list / edit | *Duplicate into a new draft* | new draft; **no** orders, tickets, check-ins or cases copied |
| O13 | Cancel an event | edit | *Cancel event* (confirm) | attendees notified; tickets invalid; .ics shows cancellation |

### 3.3 Ticket types (SRS 4.3)

| # | Do | W | M | Expect |
|---|---|---|---|---|
| T1 | Free type (0 KZT, qty 50) and paid type (5000 KZT, qty 10, max 2/order) | edit page | event → *Tickets* | both listed |
| T2 | Sales window in the past or future | same | *Sales start / end* | attendee sees not-on-sale |
| T3 | Hide a type | same | *Hide ticket type* | gone from public page, data kept |
| T4 | Counters | same | *Tickets* | available / reserved / sold match orders |
| T5 | Buy beyond stock or max-per-order | event page | ticket selection | blocked by the server |

### 3.4 Paid-sales activation (SRS 3.2, 4.5, UC2): seeded *Nauryz Spring Concert*

| # | Do | W | M | Expect |
|---|---|---|---|---|
| P1 | Before activation, try to buy the paid ticket | event page | event → *Choose tickets* | paid type not purchasable |
| P2 | Open the checklist | edit → activation | event → *Activation* | 5 items: paid type, identity verified, fee paid, payout active, terms |
| P3 | Accept terms → simulate fee (confirm) → *Activate paid sales* | same | same | every step labelled **simulation**; status *active* |
| P4 | Buy the paid ticket now | event page | ticket selection → checkout → *Pay (demo)* | ticket issued **only after** payment |

### 3.5 Checkout, payments, promo codes (SRS 4.4, 4.6, 4.14, UC3, UC10)

| # | Do | W | M | Expect |
|---|---|---|---|---|
| C1 | Free registration | `/events/:slug` | event → *Choose tickets* | order total 0, ticket + email immediately |
| C2 | Contact details | checkout | checkout | contact name and email prefilled from the account |
| C3 | Paid order, then abandon it | checkout | checkout, don't pay | order *pending* with a hold; expires and releases stock |
| C4 | Pay (demo) | order page | *My tickets* → order → *Pay (demo)* | confirmed; QR shown |
| C5 | Promo code typed by hand | checkout | checkout → *Promo code* → *Apply* | discount and new total shown **before** paying |
| C6 | Campaign QR | campaign tab shows QR | Menu tab → *Scan campaign QR* (or open the link) | event opens with the code pre-applied |
| C7 | Expired / disabled / exhausted / wrong-type code | checkout | checkout | clear rejection message |
| C8 | Promo QR at the door | staff scanner | staff scanner | **rejected**, no admission (see S5) |

### 3.6 Digital tickets, PDF, calendar (SRS 4.7, 4.11, UC6, UC7)

| # | Do | W | M | Expect |
|---|---|---|---|---|
| D1 | Open the order | `/orders/:number` | *My tickets* → *View details* | ticket ID, type, attendee, status, QR |
| D2 | Download PDF | *Download* | *Download tickets PDF* | A4 PDF: event, date, venue, type, attendee, seat (if any), ID, QR; **no** card data |
| D3 | Print the PDF in grayscale and scan it at the door | — | staff scanner | admits once; the phone copy is then *already used* |
| D4 | Add to calendar | event page / order | event page / order → *Add to calendar (.ics)* | correct time zone, venue, URL |
| D5 | Cancel the event, re-download the .ics | — | — | same UID, `STATUS:CANCELLED` |

### 3.7 Check-in (SRS 4.8, UC4): sign in as `staff@example.com`, event *Startup Meetup: Live Today*

Real camera checks need a phone (section 1.6). The browser build of the mobile app
has no usable camera on most laptops; use manual search there.

| # | Do | M | Expect |
|---|---|---|---|
| S1 | List events | *Event tools → Open assigned events* | only assigned events |
| S2 | Scan a valid ticket (shown on the laptop screen) | event → camera | green **valid**, counts update |
| S3 | Scan it again | — | **already used**, no second admission |
| S4 | Scan a ticket for a different event / a tampered code | — | **wrong event** / **invalid** |
| S5 | Scan a **Campaign QR** | — | **invalid**: never admits |
| S6 | Scan a cancelled / refunded ticket | — | **cancelled** / **refunded** |
| S7 | Manual search by name or code → *Check in* | *Name or ticket code* | admitted |
| S8 | *Undo check-in* → *Confirm reversal* | — | ticket valid again, can be re-admitted |
| S9 | Attendance | header counts | registered / checked-in / absent match the organizer analytics |
| S10 | Unassigned account opens the event | — | no camera, no admission actions |

### 3.8 Orders, refunds, cancellations (SRS 4.9, UC5)

| # | Do | W | M | Expect |
|---|---|---|---|---|
| R1 | Attendee sees their orders | `/account` → orders | *My tickets* | all orders with status |
| R2 | Attendee cancels a pending order | order page | order → cancel (confirm) | hold released |
| R3 | Organizer cancels a free registration | edit → attendees/sales | event → *Sales* → *Cancel free registration* | tickets invalid |
| R4 | Organizer refunds a paid order | same | *Issue full simulated refund* (confirm) | order *refunded*; attendee notified; scan → **refunded** |
| R5 | Audit | edit → timeline | event → *History* | refund entry with actor and time |

### 3.9 Support (SRS 4.13, UC9)

| # | Do | W | M | Expect |
|---|---|---|---|---|
| H1 | Attendee opens support from an order / ticket / event | order page → support | order → *Order support* / ticket → *Ticket support* / event → *Contact support* | category picker; case keeps event/order/ticket context |
| H2 | Organizer platform request | `/support` | *Support* → *Organizer platform support* | case with event context only |
| H3 | Staff queue with filters | `/staff/support` | Menu tab → *Support queue*: *Status*, *Category*, *Event ID* | only authorized cases; filters narrow the list |
| H4 | Reply, internal note, assign, status Open → In progress → Waiting → Resolved | case page | *Open conversation* | requester never sees internal notes |
| H5 | Notification on reply / status change | `/notifications` + Mailpit | bell icon | new item |
| H6 | Another attendee opens the case URL | — | — | access denied |

### 3.10 Analytics and history (SRS 4.15, 4.16, UC11, UC12): *Almaty Jazz Night*, *Winter Hackathon*

| # | Do | W | M | Expect |
|---|---|---|---|---|
| N1 | Capacity, sold, remaining, % sold | `/organizer/events/:id/analytics` | event → *Analytics* | match ticket counts |
| N2 | Gross, discounts, refunds, net (KZT, labelled demo) | same | same | match orders |
| N3 | Sales over time, by ticket type, by campaign | same | same | campaign revenue = its orders |
| N4 | Check-in % and absent | same | same | equals staff attendance |
| N5 | Filter by date range and ticket type | same | *Filter analytics* | numbers change accordingly |
| N6 | Timeline with filters (date, activity type) | edit → timeline | *History* → *Filter event history* | publish, price change, refund, promo, case status, check-in, reversal entries |
| N7 | Another organizer opens this event's analytics or timeline | — | — | 403 / not found |

### 3.11 Platform administration (SRS 4.12): `admin@example.com`

| # | Do | W | M | Expect |
|---|---|---|---|---|
| M1 | Overview numbers | `/admin` | Menu tab → *Platform administration* | users, events, orders, failed payments, open reports/cases |
| M2 | Search users / events / orders / payments | `/admin/users`, `/admin/events`, `/admin/transactions` | *Users*, *Events*, *Transactions* tabs | results |
| M3 | Suspend + reinstate a user | `/admin/users` | *Users* | suspended user cannot sign in |
| M4 | Review the reported *FREE iPhone…* event → suspend | `/admin/reports` (resolve) + `/admin/events/:id` (suspend) | *Reports* → *Suspend event and mark actioned* | removed from discovery; checkout blocked |
| M5 | Suspend / reinstate **paid sales** only | `/admin/events/:id` | *Activations* | free registration continues, paid stops |
| M6 | Activation fee and processing fee | `/admin/settings` | *Settings* | new orders use them |
| M7 | CSV exports | `/admin/transactions` | *Transactions* → *Export orders/payments CSV* | files download/share |
| M8 | Campaign activity | `/admin/sales?view=campaigns` | *Campaigns* | redemptions and revenue per campaign |
| M9 | Event timeline as admin | `/admin/events/:id` | *Events* → *View activity history* | full history |

### 3.12 Non-functional (SRS 7)

| # | Check | Expect |
|---|---|---|
| F1 | Switch EN → RU → KK in Menu → *Language* on every mobile screen, and the web language switcher | no English left on organizer/admin screens (the unit test enforces this for literal strings) |
| F2 | Prices | KZT everywhere; demo payments labelled "simulation" |
| F3 | Scan timing | result in < 2 s on venue Wi-Fi |
| F4 | Phone widths 360 / 390 / 430 | no horizontal scrolling, date fields fit |
| F5 | Dark mode on the phone | readable |
| F6 | Screen reader (TalkBack / VoiceOver) on scan results and seat map | results read as text, not only colour |

### 3.13 Fifteen-minute smoke (do this on the demo commit)

1. Seed (`--reset` on the demo DB only).
2. Mobile, `organizer@example.com`: create a draft → *Preview* → add a free ticket → publish from the preview.
3. Mobile, `attendee@example.com`: register for it → *My tickets* → QR visible → download the PDF.
4. Phone, `staff@example.com`, *Startup Meetup*: scan a seeded attendee ticket → valid → scan again → already used → *Undo check-in*.
5. Scan a Jazz Night **Campaign QR** with the staff scanner → rejected.
6. Web, `admin@example.com`: suspend the reported event → attendee can no longer book it.
7. Switch the phone to Русский and Қазақша and open the organizer *Activation* tab.

---

## 4. Known limitations (say this up front if asked)

| Area | Status |
|---|---|
| Assigned seating (bonus) | the mobile seat map is a labelled **preview**; the backend stores ticket quantities, not seats |
| Calendar (bonus) | `.ics` download only; no Google/Outlook one-click links |
| Guest browsing on mobile | mobile requires sign-in; the web lets guests browse |
| Event photos on mobile | camera capture only (no photo-library picker) |
| Offline scanning | deferred by the SRS (online only) |
| Real payments, KYC, payouts | simulated by design (SRS 3.2, 8) |

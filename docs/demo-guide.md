# BiletFlow live demo guide

A rehearsable 15–18 minute demonstration that walks every SRS v0.3 success
criterion (section 11) and shows that the **mobile app does everything the web does**,
not only scanning. For the detailed per-feature checks, see [testing-guide.md](testing-guide.md).

---

## 1. Cast and devices

| Who (presenter) | Device | Signed in as | Shows |
|---|---|---|---|
| **Organizer / Admin** | Laptop, projected | web: `organizer@example.com`, later `admin@example.com` | web app |
| **Attendee** | Phone 1 (Expo Go), mirrored | `attendee@example.com` | mobile app: buying, tickets, support |
| **Door staff** | Phone 2 (Expo Go), mirrored | `staff@example.com` | mobile scanner |
| **Parity segment** | Phone 1 | `organizer@example.com` / `admin@example.com` | the same management on mobile |

Password for every account: `Demo12345!`

To mirror a phone to the projector: Android → [scrcpy](https://github.com/Genymobile/scrcpy) over USB;
iPhone → QuickTime "New Movie Recording" with the phone as camera. With only one phone,
play the attendee in the laptop browser at http://localhost:8081 (DevTools → device
toolbar → 390×844). That is the same mobile app.

---

## 2. Preparation

### Day before

- [ ] Everything in [testing-guide.md §2.4](testing-guide.md#24-pre-demo-gate) is green on the commit you will demo.
- [ ] Expo Go (SDK 57) installed on both phones; both phones and the laptop on **one** Wi-Fi
      (venue Wi-Fi blocks device-to-device traffic more often than not; bring a phone hotspot as backup).
- [ ] Windows Firewall allows inbound 8000 and 8081 on the private network.
- [ ] Print one ticket PDF in **grayscale** on A4 (from step 5 of a rehearsal) for the paper-ticket moment.
- [ ] Full rehearsal with a timer, then reset the data (below).

### 30 minutes before

```powershell
docker compose up -d --build
docker compose exec api python scripts/seed_demo.py --reset    # demo DB only: wipes and reseeds

cd mobile
$env:EXPO_PUBLIC_API_URL = "http://<LAN-IP>:8000"               # ipconfig → Wi-Fi IPv4
npx expo start                                                   # scan the QR with Expo Go on both phones
```

- [ ] Phone 1: sign in as attendee. Phone 2: sign in as staff → *Startup Meetup: Live Today* opens and the camera works.
- [ ] Laptop tabs: http://localhost:5173 (organizer signed in), http://localhost:8025 (Mailpit), a private window for admin.
- [ ] Phone brightness up, Do Not Disturb on, auto-lock off.
- [ ] Language set to English on all screens; you switch it live in act 8.

---

## 3. The script

Times are targets. **Bold** lines are what to say. Each act names the SRS clause and the
success criterion (SC) it proves.

### Act 1: Problem and architecture (1 min)

**"BiletFlow lets anyone in Kazakhstan create an event and issue QR tickets. Free events cost
nothing. Paid sales need a one-time activation. Payments are a clearly labelled simulation,
as the SRS allows."**

Point at: FastAPI + PostgreSQL backend, React web, Expo (React Native) app for iOS/Android,
all in Docker Compose. One OpenAPI contract (`docs/openapi.json`) shared by both clients.

### Act 2: Organizer publishes a free event (UC1, SC1): laptop, 2 min

1. `/organizer/events/new`: title "Demo Day", venue, a date next week, capacity 100.
2. Add a free ticket type "General", 100 tickets.
3. **Preview**: **"This is exactly what attendees will see. The checklist must be all green."**
4. Publish.
5. Assign staff: `staff@example.com` (People / staff panel).

### Act 3: Campaign QR and a discounted purchase (4.14, UC10, UC3, SC3, SC7): 3 min

1. Laptop: open seeded **Almaty Jazz Night** → Campaigns → show the campaign QR on screen.
   **"A campaign QR is a marketing link with an opaque token. It carries no price and never admits anyone."**
2. Phone 1 (attendee): Menu tab → *Scan campaign QR* → scan the laptop screen.
   The event opens with the code already applied.
3. *Choose tickets* → 1 Standard → *Continue* → note the **discount and new total before paying** → *Reserve tickets*.
4. *Open my tickets* → order → *Pay (demo)* → **"Tickets are issued only after the simulated payment succeeds."**
5. *View details* → QR ticket. Tap *Download tickets PDF*: **"Same ticket ID on paper and on the phone."**
6. *Add to calendar (.ics)*: opens in the phone calendar with the venue and the Almaty time zone.

### Act 4: Door check-in (4.8, UC4, SC5, SC8): 3 min. The core moment.

Phone 2 (staff): *Event tools* → *Open assigned events* → **Almaty Jazz Night** → open the camera.

1. Scan the attendee's ticket on Phone 1 → **green, valid**. Counts go up.
2. Scan it **again** → **already used**. **"The server decides, atomically. Two scanners at two doors still admit once."** (backed by `test_check_in_concurrency.py`)
3. Scan the **campaign QR** on the laptop → **invalid**. **"Marketing QR codes are never admission."**
4. Scan the **printed grayscale PDF** of a different ticket → valid. Then *Undo check-in* → *Confirm reversal* → valid again.
5. Manual search: type the attendee's name → *Check in*. **"The fallback when a phone screen is cracked or the camera fails."**

### Act 5: Support conversation (4.13, UC9, SC6): 2 min

1. Phone 1: *My tickets* → order → *Order support* → category *Ticket delivery* → message → send.
   **"The case carries the event, order and ticket automatically."**
2. Laptop (organizer): Support queue → filter by status *Open* → open the case → reply → set *In progress*.
3. Phone 1: the reply appears within 15 s (polling, as the SRS allows), plus a notification.

### Act 6: Refund and its effect at the door (4.9, UC5, SC9): 1.5 min

1. Laptop: Jazz Night → orders → refund the attendee's order (confirm; labelled simulation).
2. Phone 2: scan that ticket → **refunded**, no entry.
3. Mailpit: the refund email. Timeline: the refund entry with actor and time.

### Act 7: Analytics, history, duplication (4.15, 4.16, UC11, UC12, SC10, SC11): 2 min

1. Jazz Night → Analytics: capacity / sold / remaining, gross / discounts / refunds / net, sales over time,
   by ticket type, **by campaign**, check-in %. Filter by date range.
   **"Every number comes from our own order and ticket records. Checkout asks for nothing extra."**
2. **Winter Hackathon** (completed): History → filter by activity type. Duplicate it.
   **"The copy has the configuration but none of the orders, tickets or check-ins."**

### Act 8: Mobile parity: the instructor's requirement (3 min)

**"Everything you just saw on the web, the app also does."** Phone 1: sign out → `organizer@example.com`.

1. Menu tab → *Organizer tools* → *Your events* → *Show: Upcoming/Active/Completed/Cancelled*.
2. Open **Nauryz Spring Concert** (draft, paid) → *Activation*: the 5-item checklist (UC2, SC2) →
   *Accept paid-event terms* → *Simulate activation fee payment* (confirm) → *Activate paid sales*.
3. *Overview* → *Preview event* → *Publish event* from the preview.
4. Show the remaining tabs: *Tickets* (date + time fields in Almaty time), *Sales* (refund / cancel),
   *People* (assign staff, attendee CSV), *Campaigns* (QR marked "NO ADMISSION"), *Analytics*, *History*.
5. Menu → *Language* → **Русский**, then **Қазақша**: the organizer screens are fully translated (SRS 7).
6. Sign out → `admin@example.com` → *Platform administration*: Overview, Reports, Activations, Settings, CSV export.

### Act 9: Moderation stops sales (4.12, 4.5, SC12): 1 min

1. Laptop (admin, private window): `/admin/reports` → read the "FREE iPhone…" report → open that event
   (`/admin/events` → search "iPhone") → suspend it → back on `/admin/reports`, mark the report *actioned*.
   (On mobile this is one button: *Reports* → *Suspend event and mark actioned*.)
2. Phone 1 (attendee) opens that event → no *Choose tickets*. **"Suspension stops sales immediately, including payments already in flight."** (`test_payment_suspension_race.py`)

### Close (30 s)

**"Every success criterion in section 11 was shown live. Behind it: 638 backend tests including real-Postgres concurrency
tests, 98 web tests, and 54 mobile unit, 15 integration and 8 UI tests."**

---

## 4. If something goes wrong

| Symptom | Recovery |
|---|---|
| Expo Go: "Could not connect to development server" | same Wi-Fi? firewall? Switch to the phone hotspot; restart `npx expo start`; last resort: play the mobile role at http://localhost:8081 on the laptop |
| App loads but every request fails | `EXPO_PUBLIC_API_URL` must be the **LAN IP**, not localhost; restart Expo after changing it |
| A red "Failed to fetch" once on a screen | network blip; pull down to refresh. Not data loss |
| Camera does not open | grant the permission in phone settings, or use manual search (Act 4.5); that is SRS behaviour, not a failure |
| Scan shows "Result unknown" | network dropped mid-scan; *Refresh*, then search the attendee. The app never shows a fake "valid" |
| QR won't read from the laptop screen | raise screen brightness, zoom the QR, tilt to remove glare, or use the printed copy |
| Mobile code changed but the app still shows the old version | Docker on Windows doesn't hot-reload: `docker compose restart mobile`, or use host `npx expo start` |
| Need clean data between rehearsals | `docker compose exec api python scripts/seed_demo.py --reset` |

---

## 5. Likely questions

| Question | Answer |
|---|---|
| Is the money real? | No. SRS 3.2 allows a labelled simulation; every payment screen says "demo/simulation". |
| How do you stop two people buying the last ticket? | Row-level locking in one transaction; `test_checkout_concurrency.py` races 12 buyers for one ticket on real Postgres. |
| Can a screenshot of a QR be reused? | It is one ticket ID. The first scan admits and every later one says *already used*. QRs are server-signed, so edits are *invalid*. |
| Why can't the campaign QR admit? | The admission endpoint checks the signed QR type; campaign links are rejected server-side (integration test group 6). |
| Who can see a support case? | The requester, staff of that event, and platform admins. Internal notes never reach the requester (tested). |
| Seat maps? | A bonus item. The mobile seat map is a labelled preview; the backend sells quantities, not seats. |
| Offline scanning? | Deferred by the SRS (section 4.8: online verification only). |
| Is the mobile app only a scanner? | No. Act 8: organizer, paid activation, campaigns, analytics, history, admin, support and attendee purchase all run in the app. |

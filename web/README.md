# BiletFlow web

## Check-in and platform administration

Signed-in users can open **Gate check-in** from the header or account page at
`/staff/events`. The API lists events assigned to that account, including events
they organize. Each event has live attendance counts, admission QR validation,
attendee/ticket-code search, manual check-in, and confirmed reversal of an
accidental check-in. A successful QR scan admits the ticket immediately.

Camera scanning uses browser QR detection when available and requires a secure
context (HTTPS or localhost) and camera permission. Pasting QR content and manual
ticket lookup remain available when the browser cannot scan with a camera.

Accounts with the backend `is_platform_admin` flag can open **Platform
administration** at `/admin` to see counts for users, events, ticket sales,
simulated payments, and open reports and support cases. **User management**
provides account search, suspension with a reason, and reinstatement.

Guests and signed-in users can choose **Report event** on an event page. Admins
review those submissions under **Event reports**, open the event's moderation
page, then dismiss the report or mark action taken. **Event moderation** also
provides event history and paid-sales activation controls.

**Transactions** shows order search, payment status filters and failure details,
and refund records. Orders and payments can be downloaded as CSV. **Sales
oversight** shows platform-wide activation records and promo campaign activity,
with links to each event's moderation page. **Platform settings** lets admins
edit the activation fee and processing rate for new quotes and orders.

## Attendees and event activity

Open an event from **My events**, then use its preview page to view the attendee
list and activity history. Both lists load from the authenticated organizer API
and show 25 entries per page, with refresh and retry controls.

The attendee list shows each ticket's attendee, contact details, ticket type,
status, code, and order number. The activity history shows the timestamp, actor,
action, affected record, description, and any recorded details. History is
read-only and can be filtered by action and date/time range. Date/time filters
use the device time zone shown beside the form; the end of the range is exclusive.

## Account editing

At `/account`, update your first name, last name, optional phone, and preferred
language. Save sends `PATCH /users/me` and updates the account header from the
server response. Clearing the phone removes it; saving a language also switches
the interface language. Email is shown read-only because this endpoint does not
change it. Unsaved navigation, reloads, and sign-out are guarded.

## Translations

The web UI uses i18next and react-i18next. Static copy lives in
`src/i18n/locales/kk.json`, `ru.json`, and `en.json`. English defines the typed
translation keys and provides the runtime fallback. The tests require matching
keys and interpolation parameters across all three files.

Language buttons are available in the public header, authentication pages, and
organizer workspace. The app uses a saved `biletflow.locale` preference first,
then a supported browser language, then Kazakh (`kk`). The preference stays in
the browser, and switching updates the document language, UI component locale,
dates, prices, plurals, and client validation messages without clearing forms or
ticket selections. Language codes are `kk`, `ru`, and `en`.

For new interface text, add a semantic key to all three locale files and use
`const { t } = useTranslation()` with `t("your.key")` in the component. Use
interpolation for complete messages (`t("orders.qrLabel", { code })`) and
i18next plural suffixes (`_one`, `_few`, `_many`, `_other`) with `{ count }`.
Keep interpolation placeholders consistent across locales. Use `useLocale()`
for `Intl` formatting. Ant Design strings follow the same locale through
`LocaleProvider`.

Client validation schemas store `validation.*` keys, which `FieldError`
translates when rendered. Mark service field errors with `type: "server"` so
their messages remain unchanged. Event data, profile values, user input, and
service messages must never be used as translation keys.

`npm test` covers language detection and persistence, fallback, interpolation,
Russian plurals, price formatting, validation messages, and translation parity.

## Event preview and publication

Save a draft at `/organizer/events/new`, then choose **Preview event**. **My
events** in the organizer navigation opens `/organizer/events`; each saved event
links to `/organizer/events/:eventId/preview`. Preview is disabled while the
form has unsaved changes.

The preview shows the saved cover and gallery, plain-text description, venue,
schedule in the event's time zone, registration boundaries, visibility,
capacity, and visible ticket types loaded from the API.

The API checks that an event has a title, venue and address, ordered event
times, a future start, and at least one visible ticket type before it can be
published. The checklist explains each missing requirement.
**Unpublish event** requires confirmation and returns the event to draft for
editing. **Cancel event** requires confirmation, preserves the saved event, and
is permanent. The preview refreshes after each action to show the latest event
status, requirements, and permitted actions.

## Organizer event creation and editing

Use **Edit event details** in **My events** or an event preview to open
`/organizer/events/:eventId/edit`. Draft and published events can be edited;
suspended and cancelled events are read-only. Saving an existing event keeps
its status, including published events.

The form edits the title, description, category, venue, schedule, time zone,
registration window, capacity, visibility, refund policy, and images. Images
support JPEG, PNG, and WebP, up to five files of 2 MB each. Selecting a cover is
saved to the API and reflected in organizer previews and public event pages.
Refund policies may be cleared and are limited to 2,000 characters.

**Save changes** persists existing events; **Save draft** creates a new event
at `/organizer/events/new`. Dates are resolved in the selected event time zone.
Validation and server errors preserve the entered values. Image and detail
updates use several API calls, so a failed save may have saved some changes.
Unsaved navigation and reloads are guarded, and discarding edits requires
confirmation.

## Organizer profile

Sign in and open `/organizer/profile` to manage public details and contact
information through the organizer API. Saving a profile for the first time
grants access to the organizer workspace. Payouts and identity verification
use the backend sandbox.

## Connecting to FastAPI

From the repository root, `docker compose up -d --build web` starts PostgreSQL,
applies migrations, and starts FastAPI, the development inbox, and the web app.
Open [the web app](http://localhost:5173) and
[the local inbox](http://localhost:8025) for verification and password-reset links.

For host development, run `npm ci` and `npm run dev` in `web/` with a migrated
backend running on port 8000. Vite and `npm run preview` forward requests
under `/api/` and `/media/` to `http://127.0.0.1:8000`. To use another upstream,
set `API_PROXY_TARGET` in `web/.env.local`. Compose supplies `http://api:8000`.
Opening `/api/v1/health` on the web origin returns the backend status.

The production web image serves the built app with Nginx and forwards the same
paths. Set its runtime `API_PROXY_TARGET` to the backend origin (default
`http://api:8000`, without a trailing slash). Set the backend's `PUBLIC_WEB_URL`
and `PUBLIC_API_URL` to the public HTTPS origin for emailed links, QR codes,
and uploaded media. HTTPS carries the backend's Secure session cookie.

For a separate API origin, set `VITE_API_URL` including `/api/v1` before the
Vite build, or pass it as a Docker build argument. Add the web origin to
`CORS_ORIGINS` on FastAPI and use same-site hosts for its SameSite=Lax cookie.

Registration creates an account, then directs the user to sign in. Login sends
JSON credentials to `/auth/login`; `/users/me` uses the returned bearer access
token. The access token stays in memory. The browser keeps the CSRF proof
and a sign-in identifier in localStorage. The refresh token lives in an HttpOnly cookie.
Reloads restore the session through `/auth/refresh`, and expired access tokens
trigger a single refresh and retry. Refresh requests share a promise within a
tab and a Web Lock across tabs when supported. The backend controls the session
lifetime (seven days by default); there is no separate remember-me setting.

`/account` requires authentication and provides sign-out. Public event pages
are accessible to guests. Password recovery and email verification use links
sent by the backend.

Validation:

- `npm test` exercises the auth client with mocked backend responses, including
  JSON login, bearer headers, refresh rotation, concurrent requests, expired
  sessions, network errors, logout, and validation errors.
- `npm run build` checks TypeScript and builds the app.
- `npm run lint` runs Oxlint.

For a manual integration check with the backend running: register at `/signup`,
sign in, check the account name/email, reload `/account`, then sign out and
confirm `/account` redirects to `/login`. Check a wrong password and duplicate
registration for server error messages. After the access token expires,
opening the account should refresh the session automatically.

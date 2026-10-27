# BiletFlow web

## Translations

The web UI uses i18next and react-i18next. Static copy lives in
`src/i18n/locales/kk.json`, `ru.json`, and `en.json`. English defines the typed
translation keys and is the fallback for missing or empty translations, so new
Kazakh and Russian copy can be added progressively.

Language buttons are available in the public header, authentication pages, and
organizer workspace. The app uses a saved `biletflow.locale` preference first,
then a supported browser language, then Kazakh (`kk`). The preference stays in
the browser, and switching updates the document language, UI component locale,
dates, prices, plurals, and client validation messages without clearing forms or
ticket selections. Language codes are `kk`, `ru`, and `en`.

For new static text, add a semantic key to `en.json` and use
`const { t } = useTranslation()` with `t("your.key")` in the component. Use
interpolation for complete messages (`t("common.fromPrice", { price })`) and
i18next plural suffixes (`_one`, `_few`, `_many`, `_other`) with `{ count }`.
Keep interpolation placeholders consistent across locales. Use `useLocale()`
for `Intl` formatting. Ant Design strings follow the same locale through
`LocaleProvider`.

Client validation schemas store `validation.*` keys, which `FieldError`
translates when rendered. Mark service field errors with `type: "server"` so
their messages remain unchanged. Event data, profile values, user input, and
service messages must never be used as translation keys. Local event examples
use `demo.*` copy; the service adapters and demo organizer profile are unchanged.

`npm test` covers language detection and persistence, fallback, interpolation,
Russian plurals, validation messages, stable booking identifiers, and locale
placeholder consistency.

## Event preview and publication (frontend demo)

Save a draft at `/organizer/events/new`, then choose **Preview event**. **My
events** in the organizer navigation opens `/organizer/events`; each saved event
links to `/organizer/events/:eventId/preview`. The existing demo supports one
event per organizer. Preview is disabled while the form has unsaved changes.

The preview shows the saved cover and gallery, plain-text description, venue,
schedule in the event's time zone, registration boundaries, visibility,
capacity, and visible tickets. It has no checkout controls. A clearly labelled
sample free admission ticket lets the demo exercise publishing without creating
backend inventory.

**Publish event** is enabled only when the adapter reports all requirements met:
a title, venue and address, ordered event times, a future start, and at least one
visible ticket type. The checklist explains each missing requirement.
**Unpublish event** requires confirmation and returns the event to draft for
editing. **Cancel event** requires confirmation, preserves the saved event, and
is permanent. Published events must be unpublished before editing; cancelled and
suspended events remain read-only.

The web adapter in `src/shared/api/eventLifecycle.ts` owns state transitions and
returns complete snapshots with status, requirements, and permitted actions.
The UI updates after a successful response, refreshes after failed actions,
disables mutations when a refresh fails, and prevents duplicate submissions.
Status persists in localStorage per demo organizer; details and images retain
their existing IndexedDB persistence. Other tabs refresh through storage events,
and focus and periodic refreshes recheck requirements. Stale confirmation dialogs
and success messages are dismissed when the saved state changes.

This is a web-only simulation, consistent with the existing organizer workspace.
It does not publish to the live platform. The current backend contract does not
provide event lifecycle endpoints. A future HTTP adapter must implement `list`,
`preview`, `transition`, and a change subscription, returning the same snapshot contract with
server-authorized actions and requirements. Backend authorization, ticket
invalidation, notifications, and refunds remain server responsibilities.

Set `EVENT_WORKFLOW_DEMO.errors.load`, `.publish`, `.unpublish`, or `.cancel` to
exercise failures. Set `EVENT_WORKFLOW_DEMO.ticketTypes` to `[]` and refresh to
exercise missing tickets; a saved event with a past start exercises the time
requirement. Failures preserve the previous status and support retry.

`npm test` covers the status/action matrix, publish requirements and their
revalidation, reload persistence, corrupt storage, failed writes and retries,
and competing transitions. Manual checks should also cover confirmation
dismissal, cross-tab updates, failed refreshes, locale switching, and narrow
screens.

## Organizer event form (frontend demo)

Open `/organizer/events/new`, use **Create event** in the public header, or choose
**Create event** in the organizer workspace. The form follows the existing
`features/Organizer/model` and `ui` structure, using React Hook Form, Zod, React
Query and the shared organizer layout. All new copy is translated into English,
Kazakh and Russian. No backend changes or API requests are involved.

The form saves one event draft per demo organizer in IndexedDB, including image
data. Reloading restores the last successful save. Images support JPEG, PNG and
WebP, up to five files of 2 MB each, with previews, removal and cover selection.
Saving is acknowledged only after the storage transaction completes. Failed
saves retain the entered values and images; storage/load errors offer retry.
`EVENT_DEMO_ERRORS` in `src/shared/api/organizerEvents.ts` can simulate load/save
failures. The existing dummy organizer session controls access.

Validation covers required event details, field lengths, supported categories,
positive integer capacity, visibility, valid calendar dates and IANA zones,
event end after start, registration close after open, and registration no later
than event start. Registration boundaries, capacity and images are optional.
Dates use the selected event zone, independently of the browser zone. Clock
changes that skip or repeat a local time produce a field error rather than
silently changing the intended time. Changing zones keeps entered wall times.
Drafts can include past dates so previously saved events remain editable.

Unsaved changes are marked beside the save action. Discard requires confirmation
and restores the last saved values. Internal navigation offers keep-editing/leave
choices, while reload and tab close use the browser's native unsaved prompt.
Saving only stores a draft; use **Preview event** to access the simulated
publication workflow above. Live publishing, invitations, discovery visibility
and server authorization require backend integration. The draft storage adapter
is isolated in `src/shared/api/organizerEvents.ts`.

`npm test` includes event schema, time zone/DST, image validation and draft
persistence/error tests. For a manual check: enter event details, select images,
make a different image the cover, save and reload. Then edit a field and test
navigation cancellation, discard, invalid date/registration ranges and the demo
load/save switches. Check narrow screens and change language while editing.

## Organizer profile (frontend demo)

Open `/organizer/profile` to preview the light organizer form without a backend.
It uses the dummy session and profile in `src/features/Organizer/model/dummyData.ts`.
Values are saved in localStorage per demo user and survive a reload. Contact and
payout fields use React Hook Form + Zod, with React Query for loading/saving.

Change `DUMMY_SESSION` to `null` to preview the login redirect, or change its role
to `attendee` to preview denied access. Set `DUMMY_ERRORS.load` or `.save` to `true`
to preview errors; failed saves keep entered values. This is a simulated frontend
guard, not server authorization. Replace the dummy session/API adapter with real
authenticated organizer endpoints when the backend is ready.

Payouts are simulation-only: choose a demo provider and a reference such as
`demo_music_club`. Clear both fields to disconnect. No real payout is performed.
To check: edit and save, reload, discard an edit, try invalid email/phone/reference
values, then exercise the error and access states above.

Run `npm install`, then `npm run dev`. The backend must be running with its
migrations applied. The default API URL is `http://localhost:8000/api/v1`;
copy `.env.example` to `.env.local` to override `VITE_API_URL`.

Use `http://localhost:5173` for local development, and include that exact origin
in the backend's `CORS_ORIGINS`. Keep the frontend and API on the same site
(e.g. both on localhost, not one on 127.0.0.1) so the SameSite=Lax refresh cookie
is sent. Production requires HTTPS because the backend sets Secure cookies.
Vite reads API configuration at startup/build time.

Registration creates an account, then directs the user to sign in. Login sends
JSON credentials to `/auth/login`; `/users/me` uses the returned bearer access
token. The access token stays in memory. Only the CSRF proof is kept in
localStorage; the backend stores the refresh token in an HttpOnly cookie.
Reloads restore the session through `/auth/refresh`, and expired access tokens
trigger a single refresh and retry. Refresh requests share a promise within a
tab and a Web Lock across tabs when supported. The backend controls the session
lifetime (seven days by default); there is no separate remember-me setting.

`/account` requires authentication and provides sign-out. Public event pages
remain accessible to guests. Password recovery, email verification, and social
sign-in are not implemented by the backend yet; recovery pages explain this
and social sign-in buttons are disabled.

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

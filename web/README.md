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

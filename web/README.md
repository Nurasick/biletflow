# BiletFlow web

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

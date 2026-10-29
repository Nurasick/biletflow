# Mobile API integration

Updated against origin/main at 88c277e. Published events load from the API and navigate by slug. Ticket selection uses the current public ticket-type endpoint, availability, prices in minor units, sale windows, per-type limits, and a 20-ticket order limit. Checkout collects contact details and one name per attendee, then submits POST /events/{slug}/orders. Free orders return confirmed; paid orders return pending with expiry. Mobile does not collect payment yet.

Registration is available from Sign up while signed out. It saves the selected account language and returns to login. The UI itself remains English. Browser sessions use localStorage; native sessions use SecureStore.

Start the backend separately, configure EXPO_PUBLIC_API_URL from mobile/.env.example, and allow the Expo browser origin in your backend environment. Run `npm run typecheck` and `npm test` from mobile. If typed routes are stale after switching branches, start Expo once to regenerate them.

The attendee screens use a simplified dark layout. Order history, cancellation UI, payment UI, QR display, translations, and full browser/device integration tests remain outstanding. The merged upstream backend replaces an earlier migration; an existing development database may require a migration reconciliation by the backend owner. No database reset or migration repair is performed by this mobile change.

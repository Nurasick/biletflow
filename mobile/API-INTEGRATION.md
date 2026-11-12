# Mobile API integration

Published events load from the API and navigate by slug. Ticket selection uses the current public ticket-type endpoint, availability, prices in minor units, sale windows, per-type limits, and a 20-ticket order limit. Checkout collects contact details and one name per attendee, validates promo codes with POST /events/{slug}/promo, and submits the selected code to POST /events/{slug}/orders. The server recalculates the discount during checkout. Free orders return confirmed; paid orders return pending with expiry. The signed-in attendee can view orders, display QR tickets, simulate payment, and cancel pending orders from My tickets. Demo payments are clearly labelled and do not move real money.

Registration, login, profile editing, verification-email requests, email-verification completion, and password-reset completion use the existing API. The public `/reset-password` and `/verify-email` routes accept emailed tokens without requiring login; tokens entered into these forms are not persisted. Backend emails currently contain web links, so users can paste their token into mobile or use a mobile route with a `token` query parameter. Browser sessions use localStorage; native sessions use SecureStore. Concurrent unauthorized requests share one refresh, and logout wins over late session responses.

Start the backend separately, configure EXPO_PUBLIC_API_URL from mobile/.env.example, and allow the Expo browser origin in your backend environment. Run `npm run typecheck` and `npm test` from mobile. If typed routes are stale after switching branches, start Expo once to regenerate them.

## Staff verification and support

Open **Event staff · Support · Language** from the home screen. `/staff` shows the server-assigned events, and `/staff-event` rechecks access and polls attendance while focused and active. Expo Camera submits raw admission QR text for server verification. All six outcomes are distinct; no local or offline approval is permitted. Camera scans, manual check-ins, and reversals share a single-flight gate and require acknowledgement before another operation. Manual search, confirmed reversal, attendance counts, permission guidance, revoked-access states, and uncertain-network-result guidance are included. QR payloads are not logged.

Event, order, and ticket pages open contextual support requests. Requesters exchange messages; authorized staff have a server-scoped queue, replies, private notes, assignment, and allowed status changes. Requester views filter internal notes. Focused polling preserves unsent drafts. Mutations are not automatically retried. The notification screen reads the signed-in feed and marks it read; actual notification/email creation remains a backend responsibility.

English, Kazakh, and Russian can be selected on login or in the workspace. Selection is persisted separately from authentication. Interface labels are translated while event descriptions and message content remain as supplied. Dates respect event time zones and currencies use the selected locale.

The existing attendee flow retains demo payment, QR tickets, PDF download/share, and calendar export. Assigned seating remains an explicitly labelled preview: the API reserves ticket-type quantities, not individual seats. It is a bonus, not a replacement for required staff verification.

## Additional checks

- `npm run test:e2e`: browser smoke tests using intercepted API fixtures. Start Expo on port 8090 first; the default browser is locally installed Microsoft Edge. Override `MOBILE_WEB_URL` or `PLAYWRIGHT_CHANNEL` if needed.
- `npm run test:integration`: separately labelled disposable Docker API and tmpfs PostgreSQL database. It never uses Compose or the existing development database, and is separate from the default test suite. A healthy Docker engine is required.
- `npm run export:check`: Android/iOS/web JavaScript bundles in ignored `.expo/qa-export`. This verifies bundling, not native installation or camera hardware.

See `ASSIGNMENT-CHECKLIST.md` for native-device acceptance and demonstration steps. No backend source or configuration is changed by this work.

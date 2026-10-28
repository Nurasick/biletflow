# Mobile API integration

The attendee flow now reads published events from the API, carries the event slug through details and ticket selection, reads available individual tickets, and reserves the selected backend ticket IDs with POST /orders. Checkout displays the returned total, status, and expiry. It does not collect payment.

Registration is available from Sign up while signed out. It creates an account with the chosen account language, then returns the user to sign in. This language choice does not translate the mobile interface.

Set EXPO_PUBLIC_API_URL according to .env.example and start the backend before running Expo. From the repository root, create .env from .env.example, generate SECRET_KEY, start Docker Desktop, then run `docker compose up -d --build db api`. Check `http://localhost:8000/api/v1/health`. The root CORS_ORIGINS must include the Expo browser origin (normally http://localhost:8081). Public catalogues and ticket inventories load all API pages. Loading, empty, request error, and reservation conflict states are included. Returning to selection reloads inventory and clears the previous selection.

The event, selection, and checkout screens currently use a simplified shared dark layout in place of the static demo layouts. Backend tickets have no ticket-type relationship: selection therefore uses actual ticket IDs, seat numbers, and prices rather than invented ticket categories. Category inventory/counters, ticket-type quantity rules, payment, and organizer publishing APIs remain separate work.

## Checks

- npm run typecheck
- npm test

Expo generates typed routes under .expo/types. If these are stale after switching branches, run npx expo start --offline once before typecheck.

## Manual integration checks still needed

1. Register a unique account, sign in, restart, and confirm remembered session restoration.
2. Open a published event from the catalogue; confirm its details and event-local date match the backend.
3. Choose available tickets, reserve them, and confirm the returned order ID, server total, pending status, and expiry against the database.
4. Reserve the same tickets from another client before submitting; confirm the conflict is displayed and selection refresh removes unavailable tickets.
5. Confirm unavailable/cancelled events and empty inventories cannot proceed to reservation.

Automated checks mock HTTP responses; they do not replace device testing against a running backend.

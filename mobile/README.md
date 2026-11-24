# BiletFlow Mobile App (Expo / React Native)

The cross-platform mobile client for **BiletFlow** targeting **iOS**, **Android**, and **Web**, built with **Expo Router**, **React Native**, **TypeScript**, and **NativeWind**.

## Key Capabilities

- **Attendee flows:** browse events, view event details and assigned seat maps, apply promo links/codes, complete simulated checkout, access QR tickets and calendar links, and follow support cases.
- **Event staff check-in:** sign in with bearer auth (`X-Auth-Mode: bearer`), view assigned events, scan signed admission QR codes via device camera (rejecting promotional Campaign QRs), search attendees manually, and reverse accidental check-ins when permitted.
- **Organizer & admin tools:** manage events, gallery photos, promo campaign QR codes, and operational views on the go.
- **Localization:** supports Kazakh (`kk`), Russian (`ru`), and English (`en`).

## Local Setup

```bash
cd mobile
npm ci
npm start           # Expo Dev Server (choose iOS simulator, Android emulator, or Web)
```

Configure the backend API URL via `.env` or `EXPO_PUBLIC_API_URL` (defaults to `http://localhost:8000/api/v1` for local development; ensure `http://localhost:8081` is included in the backend's `CORS_ORIGINS` when running Expo Web).

## Verification Scripts

```bash
cd mobile
npm run typecheck         # TypeScript strict check
npm test                  # Unit tests (node --test)
npm run export:check      # Verify iOS, Android, and Web bundle export
npm run test:e2e          # Playwright end-to-end tests against web export
npm run test:integration  # Isolated check-in integration flow
```

For full manual and automated mobile testing instructions, see [`../docs/testing-guide.md`](../docs/testing-guide.md).

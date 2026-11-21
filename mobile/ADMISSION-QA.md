# T07 and T08 mobile QA

Run on 2026-11-20 (Asia/Qyzylorda) using backend base commit `2261831`.

## T07 clean install and translations

- A separate `npm ci` from the committed lockfile installed Expo SDK 57, `expo-camera` 57.0.6, `expo-sharing` 57.0.25, and `expo-secure-store` 57.0.4.
- `npm run typecheck` passed in the clean checkout with the checked-in Expo type declaration. `npm test` passed all 46 tests.
- Both native Hermes bundles exported successfully with `expo export --platform android --platform ios --max-workers 1 --output-dir .expo/t07-native-export`.
- Added 316 strings per locale in Russian and Kazakh. Coverage includes screen labels, organizer and admin feedback, and translated placeholders.
- Person 2 review is pending for [organizer translations](src/i18n/organizer-messages.ts). Person 4 review is pending for [admin translations](src/i18n/admin-messages.ts).

## T08 isolated online API

`npm run test:integration` passed 15 groups using the mobile API adapters and a fresh PostgreSQL-backed API. A second isolated run measured ten scan requests from adapter call through response decoding. The slowest was 52.6 ms. The two-second device target is measured from camera recognition to the visible verdict.

| Case | Observed result | API round trip |
| --- | --- | ---: |
| Valid digital QR | `valid` and one admission recorded | 52.6 ms |
| Same digital QR again | `already_used` | 30.9 ms |
| Ticket for another event | `wrong_event` | 21.7 ms |
| Invalid QR | `invalid` | 22.3 ms |
| Cancelled ticket | `cancelled` | 31.1 ms |
| Refunded ticket | `refunded` | 32.1 ms |
| Server-issued campaign link payload | `invalid` for admission | 24.4 ms |
| Grayscale A4 QR after digital admission | `already_used` | 33.9 ms |
| Grayscale A4 QR after reversal | `valid` | 45.6 ms |
| Digital copy after grayscale A4 admission | `already_used` | 35.0 ms |

The server-issued A4 page measured 595.28 × 841.89 points. Its QR decoded from the full page rasterized to grayscale at 144 DPI and matched the ticket shown digitally. The two copies shared the same admission state across the reversal.

- Manual name and code lookup returned the same ticket. After manual check-in, attendance was 4 registered, 2 checked in, and 2 absent. After reversal and refresh, it was 4 registered, 1 checked in, and 3 absent.
- The integration suite also rejected a signed campaign QR and returned one `valid` and one `already_used` for simultaneous scans of the same ticket. Access requests from unassigned staff and an unrelated account returned HTTP 403.
- The mobile regression suite passed the network failure and malformed response cases. Both require staff to reconcile with the server before attempting admission again.

## Native acceptance

| Platform | Device evidence | Remaining |
| --- | --- | --- |
| Android | The local Android 37.1 emulator booted with Expo Go 57.0.9. The later camera run stopped after the emulator remained offline under host memory pressure. | Camera-to-result timings and the native admission matrix on the T11 test environment. |
| iOS | Device access is pending. | Camera-to-result timings and the native admission matrix on the T11 test environment. |

Record camera-to-result time from QR recognition to the visible server verdict. The target is two seconds per online scan. For grayscale A4, admit using one copy and scan the other to verify it is already used. Reverse the admission, then repeat in the other direction. For loss of connectivity, use a fresh ticket and confirm the staff screen denies admission until verification succeeds. See the [native acceptance procedure](ASSIGNMENT-CHECKLIST.md#native-device-acceptance).

The T11 test environment handoff is pending. The repository's [existing integration work](https://github.com/Nurasick/biletflow/pull/50) records that its local and CI database checks are separate from T11.

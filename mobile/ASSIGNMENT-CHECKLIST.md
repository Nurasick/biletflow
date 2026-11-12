# Mobile assignment delivery checklist

Scope: SRS v0.3 sections 4.8 (online Event Admin verification), 4.13 (support), 7 (language/accessibility), 11 (success criteria), and 13.2/13.4 (testing and release coordination). Required check-in and support take priority over bonus seat maps and calendar work.

## Implemented priorities

| Priority | Requirement | Implementation |
| --- | --- | --- |
| 1 | Secure staff login and assigned events | Existing bearer session, `/staff`, server-scoped list and event-access recheck |
| 1 | Camera verification | Expo camera, permission guidance, event-scoped scan API, six explicit outcomes |
| 1 | Prevent duplicate admissions | Server decision, one in-flight operation, explicit next-scan acknowledgement |
| 1 | Reject campaign QR | Admission API validates QR type; a link/discount never grants entry locally |
| 1 | Search and reversal | Attendee/code search, server check-in, confirmation before reversal |
| 1 | Attendance | Registered, checked-in and absent counts with foreground/focus polling |
| 1 | Network failures | No offline approval, no automatic mutation retry, reconciliation guidance |
| 2 | Contextual support | Event/order/ticket entry links, categories, requester conversations |
| 2 | Authorized support handling | Server-scoped staff queue, replies/private notes, assignment, status transitions |
| 2 | Replies and status awareness | Focused polling, existing backend emails, signed-in notification feed |
| 3 | Language and account completion | Persisted EN/KK/RU, verification/reset completion, profile editing |
| 3 | Release checks | TypeScript, regression tests, browser smoke tests, platform bundle export, isolated integration runner |

## Automated evidence

- `npm run typecheck`: complete mobile TypeScript project.
- `npm test`: contracts, permissions, scan gating, uncertain outcomes, support privacy/transitions, translation coverage/persistence, and auth races.
- `npm run test:e2e`: rendered web UI with API fixtures; this does not prove backend or camera behavior.
- `npm run export:check`: Android/iOS/web JavaScript bundles, not a native installation test.
- `npm run test:integration`: actual mobile API adapters against an isolated PostgreSQL-backed API. Record the command result. A Docker setup failure is not a passing integration test.

Browser artifacts and bundle output are ignored by Git. Never include credentials, signed QR payloads, reset tokens, or real attendee data in assignment screenshots.

## Native-device acceptance

These checks require supported iOS and Android devices. Browser mocks and JavaScript bundling cannot certify them.

1. Configure a reachable development API. Sign in as assigned staff and confirm another event is unavailable.
2. Grant camera access, scan a valid ticket from another screen, and verify one server admission and updated counts.
3. Scan it again: already checked in, with no second admission.
4. Scan tampered, wrong-event, cancelled, refunded, and Campaign QR codes: no admission.
5. Deny camera permission; confirm manual search works. Grant permission through device settings and retry.
6. Search, manually check in, acknowledge, confirm reversal, and admit that ticket again.
7. Background/resume or change events during pending requests. The camera stops and old event results do not appear in the new workspace.
8. Disconnect during admission: the result is uncertain/failed, never local success. Reconnect and reconcile with refresh/search before retrying.
9. Scan an A4/grayscale PDF ticket and verify it shares the digital copy's admission state.
10. Check layout, accessible labels, text alongside status colors, and EN/KK/RU on both platforms. Measure scan response against the SRS two-second online target.

## Demonstration and review

Use the organizer web interface to publish a demo event, configure tickets, and assign the staff account. Demonstrate ticket creation, contextual support, an authorized reply, admission, duplicate rejection, and reversal. Include clearly labelled simulated payment and Campaign QR rejection. Rehearse printed-ticket scanning if using paper.

Record device/OS, scenario, expected/actual results, and evidence. Obtain a human teammate's PR review before merging. Offline synchronization, real-money payouts, store publication, and production identity checks are outside the MVP.

Cross-team dependencies: a working backend/demo environment, event/staff fixtures, email access, physical devices, and human review. Individual-seat persistence is absent from the backend; never present the preview as working seat reservations.

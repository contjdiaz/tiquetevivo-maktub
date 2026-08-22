# Implementation Plan: QR Dynamic Ticket

## Overview

Transform the static QR code on the TiqueteVivo digital ticket into a dynamic, context-aware component with real-time polling, automatic mode switching based on order state, structured QR payloads for operator scanning, and a lightweight status endpoint. Implementation uses vanilla JavaScript modules deployed on Netlify with Supabase as the data layer.

## Tasks

- [x] 1. Create lightweight status polling endpoint
  - [x] 1.1 Create `netlify/functions/order-status.js` with GET handler that accepts `number` and `slug` query params
    - Use shared `_utils.js` for supabaseAdmin and response helpers
    - Add OPTIONS handler for CORS preflight
    - _Requirements: 6.1, 6.2_
  - [x] 1.2 Implement Supabase query selecting only `status`, `balance`, `paid`, `updated_at` from orders table joined with business slug lookup
    - Return 404 with `{ "error": "Order not found" }` when order does not exist
    - Return 200 with minimal JSON payload `{ status, balance, paid, updated_at }`
    - _Requirements: 6.2, 6.3, 6.4_
  - [ ]* 1.3 Write property test: response payload for any valid order is under 500 bytes
    - **Property 6: Status endpoint response is under 500 bytes**
    - **Validates: Requirements 6.4**

- [x] 2. Create QR payload builder module
  - [x] 2.1 Create `public/js/qr-payload.js` with `buildTrackPayload(order, origin)` that returns the full ticket URL
    - Implement `buildReviewPayload(order, origin)` that returns the ticket URL for archival
    - _Requirements: 3.1, 3.4_
  - [x] 2.2 Implement `buildPickupPayload(order)` that returns structured string `TIQUETEVIVO:PICKUP|ID:{id}|NUM:{order_number}|SLUG:{slug}`
    - Implement `parsePickupPayload(raw)` that decodes structured pickup strings and returns `{ id, orderNumber, slug }` or null
    - _Requirements: 3.2_
  - [x] 2.3 Implement `buildPayPayload(order)` that returns payment string with current balance, account, and reference
    - Format: `PAGO:{balance}|NEQUI:3102688991|REF:TiqueteVivo-{order_number}|NOMBRE:Majesty Lavanderia`
    - _Requirements: 3.3, 3.5_
  - [ ]* 2.4 Write property test for pickup payload round-trip
    - **Property 3: Pickup payload round-trip (encode/decode)**
    - **Validates: Requirements 3.2**
  - [ ]* 2.5 Write property test for invalid pickup payload rejection
    - **Property 7: Invalid pickup payload returns null**
    - **Validates: Requirements 3.2**
  - [ ]* 2.6 Write property test for pay payload balance inclusion
    - **Property 4: Pay QR payload contains current balance**
    - **Validates: Requirements 3.3**

- [x] 3. Create QR mode selector module
  - [x] 3.1 Create `public/js/qr-mode-selector.js` with `selectDefaultMode(status, balance)` mapping statuses to modes
    - RECEIVED/IN_PROGRESS → "track", READY → "pickup", DELIVERED → "review", CANCELLED → "track"
    - _Requirements: 2.1, 2.2, 2.4_
  - [x] 3.2 Implement `getAvailableModes(status, balance)` returning ordered array of available modes
    - Default mode is always first element
    - Include "pay" when balance > 0 and status != DELIVERED
    - _Requirements: 2.3, 2.5_
  - [x] 3.3 Implement user override tracking: `setUserOverride(true/false)` and `shouldAutoSwitch()` logic
    - Reset override when status transitions to a different lifecycle phase
    - _Requirements: 2.5, 2.6_
  - [ ]* 3.4 Write property test for deterministic mode selection
    - **Property 1: QR Mode Selection is deterministic given status and balance**
    - **Validates: Requirements 2.1, 2.2, 2.4**
  - [ ]* 3.5 Write property test for available modes always including default
    - **Property 2: Available modes always include the default mode**
    - **Validates: Requirements 2.1, 2.2, 2.3**
  - [ ]* 3.6 Write property test for balance zero eliminating pay mode
    - **Property 5: Balance zero eliminates pay mode from available modes**
    - **Validates: Requirements 3.6**

- [x] 4. Checkpoint - Verify core modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create QR renderer with color themes
  - [x] 5.1 Create `public/js/qr-renderer.js` with `renderQr(containerEl, payload, mode, size)` function
    - Implement color scheme mapping: track→blue (#1e40af), pickup→green (#065f46), pay→amber (#92400e), review→purple (#6b21a8)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 5.2 Add mode label icons (📍 track, 🏪 pickup, 💳 pay, ⭐ review) rendered below QR
    - Add fallback to external QR API when qrcodejs library is unavailable
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. Create status poller module
  - [x] 6.1 Create `public/js/status-poller.js` with `createStatusPoller({ orderNumber, slug, onUpdate, onError, onOffline, onOnline })` factory
    - Expose `start()`, `stop()`, and `forceCheck()` methods on returned poller object
    - _Requirements: 1.1, 1.2_
  - [x] 6.2 Implement 30-second polling interval with `setInterval`, calling `/api/order-status`
    - Implement automatic stop when terminal status (DELIVERED, CANCELLED) is detected
    - _Requirements: 1.2, 1.3_
  - [x] 6.3 Implement Page Visibility API integration: pause on hidden, resume with immediate fetch on visible
    - _Requirements: 1.4, 1.5_
  - [x] 6.4 Implement network error handling: retry after 60s, call `onOffline` callback, call `onOnline` on recovery
    - _Requirements: 1.6_

- [x] 7. Integrate dynamic QR into Ticket Page
  - [x] 7.1 Add script tags for new modules (status-poller, qr-mode-selector, qr-payload, qr-renderer) in `tiquete.html`
    - _Requirements: 1.1, 2.1_
  - [x] 7.2 Replace existing QR tabs with four-mode tab bar (track, pickup, pay, review) with conditional visibility
    - Hide pay tab when balance is zero
    - _Requirements: 2.5, 3.6_
  - [x] 7.3 Wire `loadTicket()` to initialize status poller and QR mode selector after order is loaded
    - _Requirements: 1.1, 2.6_
  - [x] 7.4 Implement `onOrderUpdate` handler: update stepper, balance, QR mode, and notification banner
    - _Requirements: 1.3, 2.6, 3.5_
  - [x] 7.5 Add offline indicator element and "Ready for Pickup" notification banner
    - Offline bar shows/hides based on poller state
    - Notification banner appears when status transitions to READY
    - _Requirements: 1.6, 5.5_
  - [x] 7.6 Implement manual tab switching that sets user override and re-renders QR with selected mode
    - _Requirements: 2.5, 2.6_

- [x] 8. Checkpoint - Verify ticket page integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement operator QR scanner
  - [x] 9.1 Add html5-qrcode CDN script and scanner button to `app.html` order panel
    - _Requirements: 4.1_
  - [x] 9.2 Create `public/js/scanner.js` with scanner modal: camera feed, overlay, start/stop controls
    - _Requirements: 4.2_
  - [x] 9.3 Implement QR decode handler: call `parsePickupPayload`, lookup order in local array or via API
    - _Requirements: 4.3, 4.5_
  - [x] 9.4 Render scan result card: customer name, order number, items, rack location, balance
    - Add "Mark as Delivered" button that calls `changeOrderStatus(id, 'DELIVERED')`
    - _Requirements: 4.3, 4.4_
  - [x] 9.5 Implement camera permission denied fallback: display message to search order manually
    - Add scan success audio/haptic feedback for operator confirmation
    - _Requirements: 4.6_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- All modules use vanilla JavaScript (no build step) deployed via Netlify
- Existing QR links (`tiquete.html?number=X&slug=Y`) remain backward compatible
- html5-qrcode library loaded via CDN (~40KB), no npm dependencies added

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "3.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.6", "3.4", "3.5", "3.6"] },
    { "id": 4, "tasks": ["5.1", "6.1"] },
    { "id": 5, "tasks": ["5.2", "6.2"] },
    { "id": 6, "tasks": ["6.3", "6.4"] },
    { "id": 7, "tasks": ["7.1", "9.1"] },
    { "id": 8, "tasks": ["7.2", "7.3", "9.2"] },
    { "id": 9, "tasks": ["7.4", "7.5", "9.3"] },
    { "id": 10, "tasks": ["7.6", "9.4"] },
    { "id": 11, "tasks": ["9.5"] }
  ]
}
```

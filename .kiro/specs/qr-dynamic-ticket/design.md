# Design Document: QR Dynamic Ticket

## Overview

This design describes the implementation plan for transforming the static QR code on the TiqueteVivo digital ticket into a dynamic, context-aware component. The system introduces real-time polling, automatic QR mode switching based on order state, structured QR payloads for operator scanning, and a lightweight status endpoint.

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Ticket Page (tiquete.html)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Status_Poller│──▶│ QR Mode      │──▶│ QR_Engine        │  │
│  │ (30s poll)   │  │ Selector     │  │ (qrcodejs render)│  │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
│         │                                                    │
└─────────┼────────────────────────────────────────────────────┘
          │ GET /api/order-status
          ▼
┌─────────────────────────────────────────────────────────────┐
│               Netlify Function: order-status.js             │
│         (lightweight query: status + balance only)           │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase (orders table)                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Operator Panel (app.html)                   │
│  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │ Scanner_View     │  │ Order details + DELIVERED btn  │  │
│  │ (camera + decode)│──▶│ (post-scan result)             │  │
│  └──────────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Polling Flow**: Ticket_Page → Status_Poller (setInterval 30s) → GET `/api/order-status?number=X&slug=Y` → Netlify Function → Supabase select(status, balance, paid, updated_at) → Response → UI Update → QR Mode recalculation
2. **QR Generation Flow**: Order state change detected → `selectQrMode(status, balance, userOverride)` → `buildQrPayload(mode, order)` → `renderQr(payload, colorScheme)` → DOM updated
3. **Scanner Flow**: Operator taps "Scan QR" → Camera activated → QR decoded → `parsePickupPayload(rawData)` → Fetch order by ID → Display order details → Operator taps "Mark Delivered" → PUT `/api/update-order`

## Components and Interfaces

### 1. Lightweight Status Endpoint (`netlify/functions/order-status.js`)

**Purpose**: Serve minimal order data for efficient polling from the Ticket_Page.

**API Contract**:
- Method: GET
- Path: `/api/order-status`
- Query params: `number` (order number), `slug` (business slug)
- Response (200): `{ "status": "READY", "balance": 70000, "paid": 60000, "updated_at": "2025-01-15T10:30:00Z" }`
- Response (404): `{ "error": "Order not found" }`

**Implementation**:
- Uses shared `_utils.js` (supabaseAdmin, json, getBusinessBySlug)
- Queries only `status, balance, paid, updated_at` columns to minimize DB load
- No authentication required (public ticket page)

### 2. Status Poller Module (`public/js/status-poller.js`)

**Purpose**: Periodically check for order updates and trigger UI/QR refreshes.

**Behavior**:
- Starts polling on page load if order status is not terminal (DELIVERED, CANCELLED)
- Uses `setInterval` with 30,000ms interval
- Integrates with Page Visibility API: pauses on `visibilitychange` when hidden, resumes with immediate fetch when visible
- On network error: clears current interval, retries with 60,000ms, shows offline indicator
- On status change detection (compares `updated_at`): triggers `onOrderUpdate` callback
- Stops automatically when terminal status is reached

**Exports**:
```javascript
function createStatusPoller({ orderNumber, slug, onUpdate, onError, onOffline, onOnline })
// Returns: { start(), stop(), forceCheck() }
```

### 3. QR Mode Selector Module (`public/js/qr-mode-selector.js`)

**Purpose**: Determine the appropriate QR mode based on order state and manage mode transitions.

**Mode Selection Logic**:
```
function selectDefaultMode(status, balance):
  if status in [RECEIVED, IN_PROGRESS] → "track"
  if status == READY → "pickup"
  if status == DELIVERED → "review"
  if status == CANCELLED → "track" (fallback)

function getAvailableModes(status, balance):
  modes = [selectDefaultMode(status, balance)]
  if balance > 0 AND status != DELIVERED → add "pay"
  if status == READY → ensure both "pickup" and "track" available
  return modes
```

**User Override Tracking**:
- Tracks whether user has manually selected a mode via `userHasOverridden` flag
- On status change: if `userHasOverridden` is false → auto-switch to new default
- On manual tab click: set `userHasOverridden = true`
- On status change to a *different* lifecycle phase → reset `userHasOverridden = false`

### 4. QR Payload Builder Module (`public/js/qr-payload.js`)

**Purpose**: Generate QR data strings for each mode.

**Payload Formats**:

| Mode | Format | Example |
|------|--------|---------|
| track | URL | `https://tiquetevivo.netlify.app/tiquete.html?number=8707&slug=majesty` |
| pickup | Structured | `TIQUETEVIVO:PICKUP\|ID:{uuid}\|NUM:{order_number}\|SLUG:{slug}` |
| pay | Payment | `PAGO:{balance}\|NEQUI:3102688991\|REF:TiqueteVivo-{order_number}\|NOMBRE:Majesty Lavanderia` |
| review | URL | `https://tiquetevivo.netlify.app/tiquete.html?number=8707&slug=majesty` |

**Round-Trip Parsing** (for operator scanner):
```javascript
function buildPickupPayload(order) → string
function parsePickupPayload(raw) → { id, orderNumber, slug } | null
```

### 5. QR Renderer with Color Themes (`public/js/qr-renderer.js`)

**Purpose**: Render QR codes with mode-specific color schemes using qrcodejs.

**Color Schemes**:
| Mode | Dark Color | Label Icon |
|------|-----------|------------|
| track | #1e40af (blue) | 📍 |
| pickup | #065f46 (green) | 🏪 |
| pay | #92400e (amber) | 💳 |
| review | #6b21a8 (purple) | ⭐ |

### 6. Scanner View (`public/js/scanner.js`)

**Purpose**: Enable operators to scan Pickup_QR codes and identify orders.

**Implementation**:
- Uses a lightweight JS QR scanning library (html5-qrcode via CDN, ~40KB)
- Renders camera feed inside a modal overlay in `app.html`
- On successful decode: calls `parsePickupPayload(rawData)` → fetches order from local `orders` array or API
- Displays: customer name, order number, items, rack location, balance
- Provides "Mark as Delivered" button that calls `changeOrderStatus(id, 'DELIVERED')`
- Fallback: if camera permission denied, shows manual search prompt

### 7. Updated Ticket Page Integration

**Changes to `tiquete.html`**:
- Import new modules (status-poller, qr-mode-selector, qr-payload, qr-renderer)
- Replace current static QR rendering with dynamic QR_Engine
- Add new QR tabs: track (new), pickup (existing), pay (existing), review (new)
- Add offline indicator element
- Add "ready for pickup" notification banner (hidden by default)
- Add visibility change listener

## Data Models

### Order Status Response

The polling endpoint returns a minimal projection of the order record:

```javascript
{
  "status": "READY",       // Order_Status enum: RECEIVED | IN_PROGRESS | READY | DELIVERED | CANCELLED
  "balance": 70000,        // Remaining balance in COP (numeric, 0 or positive)
  "paid": 60000,           // Amount already paid in COP (numeric, 0 or positive)
  "updated_at": "2025-01-15T10:30:00Z"  // ISO 8601 timestamp of last modification
}
```

### QR Pickup Payload Structure

Structured string encoded in the Pickup_QR for operator scanning:

```
TIQUETEVIVO:PICKUP|ID:{uuid}|NUM:{order_number}|SLUG:{slug}
```

| Field | Type | Description |
|-------|------|-------------|
| ID | UUID (string) | Unique order identifier from Supabase |
| NUM | Integer (string) | Human-readable order number |
| SLUG | String | Business slug identifier |

### QR Pay Payload Structure

Payment information encoded for the Pay_QR mode:

```
PAGO:{balance}|NEQUI:{account}|REF:TiqueteVivo-{order_number}|NOMBRE:{business_name}
```

| Field | Type | Description |
|-------|------|-------------|
| balance | Integer | Remaining balance in COP |
| account | String | Nequi payment account number |
| order_number | Integer | Order reference number |
| business_name | String | Business display name |

### Order Status Enum

| Value | Description | Default QR Mode |
|-------|-------------|-----------------|
| RECEIVED | Order created, awaiting processing | track |
| IN_PROGRESS | Order being processed | track |
| READY | Order complete, awaiting pickup | pickup |
| DELIVERED | Order handed to customer | review |
| CANCELLED | Order cancelled | track |

## File Structure

```
public/
├── js/
│   ├── status-poller.js       (new)
│   ├── qr-mode-selector.js   (new)
│   ├── qr-payload.js         (new)
│   ├── qr-renderer.js        (new)
│   └── scanner.js            (new)
├── tiquete.html               (modified)
└── app.html                   (modified — add scanner button + modal)

netlify/functions/
└── order-status.js            (new)

tests/
├── qr-mode-selector.test.js  (new)
├── qr-payload.test.js        (new)
├── status-poller.test.js     (new)
└── order-status.test.js      (new)
```

## Correctness Properties

### Property 1: QR Mode Selection is deterministic given status and balance

For all valid Order_Status values and non-negative balance amounts, `selectDefaultMode(status, balance)` always returns exactly one of: "track", "pickup", "pay", or "review". The mapping is:
- RECEIVED → "track"
- IN_PROGRESS → "track"
- READY → "pickup"
- DELIVERED → "review"
- CANCELLED → "track"

**Type**: Metamorphic property (input partition → output partition)

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 2: Available modes always include the default mode

For all valid combinations of Order_Status and balance, the result of `getAvailableModes(status, balance)` always contains `selectDefaultMode(status, balance)` as its first element.

**Type**: Invariant

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Pickup payload round-trip (encode/decode)

For all valid order objects with non-empty id, order_number, and slug fields, `parsePickupPayload(buildPickupPayload(order))` produces an object where `id === order.id`, `orderNumber === order.order_number`, and `slug === order.slug`.

**Type**: Round-trip property

**Validates: Requirements 3.2**

### Property 4: Pay QR payload contains current balance

For all valid order objects with balance > 0, the string produced by `buildPayPayload(order)` contains the numeric balance value as a substring in the format `PAGO:{balance}`.

**Type**: Metamorphic property

**Validates: Requirements 3.3**

### Property 5: Balance zero eliminates pay mode from available modes

For all valid Order_Status values, when balance equals 0, `getAvailableModes(status, 0)` does not contain "pay".

**Type**: Invariant (conditional)

**Validates: Requirements 3.6**

### Property 6: Status endpoint response is under 500 bytes

For all valid order records (with status values from the allowed set and numeric balance/paid values within the schema's numeric(12,2) range), the JSON serialization of the order-status response is less than 500 bytes.

**Type**: Invariant (size bound)

**Validates: Requirements 6.4**

### Property 7: Invalid pickup payload returns null

For all strings that do not begin with the `TIQUETEVIVO:PICKUP|` prefix, `parsePickupPayload(input)` returns null.

**Type**: Error condition

**Validates: Requirements 3.2, 4.5**

## Error Handling

### Status Poller Errors

| Scenario | Behavior |
|----------|----------|
| Network error (fetch fails) | Clear current 30s interval, switch to 60s retry interval, show offline indicator on Ticket_Page |
| Network recovery | Hide offline indicator, resume 30s polling, trigger immediate status fetch |
| HTTP 404 from `/api/order-status` | Stop polling, display "Order not found" message on Ticket_Page |
| HTTP 5xx from `/api/order-status` | Treat as transient network error (same retry logic as above) |
| Response parsing error (invalid JSON) | Log error to console, treat as transient failure, retry at 60s |

### Scanner Errors

| Scenario | Behavior |
|----------|----------|
| Camera permission denied | Close camera modal, show fallback message instructing manual order search by number |
| Camera not available (no hardware) | Same as permission denied — show manual search fallback |
| QR decoded but payload format invalid | Show "Invalid QR code" message in scanner overlay, allow retry |
| QR decoded but order not found (ID mismatch) | Show "Order not found" error with decoded order number, allow retry |
| Camera stream interrupted mid-scan | Show "Camera disconnected" message, offer button to re-initialize |

### Status Endpoint Errors

| Scenario | Response |
|----------|----------|
| Missing `number` or `slug` query param | HTTP 400 `{ "error": "Missing required parameters: number, slug" }` |
| Order not found for given number+slug | HTTP 404 `{ "error": "Order not found" }` |
| Supabase connection failure | HTTP 500 `{ "error": "Internal server error" }` |
| Invalid query param format (non-numeric number) | HTTP 400 `{ "error": "Invalid order number format" }` |

## Testing Strategy

- **Property-based tests** (fast-check): Properties 1–7 above will be tested with generated inputs covering status enums, arbitrary balance values, and random order data.
- **Integration tests**: Scanner flow end-to-end, polling lifecycle with mocked timers, UI mode switching.
- **Manual tests**: Camera access on mobile, real QR scanning, visual color scheme verification.

## Dependencies

- **Existing**: qrcodejs (CDN, already in use)
- **New**: html5-qrcode library (CDN) for operator scanner camera decoding — lightweight (~40KB), no build step needed, works with vanilla JS

## Migration Notes

- The existing `switchQrMode` function in `tiquete.html` will be replaced by the new `qr-mode-selector.js` module
- The existing `renderQR` and `buildPayQrData` functions will be replaced by `qr-payload.js` and `qr-renderer.js`
- Backward compatibility: existing QR links (`tiquete.html?number=X&slug=Y`) remain valid
- No database schema changes required — all needed fields (status, balance, paid, updated_at) already exist

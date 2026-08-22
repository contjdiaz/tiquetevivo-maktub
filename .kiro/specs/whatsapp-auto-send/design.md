# Design Document

## Overview

This design describes how to implement automatic WhatsApp sending via Meta Cloud API upon order creation and status changes, WhatsApp message logging, complete CRUD operations (soft-delete, hard-delete, deactivate), and input validation across all endpoints in the TiqueteVivo platform.

The architecture leverages the existing Netlify Functions (serverless Node.js ES modules) + Supabase stack. The WhatsApp_Sender function already exists and handles Meta API calls — the core change is invoking it server-side from create-order and update-order rather than relying on frontend wa.me links.

## Architecture

### Component Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────────┐
│   Frontend   │──────▶│  Order_Service   │──────▶│ WhatsApp_Sender  │
│ (app.html)   │       │ (create-order.js)│       │ (internal module)│
└──────────────┘       └──────────────────┘       └──────────────────┘
                              │                          │
                              ▼                          ▼
                       ┌──────────────┐          ┌──────────────────┐
                       │   Supabase   │          │  Meta Cloud API  │
                       │ (orders tbl) │          │ (graph.facebook) │
                       └──────────────┘          └──────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │ whatsapp_messages│
                       │    (log table)   │
                       └──────────────────┘
```

### Key Design Decisions

1. **Internal module, not HTTP call**: WhatsApp_Sender logic will be extracted into a shared module (`_whatsapp.js`) importable by other functions, avoiding the overhead of self-invoking HTTP endpoints.
2. **Fire-and-don't-block pattern**: Order creation always succeeds. WhatsApp sending is attempted after persistence; failures produce a fallback link but never roll back the order.
3. **Schema additions are minimal**: Add `cancelled_at` column to orders, `active` and `deactivated_at` columns to businesses. The whatsapp_messages table already exists.
4. **Validation module**: A shared `_validators.js` module provides reusable validation functions for phone, amounts, and enums.

## Components and Interfaces

### 1. Shared WhatsApp Module (`netlify/functions/_whatsapp.js`)

Extracted from the existing `whatsapp-sender.js` HTTP handler into an importable module:

- `sendWhatsAppMessage({ to, text, templateName, templateParams })` — calls Meta API or returns dry-run result
- `buildFallbackLink(phone, text)` — generates wa.me URL for manual fallback
- `logWhatsAppMessage(supabase, { orderId, businessId, phone, templateName, messageBody, metaMessageId, status, errorMessage })` — inserts into whatsapp_messages table

The existing `whatsapp-sender.js` HTTP handler will import from this module to avoid code duplication.

### 2. Shared Validators Module (`netlify/functions/_validators.js`)

- `validatePhone(phone)` — returns `{ valid, normalized, error }`. Strips +, spaces, dashes; checks 10-15 digits.
- `validateAmount(value, fieldName)` — returns `{ valid, value, error }`. Checks non-negative, max 99999999.99.
- `validateStatus(status)` — returns `{ valid, error }`. Checks against allowed enum values.
- `validateRequired(body, fields)` — returns `{ valid, errors[] }`. Checks required fields are present and non-empty.

### 3. Modified `create-order.js`

After successful order insert:
1. Call `sendWhatsAppMessage` with customer phone and built message.
2. On success: update `whatsapp_sent_at`, log message with status 'SENT'.
3. On failure/dry-run: log message with status 'FAILED' or 'DRY_RUN', include fallback link in response.
4. Add input validation using `_validators.js` before database insert.

### 4. Modified `update-order.js`

After successful status update:
1. If new status is 'READY' or 'DELIVERED': call `sendWhatsAppMessage` with appropriate template/message.
2. On success: update `whatsapp_sent_at`, log message.
3. On failure: include fallback link in response, do not revert status.
4. For all other statuses: skip WhatsApp notification.
5. Add input validation for updated fields.

### 5. New `delete-order.js` (Order_Manager)

- `DELETE /api/delete-order` with body `{ orderId, businessSlug, confirm: true }`
- `POST /api/delete-order` with body `{ orderId, businessSlug, action: "cancel" | "hard-delete", confirm: true }`
- Cancel: sets status='CANCELLED', cancelled_at=now()
- Hard-delete: removes row (requires confirm=true)

### 6. New `manage-business.js` (Business_Manager)

- `POST /api/manage-business` with body `{ slug, action: "deactivate" | "reactivate" }`
- Deactivate: sets active=false, deactivated_at=now()
- Reactivate: sets active=true, deactivated_at=null

## Data Models

### Orders Table (existing, modified)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Unique order identifier |
| business_id | uuid (FK) | Reference to businesses table |
| customer_phone | text | Customer phone in international format |
| status | text | One of: RECEIVED, IN_PROGRESS, READY, DELIVERED, CANCELLED |
| total | numeric(12,2) | Order total amount |
| paid | numeric(12,2) | Amount paid by customer |
| whatsapp_sent_at | timestamptz | Timestamp of last successful WhatsApp send |
| **cancelled_at** | **timestamptz** | **NEW — Timestamp when order was cancelled (soft-delete)** |
| created_at | timestamptz | Order creation timestamp |

### Businesses Table (existing, modified)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Unique business identifier |
| slug | text (unique) | URL-friendly business identifier |
| name | text | Business display name |
| phone | text | Business WhatsApp phone number |
| **active** | **boolean NOT NULL DEFAULT true** | **NEW — Whether business is active** |
| **deactivated_at** | **timestamptz** | **NEW — Timestamp when business was deactivated** |

### WhatsApp Messages Table (existing)

| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Unique message record identifier |
| order_id | uuid (FK) | Reference to orders table |
| business_id | uuid (FK) | Reference to businesses table |
| phone | text | Recipient phone number |
| template_name | text | Template used (null for free-text) |
| message_body | text | Full message content sent |
| meta_message_id | text | Message ID returned by Meta API (null on failure) |
| status | text | One of: SENT, FAILED, DRY_RUN |
| error_message | text | Error description (null on success) |
| created_at | timestamptz | Record creation timestamp |

### Schema Migration SQL

```sql
-- Add cancelled_at to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Add active flag and deactivated_at to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Order persistence is independent of WhatsApp outcome

*For any* valid order payload, the order is persisted in the database regardless of whether the WhatsApp API call succeeds, fails, or runs in dry-run mode. The order creation response always contains the full order object.

**Validates: Requirements 1.5, 3.4**

### Property 2: Every WhatsApp send attempt produces a log record

*For any* invocation of sendWhatsAppMessage (success, failure, or dry-run), exactly one record is inserted into whatsapp_messages with the corresponding status ('SENT', 'FAILED', or 'DRY_RUN').

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 3: Phone validation accepts only valid international formats

*For any* string input, validatePhone returns valid=true only if the string (after stripping +, spaces, dashes) is composed entirely of digits, has length between 10 and 15, and starts with a valid country code prefix. All other strings return valid=false with an error message.

**Validates: Requirements 8.1, 8.4**

### Property 4: Amount validation accepts only non-negative numbers within range

*For any* input value, validateAmount returns valid=true only if the value is a finite number >= 0 and <= 99999999.99. All other inputs (negative, NaN, Infinity, strings, exceeding max) return valid=false.

**Validates: Requirements 8.2**

### Property 5: Status notifications are sent only for READY and DELIVERED

*For any* status update operation, a WhatsApp notification is triggered if and only if the new status is 'READY' or 'DELIVERED'. Status changes to 'RECEIVED', 'IN_PROGRESS', or 'CANCELLED' produce no WhatsApp send attempt.

**Validates: Requirements 3.1, 3.2, 3.5**

### Property 6: Soft-delete is idempotent and does not destroy data

*For any* cancel operation on a valid order, the order remains in the database with status='CANCELLED' and a non-null cancelled_at. Cancelling an already-cancelled order returns an error without modifying the record. The order data is never removed from the database by a cancel operation.

**Validates: Requirements 5.1, 5.2**

### Property 7: Hard-delete requires explicit confirmation

*For any* hard-delete request where confirm is not exactly true, the request is rejected with a 400 error and no data is deleted. Only requests with confirm=true proceed with deletion.

**Validates: Requirements 6.1, 6.2**

### Property 8: Deactivated businesses cannot receive new orders

*For any* order creation attempt targeting a business where active=false, the Order_Service rejects the request with a 403 error and no order is persisted.

**Validates: Requirements 7.4**

### Property 9: Status value validation accepts only allowed enum values

*For any* input to validateStatus, the function returns valid=true only if the value is one of: 'RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'. All other values return valid=false.

**Validates: Requirements 8.5**

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Meta API returns 4xx/5xx | Log as FAILED, return order + fallback link |
| Meta API timeout | Log as FAILED, return order + fallback link |
| No credentials configured | Log as DRY_RUN, return order + fallback link |
| Invalid phone format | Return 400 before any DB operation |
| Invalid amount | Return 400 before any DB operation |
| Invalid status value | Return 400 before any DB operation |
| Order not found (delete/cancel) | Return 404 with descriptive message |
| Order already cancelled | Return 400 indicating already cancelled |
| Business not found (deactivate) | Return 404 with descriptive message |
| Business already deactivated | Return 400 indicating already inactive |
| Business deactivated (create order) | Return 403 indicating business inactive |
| Missing confirmation (hard-delete) | Return 400 requiring explicit confirmation |

### Error Response Format

All error responses follow a consistent JSON structure:

```json
{
  "error": true,
  "message": "Descriptive error message identifying the field and reason",
  "field": "customer_phone" // (optional, for validation errors)
}
```

## Testing Strategy

### Property-Based Testing

This feature is suitable for property-based testing because it contains pure validation functions with clear input/output behavior and universal properties that hold across a wide input space.

**Library:** [fast-check](https://github.com/dubzzz/fast-check) (JavaScript PBT library)

**Configuration:** Minimum 100 iterations per property test.

**Tag format:** `Feature: whatsapp-auto-send, Property {number}: {property_text}`

#### Property Tests

| Property | Test Description | Generator Strategy |
|----------|-----------------|-------------------|
| Property 3 | Phone validation | Generate random strings (digits, special chars, varying lengths) and verify validatePhone classifies them correctly |
| Property 4 | Amount validation | Generate random numbers (negative, zero, positive, edge cases, non-numbers) and verify validateAmount classifies them correctly |
| Property 5 | Status notification trigger | Generate all possible status transitions and verify WhatsApp is triggered only for READY/DELIVERED |
| Property 6 | Soft-delete idempotence | Generate sequences of cancel operations on order states and verify data preservation |
| Property 7 | Hard-delete guard | Generate requests with various confirm values (true, false, undefined, null, "true") and verify only boolean true proceeds |
| Property 9 | Status enum validation | Generate random strings and verify only the 5 allowed values pass validation |

### Unit Tests (Example-Based)

| Scenario | Test Description |
|----------|-----------------|
| Property 1 | Order persists when WhatsApp succeeds, fails, or is in dry-run mode (3 examples) |
| Property 2 | Log record created for each WhatsApp outcome (SENT, FAILED, DRY_RUN) |
| Property 8 | Order creation rejected for deactivated business (1 example) |
| Requirement 4 | Template vs free-text selection based on 24-hour window |
| Requirement 6.4 | Cascade deletion of related whatsapp_messages on hard-delete |

### Integration Tests

| Scenario | Test Description |
|----------|-----------------|
| Full order creation flow | Create order → WhatsApp sent → log created → response includes order + send result |
| Status change notification | Update status to READY → WhatsApp notification sent → log created |
| Dry-run mode | Remove credentials → create order → order persists → fallback link returned |
| Cancel then create | Deactivate business → attempt create order → 403 returned |

## File Structure

```
netlify/functions/
├── _utils.js              (existing — no changes)
├── _sheets.js             (existing — no changes)
├── _whatsapp.js           (NEW — shared WhatsApp module)
├── _validators.js         (NEW — shared validation module)
├── create-order.js        (MODIFIED — add auto-send + validation)
├── update-order.js        (MODIFIED — add status notification + validation)
├── whatsapp-sender.js     (MODIFIED — imports from _whatsapp.js)
├── delete-order.js        (NEW — cancel + hard-delete)
├── manage-business.js     (NEW — deactivate/reactivate)
├── list-orders.js         (existing — no changes)
├── save-business.js       (existing — add validation)
└── save-lead.js           (existing — no changes)

supabase/
└── schema.sql             (MODIFIED — add new columns)
```

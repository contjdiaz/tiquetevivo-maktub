# Implementation Plan: WhatsApp Auto-Send

## Overview

Implement automatic WhatsApp message sending via Meta Cloud API upon order creation and status changes, WhatsApp message logging, complete CRUD operations (soft-delete, hard-delete, deactivate), and input validation across all endpoints. The implementation uses shared modules (`_whatsapp.js` and `_validators.js`) to centralize logic, modifies existing functions to integrate auto-send and validation, and adds new functions for order deletion and business management.

## Tasks

- [x] 1. Create shared WhatsApp module (`_whatsapp.js`)
  - [x] 1.1 Create `netlify/functions/_whatsapp.js` with `sendWhatsAppMessage({ to, text, templateName, templateParams })` function that calls Meta Cloud API
    - Implement dry-run detection (skip API call when WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID is empty)
    - _Requirements: 1.1, 1.6, 4.1, 4.2, 4.4_
  - [x] 1.2 Implement `buildFallbackLink(phone, text)` that generates a properly encoded wa.me URL
    - _Requirements: 1.4, 1.6_
  - [x] 1.3 Implement `logWhatsAppMessage(supabase, { orderId, businessId, phone, templateName, messageBody, metaMessageId, status, errorMessage })` that inserts into whatsapp_messages table
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 1.4 Implement template message support — when templateName is provided, send Meta template format instead of free text
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 1.5 Re-export `buildOrderMessage` from existing whatsapp-sender.js for reuse
    - _Requirements: 1.1_
  - [x] 1.6 Write property test for WhatsApp message logging
    - **Property 2: Every WhatsApp send attempt produces a log record**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

- [x] 2. Create shared validators module (`_validators.js`)
  - [x] 2.1 Create `netlify/functions/_validators.js` with `validatePhone(phone)` — strips +/spaces/dashes, checks 10-15 digits
    - _Requirements: 8.1, 8.4_
  - [x] 2.2 Implement `validateAmount(value, fieldName)` — checks non-negative, finite, max 99999999.99
    - _Requirements: 8.2_
  - [x] 2.3 Implement `validateStatus(status)` — checks against ['RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED']
    - _Requirements: 8.5_
  - [x] 2.4 Implement `validateRequired(body, fields)` — checks required fields are present and non-empty
    - _Requirements: 8.3_
  - [x] 2.5 Write property test for phone validation
    - **Property 3: Phone validation accepts only valid international formats**
    - **Validates: Requirements 8.1, 8.4**
  - [x] 2.6 Write property test for amount validation
    - **Property 4: Amount validation accepts only non-negative numbers within range**
    - **Validates: Requirements 8.2**
  - [x] 2.7 Write property test for status enum validation
    - **Property 9: Status value validation accepts only allowed enum values**
    - **Validates: Requirements 8.5**

- [x] 3. Checkpoint - Ensure shared modules are complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Modify `create-order.js` for auto-send and validation
  - [x] 4.1 Import `_validators.js` and add input validation (phone, amounts, required fields) before database insert
    - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - [x] 4.2 Check business active status before creating order — reject with 403 if business is deactivated
    - _Requirements: 7.4_
  - [x] 4.3 Import `_whatsapp.js` and call `sendWhatsAppMessage` after successful order insert
    - On successful send: update order's `whatsapp_sent_at` and log with status 'SENT'
    - On API failure: log with status 'FAILED', include fallback link in response without failing order creation
    - On dry-run: log with status 'DRY_RUN', include fallback link in response
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [-] 4.4 Write property test for order persistence independence
    - **Property 1: Order persistence is independent of WhatsApp outcome**
    - **Validates: Requirements 1.5, 3.4**
  - [-] 4.5 Write property test for deactivated business rejection
    - **Property 8: Deactivated businesses cannot receive new orders**
    - **Validates: Requirements 7.4**

- [ ] 5. Modify `update-order.js` for status notifications and validation
  - [x] 5.1 Import `_validators.js` and add input validation for updatable fields (status, amounts)
    - _Requirements: 8.2, 8.5_
  - [x] 5.2 Import `_whatsapp.js` and detect status changes to 'READY' or 'DELIVERED'
    - On READY/DELIVERED status change: send WhatsApp notification with appropriate message template
    - On successful notification: update `whatsapp_sent_at` and log message
    - On notification failure: include fallback link in response without reverting status update
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 5.3 Ensure no notification is sent for IN_PROGRESS or CANCELLED status changes
    - _Requirements: 3.5_
  - [-] 5.4 Write property test for status notification trigger
    - **Property 5: Status notifications are sent only for READY and DELIVERED**
    - **Validates: Requirements 3.1, 3.2, 3.5**

- [ ] 6. Create `delete-order.js` (Order_Manager)
  - [x] 6.1 Create `netlify/functions/delete-order.js` with POST handler supporting `action: "cancel"` and `action: "hard-delete"`
    - _Requirements: 5.1, 6.1_
  - [x] 6.2 Implement cancel action: set status='CANCELLED' and cancelled_at=now(), validate ownership via business_id/slug
    - Add error handling: 404 for non-existent orders, 400 for already-cancelled
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 6.3 Implement hard-delete action: require confirm=true flag, permanently delete order row
    - Add error handling: 404 for non-existent orders, 400 for missing confirmation
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [-] 6.4 Write property test for soft-delete idempotence
    - **Property 6: Soft-delete is idempotent and does not destroy data**
    - **Validates: Requirements 5.1, 5.2**
  - [-] 6.5 Write property test for hard-delete confirmation guard
    - **Property 7: Hard-delete requires explicit confirmation**
    - **Validates: Requirements 6.1, 6.2**

- [x] 7. Create `manage-business.js` (Business_Manager)
  - [x] 7.1 Create `netlify/functions/manage-business.js` with POST handler supporting `action: "deactivate"` and `action: "reactivate"`
    - _Requirements: 7.1_
  - [x] 7.2 Implement deactivate: set active=false, deactivated_at=now(); validate business exists
    - Add error handling: 404 for non-existent business, 400 for already-deactivated
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 7.3 Implement reactivate: set active=true, deactivated_at=null; validate business exists
    - Add error handling: 404 for non-existent business, 400 for already-active
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 7.4 Add phone validation on business endpoints using `_validators.js`
    - _Requirements: 8.4_

- [x] 8. Database schema migration
  - [x] 8.1 Add `cancelled_at timestamptz` column to orders table in schema.sql
    - _Requirements: 5.1_
  - [x] 8.2 Add `active boolean NOT NULL DEFAULT true` and `deactivated_at timestamptz` columns to businesses table in schema.sql
    - _Requirements: 7.1_
  - [x] 8.3 Create a migration script (`supabase/migrations/001_add_cancel_and_active_columns.sql`) for applying to existing database
    - _Requirements: 5.1, 7.1_

- [x] 9. Checkpoint - Ensure all core functionality works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Refactor existing `whatsapp-sender.js` HTTP handler
  - [x] 10.1 Refactor `whatsapp-sender.js` to import and use `sendWhatsAppMessage` from `_whatsapp.js` instead of inline API call
    - _Requirements: 1.1_
  - [x] 10.2 Keep `buildOrderMessage` in `_whatsapp.js` (moved from whatsapp-sender.js) and re-export it
    - _Requirements: 1.1_
  - [x] 10.3 Ensure the HTTP handler still works as before for direct API calls from external consumers
    - _Requirements: 1.1_

- [x] 11. Update `save-business.js` with validation
  - [x] 11.1 Import `_validators.js` and add phone format validation on business phone field
    - _Requirements: 8.4_
  - [x] 11.2 Add required field validation (name, slug)
    - _Requirements: 8.3_
  - [x] 11.3 Return descriptive 400 errors for validation failures
    - _Requirements: 8.3_

- [x] 12. Update package.json check script and final wiring
  - [x] 12.1 Add new function files to the `check` script in package.json (delete-order.js, manage-business.js)
    - _Requirements: 8.3_
  - [x] 12.2 Run `node --check` on all modified and new files to verify syntax correctness
    - _Requirements: 8.3_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check library
- Unit tests validate specific examples and edge cases
- Tasks 1-2 are independent foundational modules that can be built in parallel
- Tasks 4-8 depend on Tasks 1-2 being complete
- Tasks 10-12 depend on all prior implementation tasks

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "2.1", "2.2", "2.3", "2.4", "8.1", "8.2", "8.3"] },
    { "id": 1, "tasks": ["1.6", "2.5", "2.6", "2.7"] },
    { "id": 2, "tasks": ["4.1", "4.2", "4.3", "5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "7.1", "7.2", "7.3", "7.4"] },
    { "id": 3, "tasks": ["4.4", "4.5", "5.4", "6.4", "6.5"] },
    { "id": 4, "tasks": ["10.1", "10.2", "10.3", "11.1", "11.2", "11.3"] },
    { "id": 5, "tasks": ["12.1", "12.2"] }
  ]
}
```

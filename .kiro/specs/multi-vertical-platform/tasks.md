# Implementation Plan: Multi-Vertical Platform

## Overview

Transform TiqueteVivo from a laundry-only platform into a multi-vertical SaaS system. Implementation follows a bottom-up approach: database schema first, then shared modules (vertical config, validators, template engine), then function modifications, and finally frontend adaptation.

## Tasks

- [x] 1. Database schema migration and seed data
  - [x] 1.1 Create the verticals table and extend businesses/orders tables
    - Create migration file `supabase/migrations/XXXX_multi_vertical_schema.sql`
    - Create `verticals` table with columns: id (uuid PK), slug (text unique), name (text), emoji (text), services_default (jsonb), custom_fields_default (jsonb), status_flow_default (jsonb), whatsapp_templates_default (jsonb), active (boolean), created_at (timestamptz)
    - ALTER `businesses` table: add vertical_id (uuid FK), services_config (jsonb), custom_fields_config (jsonb), status_flow_config (jsonb), whatsapp_templates_config (jsonb)
    - ALTER `orders` table: add custom_fields (jsonb), DROP the status CHECK constraint
    - Add RLS policies: verticals readable by all authenticated, writable only by service_role
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 8.1, 8.2, 8.5_

  - [x] 1.2 Create seed data migration for 12 verticals
    - Create migration file `supabase/migrations/XXXX_seed_verticals.sql`
    - Insert seed data for all 12 verticals: laundry, parking, shoe-repair, mechanic, bakery, tailor, pet-daycare, courier, print-center, salon, gym-locker, nursery
    - Each entry includes services_default, custom_fields_default, status_flow_default, whatsapp_templates_default as specified in requirements
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

  - [x] 1.3 Create data migration for existing laundry businesses and orders
    - Create migration file `supabase/migrations/XXXX_migrate_existing_data.sql`
    - Assign all existing businesses to the "laundry" vertical (set vertical_id, copy laundry defaults into services_config, custom_fields_config, status_flow_config, whatsapp_templates_config)
    - Migrate existing orders: copy is_delicate and rack_location values into custom_fields JSONB column
    - _Requirements: 9.5, 12.1, 12.2, 12.3_

- [x] 2. Vertical Config Module
  - [x] 2.1 Implement `_vertical-config.js` shared module
    - Create `netlify/functions/_vertical-config.js`
    - Implement `getBusinessConfig(supabase, businessId)` — fetches business row with joined vertical data, returns merged config
    - Implement `getVerticalBySlug(supabase, slug)` — fetches vertical definition by slug
    - Implement `applyVerticalDefaults(supabase, businessId, vertical)` — copies vertical defaults into business columns
    - Export all functions as named exports
    - _Requirements: 1.6, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.2 Write property test: Vertical configuration round-trip
    - **Property 1: Vertical configuration round-trip**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
    - Create `tests/vertical-config.roundtrip.property.test.js`
    - Use fast-check to generate arbitrary vertical definitions, verify store/retrieve returns identical config

  - [ ]* 2.3 Write property test: Defaults propagation on registration
    - **Property 2: Defaults propagation on registration**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**
    - Create `tests/vertical-defaults-propagation.property.test.js`
    - Verify that after applying defaults, business config equals vertical defaults

  - [ ]* 2.4 Write property test: Registration rejects invalid vertical slugs
    - **Property 3: Registration rejects invalid vertical slugs**
    - **Validates: Requirements 3.1, 3.6**
    - Create `tests/registration-validation.property.test.js`
    - Verify that non-existent slugs produce 400 errors

- [x] 3. Custom Field and Status Validators
  - [x] 3.1 Implement custom field validation in `_validators.js`
    - Extend `netlify/functions/_validators.js` with `validateCustomFields(values, definitions)`
    - Validate field_type: text accepts strings, number accepts numeric, date accepts valid date strings, datetime accepts valid datetime strings, boolean accepts true/false, select accepts values from options list
    - Return `{ valid, errors }` with descriptive error messages referencing display_label
    - Validate required fields — reject if missing or null
    - _Requirements: 5.2, 5.4_

  - [x] 3.2 Implement status flow validation in `_validators.js`
    - Add `validateStatusInFlow(status, statusFlow)` — case-insensitive check that status exists in the flow
    - Add `validateStatusTransition(currentStatus, targetStatus, statusFlow)` — validates target is next sequential step or CANCELLED
    - Return `{ valid, error }` with descriptive error messages listing valid options
    - _Requirements: 6.2, 6.3, 6.5_

  - [ ]* 3.3 Write property test: Custom field type validation
    - **Property 7: Custom field type validation**
    - **Validates: Requirements 5.2, 5.4**
    - Create `tests/custom-field-validation.property.test.js`
    - Generate arbitrary field definitions and values, verify acceptance/rejection matches type rules

  - [ ]* 3.4 Write property test: Status flow validation
    - **Property 9: Status flow validation**
    - **Validates: Requirements 6.2, 6.3**
    - Create `tests/status-flow-validation.property.test.js`
    - Generate arbitrary status flows and query strings, verify acceptance iff status_key matches

  - [ ]* 3.5 Write property test: Sequential status progression
    - **Property 10: Sequential status progression**
    - **Validates: Requirements 6.5**
    - Create `tests/status-progression.property.test.js`
    - Verify transitions only valid to next step or CANCELLED

- [x] 4. Template Engine Module
  - [x] 4.1 Implement `_template-engine.js` module
    - Create `netlify/functions/_template-engine.js`
    - Implement `selectTemplate(triggerEvent, businessTemplates, verticalTemplates)` — priority: business override > vertical default > generic fallback
    - Implement `renderTemplate(template, orderData, businessData)` — interpolate all placeholders including {custom.*}, replace unresolved with empty string
    - Generic fallback must contain {order_number}, {business_name}, and {status_label}
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 4.2 Write property test: Template selection priority
    - **Property 11: Template selection priority**
    - **Validates: Requirements 7.1, 7.3, 7.4**
    - Create `tests/template-selection.property.test.js`
    - Verify selection hierarchy: business > vertical > fallback

  - [ ]* 4.3 Write property test: Template placeholder interpolation
    - **Property 12: Template placeholder interpolation**
    - **Validates: Requirements 7.2, 7.5**
    - Create `tests/template-interpolation.property.test.js`
    - Verify rendered output has zero unresolved placeholders and contains interpolated values

- [x] 5. Checkpoint - Core modules verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Business Manager function enhancements
  - [x] 6.1 Implement business registration with vertical selection in `manage-business.js`
    - Add `register` action to `manage-business.js`
    - Require `vertical_slug` in registration payload
    - Validate slug exists via `getVerticalBySlug`, return 400 if invalid
    - Call `applyVerticalDefaults` to copy vertical config into new business
    - Set `vertical_id` on the new business row
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 6.2 Implement service catalog CRUD in `manage-business.js`
    - Add `add-service` action: append new service entry to business services_config
    - Add `update-service` action: update service entry by index/name in services_config
    - Add `disable-service` action: set inactive flag on service entry (soft-delete, no physical removal)
    - Ensure changes only affect business-specific copy, never vertical defaults
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 6.3 Write property test: Service catalog persistence
    - **Property 4: Service catalog persistence**
    - **Validates: Requirements 4.2**
    - Create `tests/service-catalog-persistence.property.test.js`
    - Verify adding a service and reading back includes the entry unchanged

  - [ ]* 6.4 Write property test: Service catalog isolation
    - **Property 5: Service catalog isolation**
    - **Validates: Requirements 4.3, 4.5**
    - Create `tests/service-catalog-isolation.property.test.js`
    - Verify modifications don't affect vertical defaults or other businesses

  - [ ]* 6.5 Write property test: Service soft-delete preserves history
    - **Property 6: Service soft-delete preserves history**
    - **Validates: Requirements 4.4**
    - Create `tests/service-softdelete.property.test.js`
    - Verify disabled services remain in storage with inactive flag

- [x] 7. Order Service modifications
  - [x] 7.1 Modify `create-order.js` to support custom fields and vertical-aware validation
    - Fetch business config via `getBusinessConfig` at request start
    - Validate custom fields via `validateCustomFields` against business definitions
    - Store custom_fields in JSONB column
    - Map legacy fields (is_delicate, rack_location) into custom_fields for backward compatibility
    - Validate initial status against business status_flow
    - Use Template Engine for WhatsApp message composition
    - _Requirements: 5.2, 5.3, 5.4, 12.4, 12.5_

  - [x] 7.2 Modify `update-order.js` to enforce vertical-aware status transitions
    - Fetch business config via `getBusinessConfig`
    - Validate status transition via `validateStatusTransition`
    - Enforce sequential progression (next step or CANCELLED only)
    - Use Template Engine for status-change WhatsApp notifications
    - Enforce tenant isolation — verify order belongs to authenticated business
    - _Requirements: 6.2, 6.3, 6.5, 8.3, 8.4_

  - [ ]* 7.3 Write property test: Custom field storage round-trip
    - **Property 8: Custom field storage round-trip**
    - **Validates: Requirements 5.3**
    - Create `tests/custom-field-roundtrip.property.test.js`
    - Verify storing and reading custom fields returns identical data

  - [ ]* 7.4 Write property test: Tenant data isolation
    - **Property 13: Tenant data isolation**
    - **Validates: Requirements 8.3, 8.4**
    - Create `tests/tenant-isolation.property.test.js`
    - Verify cross-business access returns 403

  - [ ]* 7.5 Write property test: Legacy field mapping
    - **Property 14: Legacy field mapping**
    - **Validates: Requirements 12.3, 12.5**
    - Create `tests/legacy-field-mapping.property.test.js`
    - Verify is_delicate/rack_location top-level fields get stored inside custom_fields

  - [ ]* 7.6 Write property test: Legacy defaults application
    - **Property 15: Legacy defaults application**
    - **Validates: Requirements 12.4**
    - Create `tests/legacy-defaults.property.test.js`
    - Verify omitted optional custom fields default to null without error

- [x] 8. Checkpoint - Backend verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Admin Panel dynamic rendering
  - [x] 9.1 Modify `public/app.js` to fetch business config on initialization
    - Fetch business configuration (services, custom fields, status flow) from manage-business endpoint on app load
    - Store config in a module-level variable for use by rendering functions
    - Replace all hardcoded laundry service references with config-driven values
    - Replace all hardcoded status references with config-driven status flow
    - _Requirements: 10.1, 10.3, 10.4_

  - [x] 9.2 Implement dynamic custom field form rendering in `public/app.js`
    - Create `renderCustomFieldInputs(container, fieldDefinitions)` function
    - Map field_type to HTML inputs: text→text input, number→number input, date→date picker, datetime→datetime-local picker, boolean→checkbox, select→select dropdown
    - Mark required fields visually and in form validation
    - Render custom field values in order detail views with labels from definitions
    - _Requirements: 10.2, 10.5, 5.1, 5.5_

  - [x] 9.3 Update service selection UI in `public/app.js`
    - Render service catalog from business config instead of hardcoded list
    - Display name, description, price, and unit for each service
    - Filter out inactive services from order creation form
    - _Requirements: 4.1, 10.3_

- [x] 10. Ticket Page vertical adaptation
  - [x] 10.1 Modify `public/tiquete.html` and associated JS to use vertical config
    - Fetch business vertical config alongside order data
    - Render status stepper dynamically from business status_flow_config labels
    - Remove hardcoded laundry status labels (RECIBIDO, EN PROCESO, LISTO, ENTREGADO)
    - Display vertical emoji in business header
    - _Requirements: 11.1, 11.2, 11.4_

  - [x] 10.2 Render custom fields on ticket page
    - Display custom field values with labels from business custom_fields_config
    - Format datetime fields in localized format (dd/mm/yyyy HH:mm)
    - Only show fields that have values (skip null/empty)
    - _Requirements: 11.3, 11.5_

- [x] 11. WhatsApp integration with Template Engine
  - [x] 11.1 Integrate Template Engine into `_whatsapp.js` and `whatsapp-sender.js`
    - Replace hardcoded WhatsApp message building with Template Engine calls
    - Fetch business templates and vertical templates for template selection
    - Pass order data including custom fields to `renderTemplate`
    - Ensure WhatsApp send failures don't block primary operations (order create/update)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 12. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The migration files (task 1) should be applied to Supabase before testing backend functions
- Legacy compatibility (Requirement 12) is critical — existing laundry operators must not experience disruption
- All template engine and validator logic is pure-function, making it easily testable without I/O

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "3.1", "3.2", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "3.3", "3.4", "3.5", "4.2", "4.3"] },
    { "id": 4, "tasks": ["6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "6.4", "6.5", "7.1", "7.2"] },
    { "id": 6, "tasks": ["7.3", "7.4", "7.5", "7.6"] },
    { "id": 7, "tasks": ["9.1", "10.1", "11.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "10.2"] }
  ]
}
```

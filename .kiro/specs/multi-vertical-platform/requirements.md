# Requirements Document

## Introduction

This specification transforms TiqueteVivo from a laundry-only application into a multi-vertical SaaS platform that serves any service business requiring digital receipts and order tracking. The system introduces parametrization by industry verticals (laundries, parking lots, shoe repair, mechanic shops, bakeries, tailors, pet daycares, courier services, print centers, hair salons, gyms, nurseries), where each vertical defines its own service catalog, custom order fields, status flow, and WhatsApp message templates. Businesses select a vertical during onboarding and receive pre-configured defaults that they can further customize.

## Glossary

- **Vertical**: A business category/industry type (e.g., laundry, parking, shoe repair) stored in the database that defines default services, custom fields, status flows, and message templates
- **Vertical_Registry**: The database table storing all available vertical definitions and their configurations
- **Service_Catalog**: The collection of predefined services available for a specific Vertical, including names, descriptions, default prices, and units
- **Custom_Field**: An additional data field defined by a Vertical that extends the standard order schema (stored as JSONB), such as plate_number for parking or pet_name for pet daycares
- **Status_Flow**: The ordered sequence of status labels that an order transitions through within a specific Vertical (e.g., ENTRY → ACTIVE → EXIT for parking)
- **Business_Configurator**: The module responsible for applying Vertical defaults to a newly registered business and allowing subsequent customization
- **Template_Engine**: The module responsible for selecting and rendering WhatsApp message templates appropriate to the business Vertical and order context
- **Order_Service**: The serverless function responsible for creating, updating, and managing orders with Vertical-aware validation
- **Business_Manager**: The serverless function responsible for business registration, configuration, and Vertical assignment
- **Admin_Panel**: The operator-facing interface (app.html) that dynamically adapts its forms, fields, and status options based on the business Vertical
- **Ticket_Page**: The public-facing customer page (tiquete.html) that renders order details and status stepper adapted to the Vertical status flow
- **Operator**: A business user who manages orders through the Admin_Panel
- **RLS**: Row Level Security in Supabase ensuring data isolation between businesses

## Requirements

### Requirement 1: Vertical Registry and Configuration Storage

**User Story:** As a platform administrator, I want to define industry verticals with their configurations in the database, so that new verticals can be added without code changes.

#### Acceptance Criteria

1. THE Vertical_Registry SHALL store each Vertical with a unique slug identifier, display name, emoji icon, and active status
2. THE Vertical_Registry SHALL store a Service_Catalog array for each Vertical containing service entries with name, description, default price, duration, and unit (per_item, per_kg, per_hour, flat_rate)
3. THE Vertical_Registry SHALL store an array of Custom_Field definitions for each Vertical, where each definition includes field_key, display_label, field_type (text, number, date, datetime, boolean, select), required flag, and optional default value
4. THE Vertical_Registry SHALL store a Status_Flow array for each Vertical containing ordered status entries with a status_key and display_label
5. THE Vertical_Registry SHALL store WhatsApp message template strings for each Vertical, keyed by trigger event (order_created, status_ready, status_delivered)
6. WHEN a Vertical is retrieved from the Vertical_Registry, THE system SHALL return the complete configuration including Service_Catalog, Custom_Field definitions, Status_Flow, and message templates in a single response

### Requirement 2: Default Vertical Seed Data

**User Story:** As a platform administrator, I want the system to include predefined configurations for 12 target verticals, so that businesses in those industries can onboard immediately with sensible defaults.

#### Acceptance Criteria

1. THE Vertical_Registry SHALL contain a seed entry for "laundry" with services: Lavado estándar, Planchado, Tintorería, Lavado en seco; custom fields: is_delicate (boolean), rack_location (text); status flow: RECEIVED → IN_PROGRESS → READY → DELIVERED
2. THE Vertical_Registry SHALL contain a seed entry for "parking" with services: Hora, Medio día, Día completo, Mensualidad; custom fields: plate_number (text, required), entry_time (datetime, required), exit_time (datetime), bay_number (text); status flow: ENTRY → ACTIVE → EXIT
3. THE Vertical_Registry SHALL contain a seed entry for "shoe-repair" with services: Media suela, Tacón, Tintura, Limpieza profunda; custom fields: shoe_type (text), shoe_color (text); status flow: RECEIVED → DIAGNOSING → REPAIRING → READY → DELIVERED
4. THE Vertical_Registry SHALL contain a seed entry for "mechanic" with services: Diagnóstico, Cambio de aceite, Frenos, Motor; custom fields: plate_number (text, required), vehicle_brand (text), vehicle_model (text), spare_parts (text); status flow: RECEIVED → DIAGNOSING → REPAIRING → READY → DELIVERED
5. THE Vertical_Registry SHALL contain a seed entry for "bakery" with services: Torta personalizada, Catering, Cupcakes, Galletas por encargo; custom fields: delivery_date (date, required), advance_payment (number), special_instructions (text); status flow: RECEIVED → IN_PREPARATION → READY → DELIVERED
6. THE Vertical_Registry SHALL contain a seed entry for "tailor" with services: Arreglo de basta, Confección, Ajuste de talla, Reparación; custom fields: fabric_type (text), measurements (text), fitting_date (date); status flow: RECEIVED → MEASURING → SEWING → FITTING → READY → DELIVERED
7. THE Vertical_Registry SHALL contain a seed entry for "pet-daycare" with services: Hospedaje, Spa, Peluquería, Paseo; custom fields: pet_name (text, required), pet_breed (text), special_instructions (text), pickup_time (datetime); status flow: CHECK_IN → IN_CARE → READY → PICKED_UP
8. THE Vertical_Registry SHALL contain a seed entry for "courier" with services: Envío local, Envío express, Encomienda; custom fields: destination_address (text, required), weight_kg (number), recipient_name (text), recipient_phone (text); status flow: RECEIVED → IN_TRANSIT → ARRIVED → DELIVERED
9. THE Vertical_Registry SHALL contain a seed entry for "print-center" with services: Impresión, Ploteo, Encuadernado, Laminado; custom fields: file_name (text), quantity (number, required), finishing (select: mate/brillo/plastificado); status flow: RECEIVED → PRINTING → READY → DELIVERED
10. THE Vertical_Registry SHALL contain a seed entry for "salon" with services: Corte, Tinte, Alisado, Tratamiento; custom fields: stylist_name (text), appointment_time (datetime, required), prepaid_amount (number); status flow: BOOKED → IN_SERVICE → COMPLETED
11. THE Vertical_Registry SHALL contain a seed entry for "gym-locker" with services: Alquiler diario, Alquiler mensual; custom fields: locker_number (text, required), stored_items (text); status flow: ASSIGNED → ACTIVE → RETURNED
12. THE Vertical_Registry SHALL contain a seed entry for "nursery" with services: Planta por encargo, Mantenimiento, Asesoría; custom fields: plant_type (text, required), care_instructions (text), delivery_date (date); status flow: RECEIVED → GROWING → READY → DELIVERED

### Requirement 3: Business Onboarding with Vertical Selection

**User Story:** As a new business owner, I want to select my industry vertical during registration, so that the system configures my account with appropriate defaults for my type of business.

#### Acceptance Criteria

1. WHEN a new business registers, THE Business_Manager SHALL require a vertical_slug field identifying the selected Vertical
2. WHEN a business registration includes a valid vertical_slug, THE Business_Configurator SHALL copy the Vertical default Service_Catalog into the business-specific service catalog
3. WHEN a business registration includes a valid vertical_slug, THE Business_Configurator SHALL store the Vertical Custom_Field definitions as the business active custom fields configuration
4. WHEN a business registration includes a valid vertical_slug, THE Business_Configurator SHALL store the Vertical Status_Flow as the business active status flow
5. WHEN a business registration includes a valid vertical_slug, THE Business_Configurator SHALL copy the Vertical WhatsApp message templates as the business active templates
6. IF a business registration includes an invalid or non-existent vertical_slug, THEN THE Business_Manager SHALL return a 400 error identifying the invalid vertical_slug value

### Requirement 4: Business-Level Service Catalog Management

**User Story:** As an Operator, I want to customize my service catalog beyond the vertical defaults, so that I can add, modify, or remove services specific to my business.

#### Acceptance Criteria

1. THE Admin_Panel SHALL display the business service catalog with name, description, price, duration, and unit for each service entry
2. WHEN the Operator adds a new service entry, THE Business_Manager SHALL persist the service with a business-specific identifier linked to the business_id
3. WHEN the Operator modifies a service entry price, name, or description, THE Business_Manager SHALL update the corresponding record for that business only
4. WHEN the Operator disables a service entry, THE Business_Manager SHALL mark the service as inactive without deleting it, preserving historical order references
5. THE Business_Manager SHALL NOT allow modifications to the Vertical_Registry default catalog; changes apply only to the business-specific copy

### Requirement 5: Dynamic Order Creation with Custom Fields

**User Story:** As an Operator, I want the order creation form to include my vertical's custom fields alongside standard fields, so that I can capture all relevant information for my type of business.

#### Acceptance Criteria

1. WHEN the Admin_Panel loads the order creation form, THE Admin_Panel SHALL fetch the business Custom_Field definitions and render an input control for each field matching its field_type
2. WHEN the Operator submits an order with custom field values, THE Order_Service SHALL validate each custom field value against its field_type definition (text, number, date, datetime, boolean, select)
3. WHEN the Operator submits an order with custom field values, THE Order_Service SHALL store the custom field values in a JSONB column named custom_fields on the orders table
4. IF a Custom_Field marked as required has no value provided, THEN THE Order_Service SHALL return a 400 error identifying the missing required custom field by its display_label
5. WHEN the Admin_Panel displays an existing order, THE Admin_Panel SHALL render the custom field values using the labels and types from the business Custom_Field definitions

### Requirement 6: Vertical-Aware Status Flow

**User Story:** As an Operator, I want the order statuses available in my panel to match my vertical's workflow, so that I only see status transitions relevant to my business type.

#### Acceptance Criteria

1. WHEN the Admin_Panel loads order management, THE Admin_Panel SHALL fetch the business Status_Flow and display only those statuses as available options for status transitions
2. WHEN the Order_Service receives a status update, THE Order_Service SHALL validate that the new status value exists in the business Status_Flow configuration
3. IF the Order_Service receives a status value not present in the business Status_Flow, THEN THE Order_Service SHALL return a 400 error listing the valid status options for the business
4. WHEN the Ticket_Page renders the order stepper, THE Ticket_Page SHALL display steps matching the business Status_Flow labels instead of hardcoded laundry statuses
5. THE Order_Service SHALL enforce sequential status progression: a status change is valid only if the target status is the next step or the final CANCELLED status in the business Status_Flow

### Requirement 7: Vertical-Aware WhatsApp Message Templates

**User Story:** As an Operator, I want WhatsApp messages sent to my customers to use language appropriate to my industry, so that notifications feel relevant and professional.

#### Acceptance Criteria

1. WHEN the Template_Engine composes a message for an order event, THE Template_Engine SHALL select the message template corresponding to the business Vertical and the trigger event (order_created, status_ready, status_delivered)
2. WHEN the Template_Engine renders a message template, THE Template_Engine SHALL interpolate order data including customer_name, order_number, business_name, items_text, total, balance, and custom field values
3. IF a business has a custom template override for a trigger event, THEN THE Template_Engine SHALL use the business-specific template instead of the Vertical default
4. IF no template exists for the trigger event and Vertical combination, THEN THE Template_Engine SHALL fall back to a generic template containing order_number, business_name, and status
5. THE Template_Engine SHALL support the following placeholders in template strings: {customer_name}, {order_number}, {business_name}, {items_text}, {total}, {balance}, {status_label}, {custom.*} where custom.* maps to any custom field key

### Requirement 8: Multi-Tenant Data Isolation

**User Story:** As a business owner, I want my data completely isolated from other businesses, so that my customers, orders, and configurations remain private.

#### Acceptance Criteria

1. THE orders table SHALL enforce RLS policies that restrict SELECT, INSERT, UPDATE, and DELETE operations to rows matching the authenticated business_id
2. THE business service catalog table SHALL enforce RLS policies restricting access to rows owned by the authenticated business_id
3. WHEN the Order_Service queries orders, THE Order_Service SHALL always filter by the authenticated business_id regardless of other query parameters
4. IF a request attempts to access an order belonging to a different business_id, THEN THE Order_Service SHALL return a 403 error without revealing the order existence
5. THE Vertical_Registry SHALL be readable by all authenticated businesses but writable only by platform administrators

### Requirement 9: Database Schema Migration for Multi-Vertical Support

**User Story:** As a developer, I want the database schema extended to support verticals, custom fields, and flexible status flows, so that the multi-vertical architecture has a solid data foundation.

#### Acceptance Criteria

1. THE database SHALL contain a verticals table with columns: id (uuid, primary key), slug (text, unique), name (text), emoji (text), services_default (jsonb), custom_fields_default (jsonb), status_flow_default (jsonb), whatsapp_templates_default (jsonb), active (boolean), created_at (timestamptz)
2. THE businesses table SHALL be extended with columns: vertical_id (uuid, foreign key to verticals), services_config (jsonb), custom_fields_config (jsonb), status_flow_config (jsonb), whatsapp_templates_config (jsonb)
3. THE orders table SHALL be extended with a custom_fields (jsonb) column for storing Vertical-specific order data
4. THE orders table status column SHALL have its CHECK constraint removed and replaced with application-level validation against the business Status_Flow
5. THE database migration SHALL preserve all existing laundry data by assigning current businesses to the "laundry" vertical and mapping existing order fields (is_delicate, rack_location) into the custom_fields JSONB column

### Requirement 10: Admin Panel Dynamic Form Rendering

**User Story:** As an Operator, I want the admin panel forms to adapt automatically to my vertical configuration, so that I see relevant fields and options without any manual setup.

#### Acceptance Criteria

1. WHEN the Admin_Panel initializes, THE Admin_Panel SHALL fetch the business configuration including Service_Catalog, Custom_Field definitions, and Status_Flow from the server
2. WHEN the Admin_Panel renders the order creation form, THE Admin_Panel SHALL dynamically generate input fields for each Custom_Field definition using the appropriate HTML input type (text input, number input, date picker, datetime picker, checkbox, select dropdown)
3. WHEN the Admin_Panel renders service selection, THE Admin_Panel SHALL display only services from the business-specific Service_Catalog with their configured prices
4. WHEN the Admin_Panel renders status filter and status change controls, THE Admin_Panel SHALL display only statuses defined in the business Status_Flow
5. WHEN the Admin_Panel renders order detail views, THE Admin_Panel SHALL display custom field values with their corresponding labels from the Custom_Field definitions

### Requirement 11: Ticket Page Vertical Adaptation

**User Story:** As a customer, I want the public ticket page to display information relevant to the type of service I used, so that the receipt feels professional and contextually appropriate.

#### Acceptance Criteria

1. WHEN the Ticket_Page loads an order, THE Ticket_Page SHALL fetch the business Vertical configuration to determine display labels and status flow
2. WHEN the Ticket_Page renders the status stepper, THE Ticket_Page SHALL display step labels from the business Status_Flow configuration instead of hardcoded laundry labels
3. WHEN the Ticket_Page renders order details, THE Ticket_Page SHALL display custom field values with their appropriate labels from the business Custom_Field definitions
4. WHEN the Ticket_Page renders the business header, THE Ticket_Page SHALL display the Vertical emoji alongside the business name
5. IF a custom field is of type datetime, THEN THE Ticket_Page SHALL render it in a human-readable localized format (dd/mm/yyyy HH:mm)

### Requirement 12: Backward Compatibility with Existing Laundry Data

**User Story:** As an existing laundry operator, I want my current orders and configuration to continue working after the multi-vertical update, so that the upgrade does not disrupt my business operations.

#### Acceptance Criteria

1. WHEN the migration runs, THE migration script SHALL create a "laundry" vertical entry in the Vertical_Registry with the current hardcoded configuration (statuses: RECEIVED, IN_PROGRESS, READY, DELIVERED; fields: is_delicate, rack_location)
2. WHEN the migration runs, THE migration script SHALL assign all existing businesses to the "laundry" vertical
3. WHEN the migration runs, THE migration script SHALL copy existing is_delicate and rack_location values from orders into the custom_fields JSONB column for each existing order
4. WHEN existing API endpoints receive requests without vertical-specific parameters, THE Order_Service SHALL apply the business assigned Vertical defaults
5. THE Order_Service SHALL continue to accept the existing order creation payload format (with is_delicate and rack_location as top-level fields) for backward compatibility, mapping those fields into custom_fields internally

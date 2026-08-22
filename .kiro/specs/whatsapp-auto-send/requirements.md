# Requirements Document

## Introduction

This specification covers three major improvements to the TiqueteVivo platform: (1) automatic WhatsApp message sending upon order creation via Meta Cloud API, (2) automatic WhatsApp notifications on order status changes, and (3) complete CRUD operations including soft-delete for orders and deactivation for businesses. The system currently requires operators to manually send WhatsApp messages via wa.me links and lacks delete functionality entirely.

## Glossary

- **Order_Service**: The serverless function (create-order.js) responsible for creating and persisting orders in the database.
- **WhatsApp_Sender**: The serverless function (whatsapp-sender.js) responsible for sending messages via the Meta WhatsApp Cloud API.
- **Order_Updater**: The serverless function (update-order.js) responsible for updating order fields including status transitions.
- **Order_Manager**: The serverless function responsible for soft-delete (cancellation) and hard-delete of orders.
- **Business_Manager**: The serverless function responsible for deactivating or deleting businesses.
- **Message_Logger**: The component responsible for persisting WhatsApp message records in the whatsapp_messages table.
- **Meta_Cloud_API**: The external Meta WhatsApp Cloud API (graph.facebook.com) used to send WhatsApp messages programmatically.
- **Operator**: A business user who manages orders and customer communications through the TiqueteVivo panel.
- **Customer**: The end-user who receives WhatsApp notifications about their order.
- **24_Hour_Window**: Meta's rule that allows free-text messages only if the customer messaged the business within the last 24 hours; otherwise a pre-approved template is required.
- **Dry_Run_Mode**: A mode where WhatsApp credentials are not configured, causing the system to skip API calls and return a simulated response.
- **Fallback_Link**: A wa.me URL returned to the frontend so the Operator can send the message manually when automatic sending fails.

## Requirements

### Requirement 1: Automatic WhatsApp Message on Order Creation

**User Story:** As an Operator, I want the system to automatically send a WhatsApp message to the Customer when an order is created, so that I do not need to manually open wa.me and press Send.

#### Acceptance Criteria

1. WHEN an order is successfully persisted in the database, THE Order_Service SHALL invoke the WhatsApp_Sender internally to send the order confirmation message to the Customer phone number.
2. WHEN the Meta_Cloud_API responds with a successful status, THE Order_Service SHALL update the order's whatsapp_sent_at field with the current timestamp.
3. WHEN the Meta_Cloud_API responds with a successful status, THE Order_Service SHALL return the order data and the WhatsApp send result in the HTTP response body.
4. IF the Meta_Cloud_API responds with an error status, THEN THE Order_Service SHALL return the order data along with a Fallback_Link (wa.me URL) so the Operator can send manually.
5. IF the Meta_Cloud_API responds with an error status, THEN THE Order_Service SHALL NOT fail the order creation; the order remains persisted.
6. WHILE Dry_Run_Mode is active (WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID is empty), THE Order_Service SHALL skip the API call and return the order data along with a Fallback_Link.

### Requirement 2: WhatsApp Message Logging

**User Story:** As an Operator, I want all WhatsApp messages to be logged in the database, so that I can audit message history and troubleshoot delivery issues.

#### Acceptance Criteria

1. WHEN the WhatsApp_Sender attempts to send a message, THE Message_Logger SHALL insert a record into the whatsapp_messages table with the order_id, business_id, phone, template_name, message_body, and status set to 'SENT'.
2. IF the Meta_Cloud_API returns a message ID, THEN THE Message_Logger SHALL store the meta_message_id in the whatsapp_messages record.
3. IF the Meta_Cloud_API returns an error, THEN THE Message_Logger SHALL insert a record with status 'FAILED' and the error description in the error_message field.
4. WHILE Dry_Run_Mode is active, THE Message_Logger SHALL insert a record with status 'DRY_RUN' and the intended message body.

### Requirement 3: WhatsApp Notification on Status Change

**User Story:** As an Operator, I want the system to automatically send a WhatsApp notification to the Customer when I change an order's status to READY or DELIVERED, so that the Customer is promptly informed.

#### Acceptance Criteria

1. WHEN the Order_Updater receives a status change to 'READY', THE Order_Updater SHALL invoke the WhatsApp_Sender with the appropriate status notification message for the Customer.
2. WHEN the Order_Updater receives a status change to 'DELIVERED', THE Order_Updater SHALL invoke the WhatsApp_Sender with the appropriate delivery confirmation message for the Customer.
3. WHEN a status notification is sent successfully, THE Order_Updater SHALL update the order's whatsapp_sent_at field with the current timestamp.
4. IF the WhatsApp notification fails on status change, THEN THE Order_Updater SHALL return the updated order along with a Fallback_Link and SHALL NOT revert the status update.
5. THE Order_Updater SHALL NOT send WhatsApp notifications for status changes to 'IN_PROGRESS' or 'CANCELLED'.

### Requirement 4: Meta 24-Hour Window Handling

**User Story:** As an Operator, I want the system to respect Meta's 24-hour messaging window rules, so that messages are delivered successfully without violating platform policies.

#### Acceptance Criteria

1. WHEN a Customer has not messaged the business within the last 24 hours and the system needs to initiate a conversation, THE WhatsApp_Sender SHALL use a pre-approved template message instead of free text.
2. WHEN a Customer has an active 24-hour window (previously messaged the business), THE WhatsApp_Sender SHALL send a free-text message with the full order details.
3. IF no approved template is configured for the required message type, THEN THE WhatsApp_Sender SHALL fall back to free-text and log a warning indicating a potential delivery failure.
4. THE WhatsApp_Sender SHALL accept a template_name parameter to select which pre-approved template to use for out-of-window messages.

### Requirement 5: Soft-Delete (Cancel) Orders

**User Story:** As an Operator, I want to cancel an order by marking it as CANCELLED with a timestamp, so that cancelled orders are excluded from active views but remain in the database for auditing.

#### Acceptance Criteria

1. WHEN the Order_Manager receives a cancel request with a valid order ID, THE Order_Manager SHALL update the order's status to 'CANCELLED' and set a cancelled_at timestamp.
2. IF the order is already in 'CANCELLED' status, THEN THE Order_Manager SHALL return an error indicating the order is already cancelled.
3. IF the provided order ID does not exist, THEN THE Order_Manager SHALL return a 404 error with a descriptive message.
4. THE Order_Manager SHALL require the business_id or business slug to validate ownership before cancelling an order.

### Requirement 6: Hard-Delete Orders (Admin)

**User Story:** As an Operator with admin privileges, I want to permanently delete an order from the database, so that I can clean up test data or erroneous entries.

#### Acceptance Criteria

1. WHEN the Order_Manager receives a hard-delete request with a valid order ID and a confirmation flag set to true, THE Order_Manager SHALL permanently remove the order record from the database.
2. IF the confirmation flag is not set to true, THEN THE Order_Manager SHALL return a 400 error requiring explicit confirmation.
3. IF the provided order ID does not exist, THEN THE Order_Manager SHALL return a 404 error with a descriptive message.
4. WHEN an order is hard-deleted, THE Order_Manager SHALL also delete related whatsapp_messages records (via database cascade or explicit deletion).

### Requirement 7: Deactivate Business

**User Story:** As an Operator, I want to deactivate a business, so that it is no longer visible in public listings but its historical data is preserved.

#### Acceptance Criteria

1. WHEN the Business_Manager receives a deactivate request with a valid business ID or slug, THE Business_Manager SHALL set the business's active field to false and record a deactivated_at timestamp.
2. IF the business is already deactivated, THEN THE Business_Manager SHALL return an error indicating the business is already inactive.
3. IF the provided business ID or slug does not exist, THEN THE Business_Manager SHALL return a 404 error with a descriptive message.
4. WHILE a business is deactivated, THE Order_Service SHALL reject new order creation for that business with a 403 error.

### Requirement 8: Input Validation on All Endpoints

**User Story:** As an Operator, I want all API endpoints to validate input data, so that invalid data does not corrupt the database and errors are reported clearly.

#### Acceptance Criteria

1. WHEN the Order_Service receives a customer_phone value, THE Order_Service SHALL validate that it matches the international phone format (digits only, 10 to 15 characters, starting with country code).
2. WHEN the Order_Service receives a total or paid value, THE Order_Service SHALL validate that the value is a non-negative number not exceeding 99,999,999.99.
3. IF any required field is missing or any validation rule fails, THEN THE Order_Service SHALL return a 400 error with a descriptive message identifying the invalid field and the reason.
4. WHEN the Business_Manager receives a phone value, THE Business_Manager SHALL validate that it matches the international phone format.
5. WHEN the Order_Service receives a status value, THE Order_Service SHALL validate that the value is one of: RECEIVED, IN_PROGRESS, READY, DELIVERED, CANCELLED.

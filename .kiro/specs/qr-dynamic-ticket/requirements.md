# Requirements Document

## Introduction

This feature transforms the static QR code on the TiqueteVivo digital ticket (`tiquete.html`) into a dynamic, context-aware component that automatically reflects the current order state, balance, and lifecycle stage. The QR content and visual presentation update in real-time based on order status transitions (RECEIVED → IN_PROGRESS → READY → DELIVERED), enabling intelligent mode switching (track, pickup, pay, review) without manual intervention. Additionally, the feature enables operators to scan customer QR codes at pickup to instantly identify and retrieve orders.

## Glossary

- **Ticket_Page**: The public-facing HTML page (`tiquete.html`) where customers view their digital receipt and QR code
- **Operator_Panel**: The administrative interface (`app.html`) used by laundry operators to manage orders
- **QR_Engine**: The client-side module responsible for generating and updating QR codes using the qrcodejs library
- **Status_Poller**: The client-side mechanism that periodically fetches the current order state from the server
- **QR_Mode**: One of the contextual display modes for the QR code: track, pickup, pay, or review
- **Order_Status**: The lifecycle state of an order, one of: RECEIVED, IN_PROGRESS, READY, DELIVERED, CANCELLED
- **Pickup_QR**: A QR mode that encodes the ticket URL for counter identification when collecting an order
- **Pay_QR**: A QR mode that encodes payment information (amount, reference, payment accounts)
- **Track_QR**: A QR mode that encodes the ticket URL for status tracking purposes
- **Review_QR**: A QR mode displayed after delivery for rating or receipt archival
- **Scanner_View**: A dedicated interface in the Operator_Panel for scanning customer QR codes and retrieving order details
- **Polling_Interval**: The time period between consecutive status check requests from the Ticket_Page to the server

## Requirements

### Requirement 1: Real-Time Order Status Polling

**User Story:** As a customer, I want my digital ticket page to automatically reflect the latest order status, so that I can track progress without manually refreshing the page.

#### Acceptance Criteria

1. WHEN the Ticket_Page loads, THE Status_Poller SHALL fetch the current order data from the server and render the latest state
2. WHILE the Ticket_Page is open and the Order_Status is not DELIVERED or CANCELLED, THE Status_Poller SHALL poll the server for order updates at a Polling_Interval of 30 seconds
3. WHEN the Status_Poller detects a change in Order_Status, THE Ticket_Page SHALL update the stepper, balance, items, and QR_Mode without requiring a full page reload
4. WHILE the Ticket_Page tab is not visible (browser tab inactive), THE Status_Poller SHALL pause polling to conserve resources
5. WHEN the Ticket_Page tab becomes visible again, THE Status_Poller SHALL immediately fetch the latest order state and resume the regular Polling_Interval
6. IF the Status_Poller receives a network error, THEN THE Status_Poller SHALL retry after 60 seconds and display a subtle offline indicator on the Ticket_Page

### Requirement 2: Context-Aware QR Mode Selection

**User Story:** As a customer, I want the QR code on my ticket to automatically show the most relevant action for my order's current state, so that I always see the right option without manual switching.

#### Acceptance Criteria

1. WHEN the Order_Status is RECEIVED or IN_PROGRESS, THE QR_Engine SHALL display the Track_QR mode as the default active mode
2. WHEN the Order_Status is READY, THE QR_Engine SHALL display the Pickup_QR mode as the default active mode with a prominent visual indicator that the order is ready for collection
3. WHEN the Order_Status is READY and the order balance is greater than zero, THE QR_Engine SHALL display both the Pickup_QR mode and the Pay_QR mode, with Pickup_QR as the default
4. WHEN the Order_Status is DELIVERED, THE QR_Engine SHALL display the Review_QR mode as the default active mode
5. WHILE any QR_Mode is active, THE Ticket_Page SHALL allow the customer to manually switch to other available QR_Mode tabs
6. WHEN the Order_Status changes and the customer has not manually selected a QR_Mode, THE QR_Engine SHALL automatically switch to the contextually appropriate default QR_Mode

### Requirement 3: Dynamic QR Content Generation

**User Story:** As a customer, I want the QR code content to reflect the current data (balance, status, order reference), so that scanning always provides accurate and up-to-date information.

#### Acceptance Criteria

1. WHEN the Track_QR mode is active, THE QR_Engine SHALL encode the full Ticket_Page URL including order number and business slug parameters
2. WHEN the Pickup_QR mode is active, THE QR_Engine SHALL encode a structured payload containing the order ID, order number, and business slug for operator scanning
3. WHEN the Pay_QR mode is active, THE QR_Engine SHALL encode a payment string containing the current balance amount, payment account number, and order reference
4. WHEN the Review_QR mode is active, THE QR_Engine SHALL encode the Ticket_Page URL as an archival receipt link
5. WHEN the order balance changes (due to a payment update), THE QR_Engine SHALL regenerate the Pay_QR content with the updated balance amount
6. IF the order balance reaches zero, THEN THE QR_Engine SHALL hide the Pay_QR tab from the available modes

### Requirement 4: Operator QR Scanner for Order Identification

**User Story:** As an operator, I want to scan the customer's QR code at the counter to instantly identify their order, so that I can retrieve orders quickly without asking for names or ticket numbers.

#### Acceptance Criteria

1. THE Operator_Panel SHALL provide a Scanner_View accessible via a dedicated button in the orders interface
2. WHEN the operator activates the Scanner_View, THE Operator_Panel SHALL request camera access and display a live camera feed with a QR scanning overlay
3. WHEN the Scanner_View successfully decodes a valid Pickup_QR payload, THE Operator_Panel SHALL display the matching order details including customer name, order number, items, rack location, and balance
4. WHEN the Scanner_View identifies an order, THE Operator_Panel SHALL provide a one-tap action to change the order status to DELIVERED
5. IF the Scanner_View decodes a QR that does not match any existing order, THEN THE Operator_Panel SHALL display an error message indicating the order was not found
6. IF the camera access is denied or unavailable, THEN THE Operator_Panel SHALL display a fallback message instructing the operator to search the order manually by number

### Requirement 5: Visual QR State Indicators

**User Story:** As a customer, I want clear visual cues around the QR code that reflect the current order state, so that I immediately understand the purpose of the QR without reading detailed text.

#### Acceptance Criteria

1. WHEN the Track_QR mode is active, THE QR_Engine SHALL render the QR code with a blue color scheme and a tracking icon label
2. WHEN the Pickup_QR mode is active, THE QR_Engine SHALL render the QR code with a green color scheme and a pickup icon label
3. WHEN the Pay_QR mode is active, THE QR_Engine SHALL render the QR code with an amber/orange color scheme and a payment icon label
4. WHEN the Review_QR mode is active, THE QR_Engine SHALL render the QR code with a purple color scheme and a review icon label
5. WHEN the Order_Status transitions to READY, THE Ticket_Page SHALL display an animated or highlighted notification banner above the QR section indicating the order is ready for pickup

### Requirement 6: Polling Endpoint for Order Status

**User Story:** As a developer, I want a lightweight API endpoint optimized for status polling, so that frequent checks from the Ticket_Page do not overload the server or database.

#### Acceptance Criteria

1. THE server SHALL expose a GET endpoint at `/api/order-status` that accepts order ID or order number and business slug as query parameters
2. WHEN the `/api/order-status` endpoint receives a valid request, THE server SHALL return only the order status, balance, paid amount, and updated_at timestamp
3. WHEN the `/api/order-status` endpoint receives an order identifier that does not exist, THE server SHALL return a 404 response with a descriptive error message
4. THE `/api/order-status` response payload SHALL be smaller than 500 bytes to minimize bandwidth consumption during frequent polling

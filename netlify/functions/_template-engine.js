/**
 * Template Engine module for vertical-aware WhatsApp message rendering.
 * Pure function module — no I/O, fully testable in isolation.
 *
 * Supports placeholders: {customer_name}, {order_number}, {business_name},
 * {items_text}, {total}, {balance}, {status_label}, {custom.*}
 */

/**
 * Generic fallback template used when no business or vertical template exists.
 * Contains {order_number}, {business_name}, and {status_label}.
 */
const GENERIC_FALLBACK_TEMPLATE =
  "📋 *{business_name}*\n\nOrden #{order_number}\nEstado: {status_label}";

/**
 * Selects the appropriate template for a trigger event.
 * Priority: business override > vertical default > generic fallback.
 *
 * @param {string} triggerEvent - e.g. 'order_created', 'status_ready', 'status_delivered'
 * @param {object|null|undefined} businessTemplates - Business-level template overrides (may be null/undefined)
 * @param {object|null|undefined} verticalTemplates - Vertical-level default templates
 * @returns {string} Template string with placeholders
 */
export function selectTemplate(triggerEvent, businessTemplates, verticalTemplates) {
  // Priority 1: Business override
  if (businessTemplates && typeof businessTemplates === "object" && businessTemplates[triggerEvent]) {
    return businessTemplates[triggerEvent];
  }

  // Priority 2: Vertical default
  if (verticalTemplates && typeof verticalTemplates === "object" && verticalTemplates[triggerEvent]) {
    return verticalTemplates[triggerEvent];
  }

  // Priority 3: Generic fallback
  return GENERIC_FALLBACK_TEMPLATE;
}

/**
 * Renders a template string by interpolating placeholders with order and business data.
 * Supports standard placeholders and {custom.*} for custom field values.
 * Unresolved placeholders are replaced with empty string.
 *
 * @param {string} template - Template string with {placeholder} markers
 * @param {object} orderData - Order data including custom_fields
 * @param {object} businessData - Business metadata (name, etc.)
 * @returns {string} Rendered message with all placeholders resolved
 */
export function renderTemplate(template, orderData, businessData) {
  if (!template || typeof template !== "string") {
    return "";
  }

  const order = orderData || {};
  const business = businessData || {};

  // Build the data map for standard placeholders
  const dataMap = {
    customer_name: order.customer_name ?? order.customerName ?? "",
    order_number: order.order_number ?? order.orderNumber ?? "",
    business_name: business.name ?? business.business_name ?? "",
    items_text: order.items_text ?? order.itemsText ?? "",
    total: order.total != null ? String(order.total) : "",
    balance: order.balance != null ? String(order.balance) : "",
    status_label: order.status_label ?? order.statusLabel ?? ""
  };

  // Replace all placeholders using a single regex pass
  const rendered = template.replace(/\{([^}]+)\}/g, (match, key) => {
    const trimmedKey = key.trim();

    // Handle {custom.*} placeholders
    if (trimmedKey.startsWith("custom.")) {
      const customKey = trimmedKey.slice("custom.".length);
      const customFields = order.custom_fields || order.customFields || {};
      const value = customFields[customKey];
      return value != null ? String(value) : "";
    }

    // Handle standard placeholders
    if (trimmedKey in dataMap) {
      return dataMap[trimmedKey] != null ? String(dataMap[trimmedKey]) : "";
    }

    // Unresolved placeholder — replace with empty string
    return "";
  });

  return rendered;
}

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
 * Default template for the `customer_reactivation` trigger.
 * Sent to inactive customers with a personalized message and coupon link.
 * Variables: {customer_name}, {last_service}, {days_inactive}, {coupon_link}, {business_name}
 */
const CUSTOMER_REACTIVATION_TEMPLATE =
  "👋 ¡Hola {customer_name}!\n\n" +
  "Te extrañamos en *{business_name}*. " +
  "Han pasado {days_inactive} días desde tu último servicio de *{last_service}*.\n\n" +
  "🎁 Tenemos un descuento especial para ti:\n{coupon_link}\n\n" +
  "¡Te esperamos pronto! 💪";

/**
 * Default template for the `payment_confirmed` trigger.
 * Sent when a payment is successfully applied to an order.
 * Variables: {business_name}, {order_number}, {amount_paid}, {new_balance}
 */
const PAYMENT_CONFIRMED_TEMPLATE =
  "✅ *{business_name}*\n\n" +
  "¡Pago confirmado!\n" +
  "Orden #{order_number}\n" +
  "Monto pagado: ${amount_paid}\n" +
  "Saldo pendiente: ${new_balance}\n\n" +
  "¡Gracias por tu pago! 🙏";

/**
 * Registry of built-in default templates by trigger event.
 * These are used as fallback when neither business nor vertical templates are configured.
 */
const BUILTIN_TEMPLATES = {
  customer_reactivation: CUSTOMER_REACTIVATION_TEMPLATE,
  payment_confirmed: PAYMENT_CONFIRMED_TEMPLATE
};

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

  // Priority 3: Built-in trigger template
  if (BUILTIN_TEMPLATES[triggerEvent]) {
    return BUILTIN_TEMPLATES[triggerEvent];
  }

  // Priority 4: Generic fallback
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
    status_label: order.status_label ?? order.statusLabel ?? "",
    // Reactivation-specific placeholders
    last_service: order.last_service ?? order.lastService ?? "",
    days_inactive: order.days_inactive != null ? String(order.days_inactive) : "",
    coupon_link: order.coupon_link ?? order.couponLink ?? "",
    // Payment-specific placeholders
    amount_paid: order.amount_paid != null ? String(order.amount_paid) : "",
    new_balance: order.new_balance != null ? String(order.new_balance) : ""
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

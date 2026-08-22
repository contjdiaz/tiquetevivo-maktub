/**
 * Shared WhatsApp module — extracted from whatsapp-sender.js
 * Provides reusable functions for sending WhatsApp messages via Meta Cloud API,
 * building fallback links, and logging message attempts.
 *
 * As of the multi-vertical platform migration, message composition uses the
 * Template Engine (`_template-engine.js`) via `buildOrderMessageFromTemplate`.
 * The legacy `buildOrderMessage` is kept for backward compatibility but delegates
 * to the Template Engine with a default "order_created" trigger.
 */

import { selectTemplate, renderTemplate } from "./_template-engine.js";

/**
 * Build a WhatsApp order message using the Template Engine.
 * Selects the appropriate template based on trigger event and business/vertical
 * templates, then renders with order data.
 *
 * @param {object} params
 * @param {string} [params.triggerEvent='order_created'] - Event trigger (e.g. 'order_created', 'status_ready', 'status_delivered')
 * @param {object} [params.businessTemplates] - Business-level template overrides (may be null)
 * @param {object} [params.verticalTemplates] - Vertical-level default templates (may be null)
 * @param {object} params.orderData - Order data (customer_name, order_number, items_text, total, balance, status_label, custom_fields)
 * @param {object} params.businessData - Business metadata (name)
 * @returns {string} Rendered WhatsApp message
 */
export function buildOrderMessageFromTemplate({
  triggerEvent = "order_created",
  businessTemplates = null,
  verticalTemplates = null,
  orderData = {},
  businessData = {}
} = {}) {
  const template = selectTemplate(triggerEvent, businessTemplates, verticalTemplates);
  return renderTemplate(template, orderData, businessData);
}

/**
 * @deprecated Use `buildOrderMessageFromTemplate` with Template Engine instead.
 * Kept for backward compatibility with existing callers and tests.
 *
 * Builds a WhatsApp order message. If businessTemplates/verticalTemplates are
 * available in the order object (via `_businessTemplates` / `_verticalTemplates`),
 * it delegates to the Template Engine. Otherwise, falls back to a generic template.
 *
 * @param {object} order - The order data object
 * @returns {string} Formatted WhatsApp message
 */
export function buildOrderMessage(order) {
  const businessTemplates = order._businessTemplates || null;
  const verticalTemplates = order._verticalTemplates || null;
  const triggerEvent = order._triggerEvent || "order_created";

  const orderData = {
    customer_name: order.customer_name || order.customerName || "",
    order_number: order.order_number || order.orderNumber || "",
    items_text: order.items_text || order.itemsText || "",
    total: order.total != null ? Number(order.total) : 0,
    balance: Number(order.balance ?? Math.max(0, Number(order.total || 0) - Number(order.paid || 0))),
    status_label: order.status_label || order.statusLabel || order.status || "",
    custom_fields: order.custom_fields || order.customFields || {}
  };

  const businessData = {
    name: order.business_name || order.businessName || ""
  };

  return buildOrderMessageFromTemplate({
    triggerEvent,
    businessTemplates,
    verticalTemplates,
    orderData,
    businessData
  });
}

/**
 * Send a WhatsApp message via Meta Cloud API.
 * Supports both free-text messages and pre-approved template messages.
 *
 * When WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID environment variables are
 * empty/missing, the function operates in dry-run mode — skipping the API call
 * and returning a simulated response.
 *
 * @param {object} params
 * @param {string} params.to - Recipient phone number in international format
 * @param {string} [params.text] - Free-text message body (used when no template)
 * @param {string} [params.templateName] - Meta pre-approved template name (for out-of-window messages)
 * @param {Array} [params.templateParams] - Template parameter values (positional)
 * @returns {Promise<{success: boolean, dryRun?: boolean, messageId?: string, error?: string, fallbackLink?: string}>}
 */
export async function sendWhatsAppMessage({ to, text, templateName, templateParams }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // Dry-run mode: skip API call when credentials are not configured
  if (!token || !phoneNumberId) {
    const fallbackLink = buildFallbackLink(to, text || "");
    return {
      success: false,
      dryRun: true,
      to,
      text: text || null,
      templateName: templateName || null,
      fallbackLink
    };
  }

  // Build request payload based on whether a template is specified
  let payload;

  if (templateName) {
    // Template message format — used for out-of-24-hour-window conversations
    const components = [];
    if (templateParams && templateParams.length > 0) {
      components.push({
        type: "body",
        parameters: templateParams.map((value) => ({
          type: "text",
          text: String(value)
        }))
      });
    }

    payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "es" },
        components: components.length > 0 ? components : undefined
      }
    };
  } else {
    // Free-text message — used when customer has an active 24-hour window
    if (!text) {
      return {
        success: false,
        error: "Either text or templateName must be provided",
        fallbackLink: buildFallbackLink(to, "")
      };
    }

    payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body: text }
    };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();

    if (response.ok) {
      const messageId = result.messages?.[0]?.id || null;
      return { success: true, messageId, raw: result };
    }

    // API returned an error
    const errorMsg = result.error?.message || JSON.stringify(result);
    return {
      success: false,
      error: errorMsg,
      fallbackLink: buildFallbackLink(to, text || "")
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      fallbackLink: buildFallbackLink(to, text || "")
    };
  }
}

/**
 * Build a wa.me fallback link for manual message sending.
 * Used when the Meta API call fails or in dry-run mode.
 *
 * @param {string} phone - Recipient phone number (digits only or with +)
 * @param {string} text - Message text to pre-fill
 * @returns {string} Encoded wa.me URL
 */
export function buildFallbackLink(phone, text) {
  // Strip any non-digit characters from phone for the wa.me URL
  const cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
  const encodedText = encodeURIComponent(text || "");
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}

/**
 * Log a WhatsApp message attempt to the whatsapp_messages table.
 * Records every send attempt (success, failure, or dry-run) for auditing.
 *
 * @param {object} supabase - Supabase client instance
 * @param {object} params
 * @param {string} [params.orderId] - Associated order ID
 * @param {string} [params.businessId] - Associated business ID
 * @param {string} params.phone - Recipient phone number
 * @param {string} [params.templateName] - Template name used (null for free-text)
 * @param {string} [params.messageBody] - Full message content
 * @param {string} [params.metaMessageId] - Meta API message ID (null on failure)
 * @param {string} params.status - One of: 'SENT', 'FAILED', 'DRY_RUN'
 * @param {string} [params.errorMessage] - Error description (null on success)
 * @returns {Promise<{data: object|null, error: object|null}>}
 */
export async function logWhatsAppMessage(supabase, {
  orderId,
  businessId,
  phone,
  templateName,
  messageBody,
  metaMessageId,
  status,
  errorMessage
}) {
  const record = {
    order_id: orderId || null,
    business_id: businessId || null,
    phone: phone,
    template_name: templateName || null,
    message_body: messageBody || null,
    meta_message_id: metaMessageId || null,
    status: status,
    error_message: errorMessage || null
  };

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .insert(record)
    .select()
    .single();

  if (error) {
    console.error("[logWhatsAppMessage] Failed to insert log:", error.message);
  }

  return { data, error };
}

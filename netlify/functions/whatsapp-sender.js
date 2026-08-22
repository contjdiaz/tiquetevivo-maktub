import { json, parseBody, supabaseAdmin } from "./_utils.js";
import { sendWhatsAppMessage, buildOrderMessage, buildOrderMessageFromTemplate, buildFallbackLink, logWhatsAppMessage } from "./_whatsapp.js";
import { getBusinessConfig } from "./_vertical-config.js";
import { selectTemplate, renderTemplate } from "./_template-engine.js";

// Re-export for backward compatibility
export { buildOrderMessage };

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const to = body.to || body.customerPhone;

    if (!to) {
      return json(400, { error: "to (recipient phone) is required" });
    }

    let text = body.text;

    // If no explicit text provided, use Template Engine to compose message
    if (!text) {
      try {
        const businessId = body.business_id || body.businessId;

        if (businessId) {
          // Vertical-aware message composition via Template Engine
          const supabase = supabaseAdmin();
          const businessConfig = await getBusinessConfig(supabase, businessId);

          const triggerEvent = body.triggerEvent || body.trigger_event || "order_created";
          const verticalTemplates = businessConfig.vertical?.whatsapp_templates_default || null;
          const businessTemplates = businessConfig.whatsapp_templates_config || null;

          const template = selectTemplate(triggerEvent, businessTemplates, verticalTemplates);

          // Determine status label
          const statusFlow = businessConfig.status_flow_config || [];
          const status = body.status || "";
          const statusEntry = statusFlow.find(
            entry => entry.status_key && entry.status_key.toUpperCase() === status.toUpperCase()
          );
          const statusLabel = statusEntry ? statusEntry.display_label : status;

          text = renderTemplate(template, {
            customer_name: body.customerName || body.customer_name || "",
            order_number: body.orderNumber || body.order_number || "",
            items_text: body.itemsText || body.items_text || "",
            total: body.total != null ? Number(body.total) : 0,
            balance: Number(body.balance ?? Math.max(0, Number(body.total || 0) - Number(body.paid || 0))),
            status_label: statusLabel,
            custom_fields: body.custom_fields || body.customFields || {}
          }, {
            name: businessConfig.name || body.businessName || body.business_name || ""
          });
        } else {
          // Fallback: use legacy buildOrderMessage when no business context is available
          text = buildOrderMessage(body);
        }
      } catch (templateError) {
        // Template Engine errors should not block message sending —
        // fall back to legacy message building
        console.error("[whatsapp-sender] Template Engine error, using fallback:", templateError.message);
        text = buildOrderMessage(body);
      }
    }

    if (!text) {
      return json(400, { error: "Could not compose message. Provide 'text' or order data." });
    }

    const result = await sendWhatsAppMessage({ to, text });

    // Log the message attempt if business context is available
    try {
      const businessId = body.business_id || body.businessId;
      const orderId = body.orderId || body.order_id;
      if (businessId) {
        const supabase = supabaseAdmin();
        const logStatus = result.success ? "SENT" : result.dryRun ? "DRY_RUN" : "FAILED";
        await logWhatsAppMessage(supabase, {
          orderId: orderId || null,
          businessId,
          phone: to,
          templateName: body.triggerEvent || body.trigger_event || null,
          messageBody: text,
          metaMessageId: result.messageId || null,
          status: logStatus,
          errorMessage: result.error || null
        });
      }
    } catch (logError) {
      // Logging errors should never block the response
      console.error("[whatsapp-sender] Failed to log message:", logError.message);
    }

    // Dry-run mode: return the same shape as before (200 with dryRun flag)
    if (result.dryRun) {
      return json(200, { dryRun: true, to, text, fallbackLink: result.fallbackLink || buildFallbackLink(to, text) });
    }

    // Successful send: return the raw Meta API response
    if (result.success) {
      return json(200, result.raw);
    }

    // API error: return 502 with error details and fallback link
    return json(502, {
      error: result.error,
      fallbackLink: result.fallbackLink || buildFallbackLink(to, text)
    });
  } catch (error) {
    // Top-level catch ensures no unhandled errors crash the function
    console.error("[whatsapp-sender] Unexpected error:", error.message);
    return json(500, { error: error.message });
  }
};

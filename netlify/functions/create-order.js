import { getBusinessBySlug, getClientIp, json, parseBody, requireAuth, supabaseAdmin } from "./_utils.js";
import { mirrorOrderToSheets } from "./_sheets.js";
import { validatePhone, validateAmount, validateRequired, validateCustomFields, validateStatusInFlow } from "./_validators.js";
import { sendWhatsAppMessage, buildFallbackLink, logWhatsAppMessage } from "./_whatsapp.js";
import { getBusinessConfig } from "./_vertical-config.js";
import { selectTemplate, renderTemplate } from "./_template-engine.js";

/**
 * Validates that a value is a base64 data URL for an image.
 * Accepts JPEG, PNG, GIF and WebP data URLs.
 */
function isImageDataUrl(value) {
  if (typeof value !== "string") return false;
  return /^data:image\/(jpeg|png|gif|webp);base64,/.test(value);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);

    // --- Task 4.1: Input validation ---
    // Validate required fields (customer_name, items_text, and business identifier)
    const hasBusinessId = body.businessSlug || body.slug || body.business_id;
    if (!hasBusinessId) {
      return json(400, { error: true, message: "business_id or slug is required", field: "businessSlug" });
    }

    const requiredCheck = validateRequired(body, ["customerName", "customerPhone", "itemsText"]);
    if (!requiredCheck.valid) {
      return json(400, { error: true, message: requiredCheck.errors.join("; ") });
    }

    // Validate phone format
    const phoneResult = validatePhone(body.customerPhone);
    if (!phoneResult.valid) {
      return json(400, { error: true, message: phoneResult.error, field: "customer_phone" });
    }

    // Validate amounts (total and paid) if provided
    if (body.total != null) {
      const totalResult = validateAmount(body.total, "total");
      if (!totalResult.valid) {
        return json(400, { error: true, message: totalResult.error, field: "total" });
      }
    }

    if (body.paid != null) {
      const paidResult = validateAmount(body.paid, "paid");
      if (!paidResult.valid) {
        return json(400, { error: true, message: paidResult.error, field: "paid" });
      }
    }

    // --- Photo evidence: validate intake photo if provided ---
    if (body.intakePhoto != null && !isImageDataUrl(body.intakePhoto)) {
      return json(400, { error: true, message: "intakePhoto must be a base64 image data URL", field: "intakePhoto" });
    }

    const supabase = supabaseAdmin();
    const slug = body.businessSlug || body.slug || "majesty";

    // Resolve business by slug or ID
    let business;
    if (body.business_id) {
      const { data: bizData, error: bizError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", body.business_id)
        .single();
      if (bizError) throw bizError;
      business = bizData;
    } else {
      business = await getBusinessBySlug(supabase, slug);
    }

    // --- Authentication and authorization ---
    const authResult = await requireAuth(supabase, event, {
      permission: "create_order",
      businessId: business.id
    });
    if (authResult.error) return authResult.error;

    // --- Task 4.2: Check business active status ---
    if (business.active === false) {
      return json(403, { error: true, message: "Business is deactivated. Cannot create orders." });
    }

    // --- Freemium: premium features require paid plan ---
    const isPaid = business.plan === "paid";
    if (!isPaid && body.intakePhoto) {
      return json(403, { error: true, message: "Photo evidence requires a paid plan." });
    }
    if (!isPaid && (body.intakeConfirmed === true || body.intakeConfirmed === "true")) {
      return json(403, { error: true, message: "Digital confirmation requires a paid plan." });
    }

    // --- Task 7.1: Fetch business config for vertical-aware validation ---
    const businessConfig = await getBusinessConfig(supabase, business.id);

    // --- Task 7.1: Map legacy fields into custom_fields for backward compatibility ---
    let customFields = body.custom_fields || body.customFields || {};

    // Map legacy top-level fields (is_delicate, rack_location) into custom_fields
    if (body.is_delicate !== undefined || body.isDelicate !== undefined) {
      customFields.is_delicate = body.is_delicate ?? body.isDelicate;
    }
    if (body.rack_location !== undefined || body.rackLocation !== undefined) {
      customFields.rack_location = body.rack_location ?? body.rackLocation;
    }

    // --- Task 7.1: Validate custom fields against business definitions ---
    const customFieldsDefs = businessConfig.custom_fields_config || [];
    if (customFieldsDefs.length > 0 || Object.keys(customFields).length > 0) {
      const cfResult = validateCustomFields(customFields, customFieldsDefs);
      if (!cfResult.valid) {
        return json(400, { error: true, message: cfResult.errors.join("; ") });
      }
    }

    // --- Task 7.1: Validate initial status against business status_flow ---
    const statusFlow = businessConfig.status_flow_config || [];
    let resolvedStatus = body.status;

    if (!resolvedStatus && statusFlow.length > 0) {
      // Default to first status in business flow if not provided
      resolvedStatus = statusFlow[0].status_key;
    } else if (!resolvedStatus) {
      // Fallback for businesses without status flow configured
      resolvedStatus = "RECEIVED";
    }

    if (statusFlow.length > 0) {
      const statusResult = validateStatusInFlow(resolvedStatus, statusFlow);
      if (!statusResult.valid) {
        return json(400, { error: true, message: statusResult.error });
      }
      resolvedStatus = statusResult.value;
    }

    const orderNumber = body.orderNumber || String(Date.now()).slice(-6);

    const payload = {
      business_id: business.id,
      order_number: orderNumber,
      customer_name: body.customerName,
      customer_phone: phoneResult.value,
      items_text: body.itemsText,
      total: Number(body.total || 0),
      paid: Number(body.paid || 0),
      status: resolvedStatus,
      custom_fields: customFields
    };

    // Add optional columns only if values are provided
    if (body.dueDate) payload.due_date = body.dueDate;

    // Add intake photo evidence if provided
    if (body.intakePhoto) {
      payload.intake_photo_url = body.intakePhoto;
      payload.intake_photo_taken_at = new Date().toISOString();
    }

    // Add intake digital confirmation if provided
    if (body.intakeConfirmed === true || body.intakeConfirmed === "true") {
      payload.intake_confirmed_at = new Date().toISOString();
      payload.intake_confirmed_ip = getClientIp(event);
    }

    const { data, error } = await supabase
      .from("orders")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    // Mirror to Google Sheets (fire and forget)
    mirrorOrderToSheets(data, business).catch(() => {});

    // --- Task 7.1: WhatsApp auto-send using Template Engine ---
    let whatsappResult = null;

    try {
      // Use Template Engine for message composition
      const verticalTemplates = businessConfig.vertical?.whatsapp_templates_default || null;
      const businessTemplates = businessConfig.whatsapp_templates_config || null;

      const template = selectTemplate("order_created", businessTemplates, verticalTemplates);

      // Determine status label for template rendering
      const statusEntry = statusFlow.find(
        entry => entry.status_key.toUpperCase() === resolvedStatus.toUpperCase()
      );
      const statusLabel = statusEntry ? statusEntry.display_label : resolvedStatus;

      const messageText = renderTemplate(template, {
        customer_name: data.customer_name,
        order_number: data.order_number,
        items_text: data.items_text,
        total: data.total,
        balance: Math.max(0, Number(data.total || 0) - Number(data.paid || 0)),
        status_label: statusLabel,
        custom_fields: customFields
      }, {
        name: business.name
      });

      // Send via Meta Cloud API (or dry-run)
      const sendResult = await sendWhatsAppMessage({
        to: phoneResult.value,
        text: messageText
      });

      if (sendResult.success) {
        // Successful send: update whatsapp_sent_at on the order
        await supabase
          .from("orders")
          .update({ whatsapp_sent_at: new Date().toISOString() })
          .eq("id", data.id);

        // Log with status SENT
        await logWhatsAppMessage(supabase, {
          orderId: data.id,
          businessId: business.id,
          phone: phoneResult.value,
          templateName: null,
          messageBody: messageText,
          metaMessageId: sendResult.messageId || null,
          status: "SENT",
          errorMessage: null
        });

        whatsappResult = { sent: true, messageId: sendResult.messageId };
      } else if (sendResult.dryRun) {
        // Dry-run mode: log with DRY_RUN status
        await logWhatsAppMessage(supabase, {
          orderId: data.id,
          businessId: business.id,
          phone: phoneResult.value,
          templateName: null,
          messageBody: messageText,
          metaMessageId: null,
          status: "DRY_RUN",
          errorMessage: null
        });

        whatsappResult = {
          sent: false,
          dryRun: true,
          fallbackLink: sendResult.fallbackLink || buildFallbackLink(phoneResult.value, messageText)
        };
      } else {
        // API failure: log with FAILED status
        await logWhatsAppMessage(supabase, {
          orderId: data.id,
          businessId: business.id,
          phone: phoneResult.value,
          templateName: null,
          messageBody: messageText,
          metaMessageId: null,
          status: "FAILED",
          errorMessage: sendResult.error || "Unknown error"
        });

        whatsappResult = {
          sent: false,
          error: sendResult.error,
          fallbackLink: sendResult.fallbackLink || buildFallbackLink(phoneResult.value, messageText)
        };
      }
    } catch (waError) {
      // WhatsApp errors never fail the order creation
      console.error("[create-order] WhatsApp send error:", waError.message);
      whatsappResult = {
        sent: false,
        error: waError.message,
        fallbackLink: buildFallbackLink(phoneResult.value, "")
      };
    }

    return json(201, { ...data, whatsapp: whatsappResult });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

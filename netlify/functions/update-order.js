import { getBusinessBySlug, getClientIp, json, parseBody, requireAuth, supabaseAdmin } from "./_utils.js";
import { mirrorOrderToSheets } from "./_sheets.js";
import { validateStatus, validateAmount, validateStatusTransition, validateStatusInFlow } from "./_validators.js";
import { sendWhatsAppMessage, buildFallbackLink, logWhatsAppMessage } from "./_whatsapp.js";
import { getBusinessConfig } from "./_vertical-config.js";
import { selectTemplate, renderTemplate } from "./_template-engine.js";
import { getOrCreateLoyaltyProfile, addStamp, revertStamp } from "./_loyalty.js";
import { validatePhoto, uploadPhoto } from "./_photo-storage.js";

function normalizeOrderItems(items, businessId) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const normalized = [];
  for (const item of items) {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice || item.unit_price);
    if (!item.itemType && !item.item_type && !item.description) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) continue;
    normalized.push({
      business_id: businessId,
      item_type: item.itemType || item.item_type || "prenda",
      description: item.description || "",
      quantity,
      unit_price: unitPrice,
      status: ["OK", "DAMAGED", "MISSING", "STAINED"].includes(item.status) ? item.status : "OK"
    });
  }
  return normalized.length > 0 ? normalized : null;
}

function buildItemsText(items) {
  if (!items || items.length === 0) return "";
  return items
    .map((i) => `${i.quantity}x ${i.item_type}${i.description ? ` (${i.description})` : ""}`)
    .join(", ");
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "PUT" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = parseBody(event);
    const orderId = body.id || body.orderId;
    if (!orderId) {
      return json(400, { error: "Order id is required" });
    }

    const supabase = supabaseAdmin();

    // Resolve the business (by slug, business_id, or default)
    const slug = body.businessSlug || body.slug;
    const businessId = body.business_id;

    let business;
    let businessConfig;

    if (businessId) {
      // Fetch business config using the vertical-config module
      businessConfig = await getBusinessConfig(supabase, businessId);
      const { data: bizData, error: bizError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", businessId)
        .single();
      if (bizError) throw bizError;
      business = bizData;
    } else if (slug) {
      business = await getBusinessBySlug(supabase, slug);
      businessConfig = await getBusinessConfig(supabase, business.id);
    } else {
      // Fallback: fetch the order first to get its business_id
      const { data: orderCheck, error: orderCheckError } = await supabase
        .from("orders")
        .select("business_id")
        .eq("id", orderId)
        .single();
      if (orderCheckError) throw orderCheckError;
      if (!orderCheck) return json(404, { error: true, message: "Order not found" });

      businessConfig = await getBusinessConfig(supabase, orderCheck.business_id);
      const { data: bizData, error: bizError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", orderCheck.business_id)
        .single();
      if (bizError) throw bizError;
      business = bizData;
    }

    // --- Tenant isolation: verify order belongs to authenticated business ---
    const { data: existingOrder, error: fetchOrderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (fetchOrderError || !existingOrder) {
      return json(404, { error: true, message: "Order not found" });
    }

    if (existingOrder.business_id !== business.id) {
      return json(403, { error: true, message: "Access denied" });
    }

    // --- Authentication and authorization ---
    const permission = body.status === "CANCELLED" ? "delete_order" : "update_order";
    const authResult = await requireAuth(supabase, event, {
      permission,
      businessId: business.id
    });
    if (authResult.error) return authResult.error;

    // --- Freemium: premium features require paid plan ---
    const isPaid = business.plan === "paid";
    if (!isPaid && body.deliveryPhoto) {
      return json(403, { error: true, message: "Photo evidence requires a paid plan." });
    }
    if (!isPaid && (body.intakeConfirmed === true || body.intakeConfirmed === "true")) {
      return json(403, { error: true, message: "Digital confirmation requires a paid plan." });
    }
    if (!isPaid && (body.deliveryConfirmed === true || body.deliveryConfirmed === "true")) {
      return json(403, { error: true, message: "Digital confirmation requires a paid plan." });
    }

    // --- Input validation for updatable fields ---
    const validationErrors = [];
    const statusFlow = businessConfig.status_flow_config || [];

    if (body.status) {
      if (statusFlow.length > 0) {
        // Vertical-aware: validate status exists in flow
        const statusInFlowResult = validateStatusInFlow(body.status, statusFlow);
        if (!statusInFlowResult.valid) {
          validationErrors.push(statusInFlowResult.error);
        } else {
          // Validate the transition is sequential (next step or CANCELLED)
          const transitionResult = validateStatusTransition(
            existingOrder.status,
            statusInFlowResult.value,
            statusFlow
          );
          if (!transitionResult.valid) {
            validationErrors.push(transitionResult.error);
          }
        }
      } else {
        // Fallback to legacy validation if no status flow configured
        const statusResult = validateStatus(body.status);
        if (!statusResult.valid) {
          validationErrors.push(statusResult.error);
        }
      }
    }

    if (typeof body.total !== "undefined") {
      const totalResult = validateAmount(body.total, "total");
      if (!totalResult.valid) {
        validationErrors.push(totalResult.error);
      }
    }

    if (typeof body.paid !== "undefined") {
      const paidResult = validateAmount(body.paid, "paid");
      if (!paidResult.valid) {
        validationErrors.push(paidResult.error);
      }
    }

    // --- Photo evidence: validate delivery photo if provided ---
    if (body.deliveryPhoto != null) {
      const photoValidation = validatePhoto(body.deliveryPhoto);
      if (!photoValidation.valid) {
        return json(400, { error: true, message: photoValidation.error, field: "deliveryPhoto" });
      }
    }

    if (validationErrors.length > 0) {
      return json(400, { error: true, message: validationErrors.join("; "), errors: validationErrors });
    }

    // Build update payload
    const updatePayload = {};

    if (body.status) {
      if (statusFlow.length > 0) {
        updatePayload.status = validateStatusInFlow(body.status, statusFlow).value;
      } else {
        updatePayload.status = validateStatus(body.status).value;
      }
    }

    if (typeof body.paid !== "undefined") updatePayload.paid = validateAmount(body.paid, "paid").value;
    if (typeof body.total !== "undefined") updatePayload.total = validateAmount(body.total, "total").value;
    if (body.itemsText) updatePayload.items_text = body.itemsText;
    if (body.dueDate) updatePayload.due_date = body.dueDate;

    // Legacy field support: map rack_location and is_delicate into custom_fields
    if (typeof body.rackLocation !== "undefined" || typeof body.rack_location !== "undefined") {
      updatePayload.rack_location = body.rackLocation || body.rack_location || null;
    }
    if (typeof body.isDelicate !== "undefined" || typeof body.is_delicate !== "undefined") {
      updatePayload.is_delicate = Boolean(body.isDelicate || body.is_delicate);
    }

    // Support updating custom_fields directly
    if (body.custom_fields && typeof body.custom_fields === "object") {
      const existingCustom = existingOrder.custom_fields || {};
      updatePayload.custom_fields = { ...existingCustom, ...body.custom_fields };
    }

    // --- Photo upload to Supabase Storage (BEFORE updating order record) ---
    let deliveryPhotoPath = null;
    if (body.deliveryPhoto) {
      // Derive file extension from MIME type
      const mimeMatch = body.deliveryPhoto.match(/^data:image\/([^;]+);base64,/);
      const ext = mimeMatch ? mimeMatch[1].replace("jpeg", "jpg") : "jpg";
      const storagePath = `${business.id}/${orderId}/delivery.${ext}`;

      try {
        const uploadResult = await uploadPhoto(supabase, body.deliveryPhoto, storagePath);
        deliveryPhotoPath = uploadResult.path;
      } catch (uploadError) {
        // If upload fails, do NOT update the order record
        return json(500, { error: true, message: "Photo upload failed" });
      }
    }

    // Add delivery photo evidence if uploaded successfully
    if (deliveryPhotoPath) {
      updatePayload.delivery_photo_url = deliveryPhotoPath;
      updatePayload.delivery_photo_taken_at = new Date().toISOString();
    }

    // Add intake digital confirmation if provided
    if (body.intakeConfirmed === true || body.intakeConfirmed === "true") {
      updatePayload.intake_confirmed_at = new Date().toISOString();
      updatePayload.intake_confirmed_ip = getClientIp(event);
    }

    // Add delivery digital confirmation if provided
    if (body.deliveryConfirmed === true || body.deliveryConfirmed === "true") {
      updatePayload.delivery_confirmed_at = new Date().toISOString();
      updatePayload.delivery_confirmed_ip = getClientIp(event);
    }

    // --- Structured items checklist (paid plan only) ---
    let orderItems = null;
    if (isPaid && body.items) {
      orderItems = normalizeOrderItems(body.items, business.id);
      if (orderItems) {
        updatePayload.items_text = buildItemsText(orderItems);
      }
    }

    if (Object.keys(updatePayload).length === 0 && !orderItems) {
      return json(400, { error: true, message: "No fields provided to update" });
    }

    const { data, error } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .select()
      .single();

    if (error) throw error;

    // Replace order items if provided (paid plan)
    if (orderItems && orderItems.length > 0) {
      await supabase.from("order_items").delete().eq("order_id", orderId);
      const itemsWithOrderId = orderItems.map((item) => ({ ...item, order_id: orderId }));
      await supabase.from("order_items").insert(itemsWithOrderId);
    }

    // Mirror to sheets (fire-and-forget)
    mirrorOrderToSheets(data, business).catch(() => {});

    // --- Loyalty stamp logic (fire-and-log: never fails the status update) ---
    if (updatePayload.status && data.customer_phone) {
      try {
        const loyaltyEnabled = business.loyalty_config?.enabled !== false;
        if (loyaltyEnabled) {
          const isLastStatus = statusFlow.length > 0
            ? statusFlow.findIndex(
                entry => entry.status_key.toUpperCase() === updatePayload.status.toUpperCase()
              ) === statusFlow.length - 1
            : updatePayload.status === "DELIVERED";

          const isCancelled = updatePayload.status === "CANCELLED";

          if (isLastStatus) {
            // Order reached final delivery status → add stamp
            const profileResult = await getOrCreateLoyaltyProfile(supabase, data.customer_phone);
            if (profileResult.success) {
              const stampResult = await addStamp(
                supabase,
                profileResult.profile.id,
                orderId,
                business.id
              );
              if (!stampResult.success) {
                console.error("[Loyalty] addStamp error:", stampResult.error);
              }
            } else {
              console.error("[Loyalty] getOrCreateLoyaltyProfile error:", profileResult.error);
            }
          } else if (isCancelled) {
            // Order cancelled → revert stamp if one was previously given
            const profileResult = await getOrCreateLoyaltyProfile(supabase, data.customer_phone);
            if (profileResult.success) {
              const revertResult = await revertStamp(
                supabase,
                profileResult.profile.id,
                orderId
              );
              if (!revertResult.success) {
                console.error("[Loyalty] revertStamp error:", revertResult.error);
              }
            } else {
              console.error("[Loyalty] getOrCreateLoyaltyProfile error:", profileResult.error);
            }
          }
        }
      } catch (loyaltyError) {
        // Loyalty errors never fail the status update (fire-and-log pattern)
        console.error("[Loyalty] Unexpected error:", loyaltyError.message || loyaltyError);
      }
    }

    // --- WhatsApp notification on status change using Template Engine ---
    const newStatus = updatePayload.status;

    if (newStatus) {
      // Determine trigger event based on the new status
      let triggerEvent = null;
      if (statusFlow.length > 0) {
        // In vertical-aware mode, check if it's the second-to-last status (ready) or last status (delivered)
        const statusIndex = statusFlow.findIndex(
          entry => entry.status_key.toUpperCase() === newStatus.toUpperCase()
        );
        const lastIndex = statusFlow.length - 1;
        const secondToLastIndex = statusFlow.length - 2;

        if (statusIndex === secondToLastIndex && secondToLastIndex >= 0) {
          triggerEvent = "status_ready";
        } else if (statusIndex === lastIndex) {
          triggerEvent = "status_delivered";
        }
      } else {
        // Legacy behavior: READY and DELIVERED triggers
        if (newStatus === "READY") {
          triggerEvent = "status_ready";
        } else if (newStatus === "DELIVERED") {
          triggerEvent = "status_delivered";
        }
      }

      if (triggerEvent) {
        const customerPhone = data.customer_phone;
        const orderNumber = data.order_number || orderId;

        // Use Template Engine for message composition
        const verticalTemplates = businessConfig.vertical
          ? businessConfig.vertical.whatsapp_templates_default
          : null;
        const businessTemplates = businessConfig.whatsapp_templates_config || null;

        const template = selectTemplate(triggerEvent, businessTemplates, verticalTemplates);

        // Find status display label
        const statusEntry = statusFlow.find(
          entry => entry.status_key.toUpperCase() === newStatus.toUpperCase()
        );
        const statusLabel = statusEntry ? statusEntry.display_label : newStatus;

        const messageText = renderTemplate(template, {
          customer_name: data.customer_name,
          order_number: orderNumber,
          items_text: data.items_text,
          total: data.total,
          balance: Math.max(0, Number(data.total || 0) - Number(data.paid || 0)),
          status_label: statusLabel,
          custom_fields: data.custom_fields || {}
        }, {
          name: business.name || businessConfig.name
        });

        // Send WhatsApp notification
        const sendResult = await sendWhatsAppMessage({ to: customerPhone, text: messageText });

        if (sendResult.success) {
          // Update whatsapp_sent_at on the order
          await supabase
            .from("orders")
            .update({ whatsapp_sent_at: new Date().toISOString() })
            .eq("id", orderId);

          // Log with status SENT
          await logWhatsAppMessage(supabase, {
            orderId: orderId,
            businessId: data.business_id,
            phone: customerPhone,
            templateName: null,
            messageBody: messageText,
            metaMessageId: sendResult.messageId || null,
            status: "SENT",
            errorMessage: null
          });

          return json(200, { ...data, whatsapp_sent_at: new Date().toISOString(), whatsappResult: sendResult });
        } else {
          // Log with status FAILED (or DRY_RUN)
          const logStatus = sendResult.dryRun ? "DRY_RUN" : "FAILED";
          await logWhatsAppMessage(supabase, {
            orderId: orderId,
            businessId: data.business_id,
            phone: customerPhone,
            templateName: null,
            messageBody: messageText,
            metaMessageId: null,
            status: logStatus,
            errorMessage: sendResult.error || null
          });

          // Include fallback link in response without reverting the status update
          const fallbackLink = sendResult.fallbackLink || buildFallbackLink(customerPhone, messageText);
          return json(200, { ...data, fallbackLink, whatsappResult: sendResult });
        }
      }
    }

    return json(200, data);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

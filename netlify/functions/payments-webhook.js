/**
 * Payment Webhook Processor for TiqueteVivo.
 * Public endpoint — no JWT required; security relies on cryptographic signature verification.
 *
 * POST /api/payments-webhook
 *
 * Handles webhooks from Wompi and Bold payment gateways:
 * 1. Detects gateway from payload structure or headers
 * 2. Validates cryptographic signature → rejects with 401 if invalid
 * 3. Checks idempotency via gateway_transaction_id → returns 200 if already processed
 * 4. Fetches associated order → rejects payment application for CANCELLED orders
 * 5. Compares amount to current balance → applies full/partial or marks MANUAL_REVIEW
 * 6. On successful apply: sends WhatsApp payment_confirmed notification
 * 7. Persists raw_payload for audit trail
 *
 * Requirements: 5, 6
 */

import { json, parseBody, supabaseAdmin, getClientIp } from "./_utils.js";
import { checkRateLimit } from "./_rate-limiter.js";
import { verifyWompiSignature, verifyBoldSignature, applyApprovedPayment } from "./_payments.js";
import { sendWhatsAppMessage, logWhatsAppMessage } from "./_whatsapp.js";
import { selectTemplate, renderTemplate } from "./_template-engine.js";

/**
 * Detects the payment gateway based on payload structure or headers.
 * - Wompi: payload has `event` field and `data.transaction` structure
 * - Bold: request has `x-bold-signature` header
 *
 * @param {object} event - Netlify function event
 * @param {object} body - Parsed JSON body
 * @returns {"WOMPI"|"BOLD"|null}
 */
function detectGateway(event, body) {
  // Bold sends x-bold-signature header
  const headers = event.headers || {};
  if (headers["x-bold-signature"] || headers["X-Bold-Signature"]) {
    return "BOLD";
  }

  // Wompi has event field with "transaction.updated" and data.transaction structure
  if (body && body.data && body.data.transaction && body.signature) {
    return "WOMPI";
  }

  return null;
}

/**
 * Extracts relevant payment data from a Wompi webhook payload.
 * @param {object} body - Parsed webhook body
 * @returns {{ gatewayTxId: string, reference: string, amount: number, status: string }|null}
 */
function extractWompiData(body) {
  const tx = body?.data?.transaction;
  if (!tx) return null;

  return {
    gatewayTxId: String(tx.id),
    reference: tx.reference,
    // Wompi sends amount_in_cents — convert to COP
    amount: Number(tx.amount_in_cents) / 100,
    status: (tx.status || "").toUpperCase()
  };
}

/**
 * Extracts relevant payment data from a Bold webhook payload.
 * @param {object} body - Parsed webhook body
 * @returns {{ gatewayTxId: string, reference: string, amount: number, status: string }|null}
 */
function extractBoldData(body) {
  // Bold payload structure: { transaction_id, reference, amount, status, ... }
  if (!body || !body.transaction_id) return null;

  return {
    gatewayTxId: String(body.transaction_id),
    reference: body.reference,
    amount: Number(body.amount),
    status: (body.status || "").toUpperCase()
  };
}

/**
 * Extracts the order_id from a payment reference.
 * Payment references follow the format: "slug-ORDER_ID-timestamp" or just contain the order UUID.
 *
 * @param {object} supabase - Supabase client
 * @param {string} reference - Payment reference string
 * @returns {Promise<string|null>} The order ID or null
 */
async function resolveOrderFromReference(supabase, reference) {
  if (!reference) return null;

  // Try treating the reference as containing a UUID (most common)
  const uuidMatch = reference.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) {
    const { data } = await supabase
      .from("orders")
      .select("id")
      .eq("id", uuidMatch[1])
      .maybeSingle();
    if (data) return data.id;
  }

  // Fallback: look up by payment_reference field if stored on order
  const { data: orderByRef } = await supabase
    .from("payments")
    .select("order_id")
    .eq("gateway_transaction_id", reference)
    .maybeSingle();
  if (orderByRef) return orderByRef.order_id;

  return null;
}

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return json(200, {});

  // Rate limiting: 60 requests/minute per client IP
  const clientIp = getClientIp(event);
  const rateResult = checkRateLimit(`${clientIp}:payments-webhook`, 60, 60000);
  if (!rateResult.allowed) {
    return {
      statusCode: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(rateResult.retryAfter)
      },
      body: JSON.stringify({ error: "Too many requests" })
    };
  }

  // Only accept POST
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = parseBody(event);
    const rawPayload = body; // Preserve raw payload for audit (CA-13)

    // 1. Detect gateway
    const gateway = detectGateway(event, body);
    if (!gateway) {
      return json(400, { error: "Unable to detect payment gateway" });
    }

    // 2. Validate cryptographic signature
    let signatureResult;

    if (gateway === "WOMPI") {
      const integritySecret = process.env.WOMPI_EVENTS_SECRET || process.env.WOMPI_INTEGRITY_SECRET;
      signatureResult = verifyWompiSignature(body, integritySecret);
    } else {
      const boldSecret = process.env.BOLD_SECRET;
      signatureResult = verifyBoldSignature(event, boldSecret);
    }

    if (!signatureResult.valid) {
      console.warn(`[payments-webhook] Invalid ${gateway} signature:`, signatureResult.error);
      return json(401, { error: "Invalid signature" });
    }

    // 3. Extract payment data
    const paymentData = gateway === "WOMPI"
      ? extractWompiData(body)
      : extractBoldData(body);

    if (!paymentData) {
      return json(400, { error: "Unable to extract payment data from payload" });
    }

    const { gatewayTxId, reference, amount, status } = paymentData;

    // Initialize Supabase client
    const supabase = supabaseAdmin();

    // 4. Idempotency check: has this transaction already been processed?
    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id, status")
      .eq("gateway_transaction_id", gatewayTxId)
      .maybeSingle();

    if (existingPayment) {
      // Already processed — return 200 without modification
      return json(200, { message: "Already processed", payment_id: existingPayment.id });
    }

    // 5. Resolve the order from reference
    const orderId = await resolveOrderFromReference(supabase, reference);

    if (!orderId) {
      // Persist the webhook for audit even if we can't resolve the order
      await supabase.from("payments").insert({
        order_id: null,
        business_id: null,
        gateway,
        gateway_transaction_id: gatewayTxId,
        amount,
        currency: "COP",
        status: "MANUAL_REVIEW",
        raw_payload: rawPayload
      });

      return json(200, { message: "Order not found, recorded for manual review" });
    }

    // 6. Handle non-APPROVED statuses (DECLINED, VOIDED, PENDING, ERROR)
    if (status !== "APPROVED") {
      // Fetch order for business_id
      const { data: order } = await supabase
        .from("orders")
        .select("id, business_id")
        .eq("id", orderId)
        .maybeSingle();

      await supabase.from("payments").insert({
        order_id: orderId,
        business_id: order?.business_id || null,
        gateway,
        gateway_transaction_id: gatewayTxId,
        amount,
        currency: "COP",
        status: status === "DECLINED" || status === "VOIDED" || status === "PENDING" ? status : "ERROR",
        raw_payload: rawPayload
      });

      return json(200, { message: `Payment recorded with status ${status}` });
    }

    // 7. APPROVED: apply payment via shared module
    const result = await applyApprovedPayment(supabase, orderId, amount, gatewayTxId, gateway, rawPayload);

    // If duplicate detected at this stage (race condition)
    if (!result.applied && result.reason === "duplicate") {
      return json(200, { message: "Already processed" });
    }

    // 8. On successful application: send WhatsApp payment_confirmed notification
    if (result.applied) {
      try {
        // Fetch order details for notification
        const { data: order } = await supabase
          .from("orders")
          .select("id, business_id, customer_phone, customer_name, order_number, total, paid")
          .eq("id", orderId)
          .single();

        if (order && order.customer_phone) {
          // Fetch business for template rendering
          const { data: business } = await supabase
            .from("businesses")
            .select("name, whatsapp_templates")
            .eq("id", order.business_id)
            .maybeSingle();

          // Build the payment_confirmed message
          const businessTemplates = business?.whatsapp_templates || null;
          const template = selectTemplate("payment_confirmed", businessTemplates, null);

          const messageText = renderTemplate(template, {
            order_number: order.order_number || orderId,
            amount_paid: amount,
            new_balance: result.new_balance
          }, {
            name: business?.name || ""
          });

          // Send WhatsApp notification
          const sendResult = await sendWhatsAppMessage({
            to: order.customer_phone,
            text: messageText
          });

          // Log the message attempt (success or failure)
          const logStatus = sendResult.success ? "SENT" : (sendResult.dryRun ? "DRY_RUN" : "FAILED");
          await logWhatsAppMessage(supabase, {
            orderId: orderId,
            businessId: order.business_id,
            phone: order.customer_phone,
            templateName: "payment_confirmed",
            messageBody: messageText,
            metaMessageId: sendResult.messageId || null,
            status: logStatus,
            errorMessage: sendResult.error || null
          });
        }
      } catch (whatsappError) {
        // WhatsApp failure must NOT revert payment — just log the error (Req 6.3)
        console.error("[payments-webhook] WhatsApp notification failed:", whatsappError.message);
      }
    }

    // Return success response
    return json(200, {
      message: result.applied ? "Payment applied" : `Payment recorded: ${result.reason}`,
      applied: result.applied,
      status: result.status || "APPROVED",
      new_paid: result.new_paid,
      new_balance: result.new_balance
    });
  } catch (error) {
    console.error("[payments-webhook] Unexpected error:", error);
    return json(500, { error: "Internal server error" });
  }
};

/**
 * Shared payments module for TiqueteVivo.
 * Handles gateway signature verification (Wompi, Bold),
 * payment application logic, and checkout URL/link generation.
 */

import { createHmac, createHash } from "crypto";

/**
 * Verifies the Wompi webhook signature.
 * Wompi concatenates: reference + amount_in_cents + currency + status + integrity_secret
 * then produces a SHA256 hex digest and sends it in the event payload.
 *
 * @param {object} event - The webhook event payload (parsed body)
 * @param {string} event.data.transaction.reference - Payment reference
 * @param {string} event.data.transaction.amount_in_cents - Amount in cents
 * @param {string} event.data.transaction.currency - Currency code (e.g. COP)
 * @param {string} event.data.transaction.status - Transaction status
 * @param {string} event.signature.checksum - The checksum from Wompi
 * @param {string} integritySecret - The Wompi integrity/events secret
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyWompiSignature(event, integritySecret) {
  if (!integritySecret) {
    return { valid: false, error: "Integrity secret not configured" };
  }

  if (!event || !event.data || !event.data.transaction) {
    return { valid: false, error: "Invalid event structure: missing data.transaction" };
  }

  if (!event.signature || !event.signature.checksum) {
    return { valid: false, error: "Missing signature checksum" };
  }

  const { reference, amount_in_cents, currency, status } = event.data.transaction;

  if (!reference || amount_in_cents == null || !currency || !status) {
    return { valid: false, error: "Missing required transaction fields for signature verification" };
  }

  // Wompi spec: concatenate reference + amount_in_cents + currency + status + integrity_secret
  const concatenated = `${reference}${amount_in_cents}${currency}${status}${integritySecret}`;
  const expectedChecksum = createHash("sha256").update(concatenated).digest("hex");

  if (expectedChecksum !== event.signature.checksum) {
    return { valid: false, error: "Invalid signature checksum" };
  }

  return { valid: true };
}

/**
 * Verifies the Bold webhook signature using HMAC-SHA256.
 * Bold sends the signature in the `x-bold-signature` header.
 *
 * @param {object} event - The Netlify function event (with headers and body)
 * @param {string} event.headers - Request headers
 * @param {string} event.body - Raw request body string
 * @param {string} boldSecret - The Bold webhook secret key
 * @returns {{ valid: boolean, error?: string }}
 */
export function verifyBoldSignature(event, boldSecret) {
  if (!boldSecret) {
    return { valid: false, error: "Bold secret not configured" };
  }

  if (!event || !event.headers) {
    return { valid: false, error: "Invalid event: missing headers" };
  }

  const signature = event.headers["x-bold-signature"] || event.headers["X-Bold-Signature"];

  if (!signature) {
    return { valid: false, error: "Missing x-bold-signature header" };
  }

  if (!event.body) {
    return { valid: false, error: "Missing request body" };
  }

  const expectedSignature = createHmac("sha256", boldSecret)
    .update(event.body)
    .digest("hex");

  if (expectedSignature !== signature) {
    return { valid: false, error: "Invalid HMAC signature" };
  }

  return { valid: true };
}

/**
 * Applies an approved payment to an order transactionally.
 * Inserts a payment record and updates orders.paid.
 *
 * Edge cases handled:
 * - Duplicate gateway_transaction_id → { applied: false, reason: "duplicate" }
 * - Order in CANCELLED status → { applied: false, reason: "order_cancelled" }
 * - Amount > current balance → { applied: false, reason: "manual_review", status: "MANUAL_REVIEW" }
 * - Amount ≤ balance → applies payment, returns new_paid and new_balance
 *
 * @param {object} supabase - Supabase client instance
 * @param {string} orderId - The order UUID
 * @param {number} amount - Payment amount
 * @param {string} gatewayTxId - Gateway transaction ID (idempotency key)
 * @param {string} gateway - Gateway name: "WOMPI" or "BOLD"
 * @param {object} rawPayload - Complete raw webhook payload for audit
 * @returns {Promise<{ applied: boolean, new_paid?: number, new_balance?: number, reason?: string, status?: string }>}
 */
export async function applyApprovedPayment(supabase, orderId, amount, gatewayTxId, gateway, rawPayload) {
  // 1. Check for duplicate payment (idempotency via gateway_transaction_id)
  const { data: existingPayment } = await supabase
    .from("payments")
    .select("id, status")
    .eq("gateway_transaction_id", gatewayTxId)
    .maybeSingle();

  if (existingPayment) {
    return { applied: false, reason: "duplicate", status: existingPayment.status };
  }

  // 2. Fetch the order to check status and current balance
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, business_id, status, total, paid")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return { applied: false, reason: "order_not_found" };
  }

  // 3. Cancelled orders → record as MANUAL_REVIEW, don't modify paid
  if (order.status === "CANCELLED") {
    await supabase.from("payments").insert({
      order_id: orderId,
      business_id: order.business_id,
      gateway,
      gateway_transaction_id: gatewayTxId,
      amount,
      currency: "COP",
      status: "MANUAL_REVIEW",
      raw_payload: rawPayload
    });

    return { applied: false, reason: "order_cancelled", status: "MANUAL_REVIEW" };
  }

  // 4. Calculate current balance
  const currentPaid = Number(order.paid || 0);
  const total = Number(order.total || 0);
  const currentBalance = Math.max(0, total - currentPaid);

  // 5. Amount > balance → MANUAL_REVIEW (overpayment)
  if (amount > currentBalance) {
    await supabase.from("payments").insert({
      order_id: orderId,
      business_id: order.business_id,
      gateway,
      gateway_transaction_id: gatewayTxId,
      amount,
      currency: "COP",
      status: "MANUAL_REVIEW",
      raw_payload: rawPayload
    });

    return { applied: false, reason: "manual_review", status: "MANUAL_REVIEW" };
  }

  // 6. Apply payment: insert record + update orders.paid
  const newPaid = currentPaid + amount;
  const newBalance = Math.max(0, total - newPaid);

  // Insert payment record as APPROVED
  const { error: insertError } = await supabase.from("payments").insert({
    order_id: orderId,
    business_id: order.business_id,
    gateway,
    gateway_transaction_id: gatewayTxId,
    amount,
    currency: "COP",
    status: "APPROVED",
    raw_payload: rawPayload
  });

  if (insertError) {
    // Unique constraint violation = duplicate (race condition safety)
    if (insertError.code === "23505") {
      return { applied: false, reason: "duplicate" };
    }
    return { applied: false, reason: `db_error: ${insertError.message}` };
  }

  // Update orders.paid
  const { error: updateError } = await supabase
    .from("orders")
    .update({ paid: newPaid })
    .eq("id", orderId);

  if (updateError) {
    return { applied: false, reason: `update_error: ${updateError.message}` };
  }

  return { applied: true, new_paid: newPaid, new_balance: newBalance };
}

/**
 * Builds a Wompi checkout URL for redirecting the customer to payment.
 *
 * @param {string} orderRef - Unique payment reference (e.g. "slug-ORD123-ts")
 * @param {number} amountCents - Amount in cents (COP integer)
 * @param {string} redirectUrl - URL to redirect after payment
 * @param {string} publicKey - Wompi public key
 * @returns {{ url: string, reference: string }}
 */
export function createWompiCheckout(orderRef, amountCents, redirectUrl, publicKey) {
  if (!publicKey) {
    throw new Error("Wompi public key not configured");
  }
  if (!orderRef || !amountCents || !redirectUrl) {
    throw new Error("orderRef, amountCents, and redirectUrl are required");
  }

  const baseUrl = "https://checkout.wompi.co/p/";
  const params = new URLSearchParams({
    "public-key": publicKey,
    currency: "COP",
    "amount-in-cents": String(Math.round(amountCents)),
    reference: orderRef,
    "redirect-url": redirectUrl
  });

  return {
    url: `${baseUrl}?${params.toString()}`,
    reference: orderRef
  };
}

/**
 * Generates a Bold payment link via the Bold API.
 *
 * @param {string} orderRef - Unique payment reference
 * @param {number} amount - Amount in COP (whole number)
 * @param {string} description - Payment description
 * @param {string} apiKey - Bold API key
 * @returns {Promise<{ url: string, reference: string }>}
 */
export async function createBoldLink(orderRef, amount, description, apiKey) {
  if (!apiKey) {
    throw new Error("Bold API key not configured");
  }
  if (!orderRef || !amount) {
    throw new Error("orderRef and amount are required");
  }

  const response = await fetch("https://api.bold.co/v2/payment-links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      amount: Math.round(amount),
      currency: "COP",
      description: description || `Pago orden ${orderRef}`,
      reference: orderRef,
      single_use: true
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Bold API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  return {
    url: data.url || data.payment_link || data.data?.url,
    reference: orderRef
  };
}

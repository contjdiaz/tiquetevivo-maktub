/**
 * Create Payment Intent for TiqueteVivo.
 * Generates a checkout URL for a given order via the configured gateway (Wompi or Bold).
 *
 * POST /api/create-payment-intent
 * Body: { order_id, gateway }
 *
 * Flow:
 * 1. Fetch order, validate balance > 0
 * 2. Generate payment reference (business slug + order number + timestamp)
 * 3. Call gateway-specific checkout creation (Wompi or Bold)
 * 4. Return { checkout_url, payment_reference, amount, gateway }
 *
 * Requirements: 4
 */

import { json, parseBody, supabaseAdmin, slugify } from "./_utils.js";
import { createWompiCheckout, createBoldLink } from "./_payments.js";

/**
 * Generates a unique payment reference string.
 * Format: {businessSlug}-{orderNumber}-{timestamp}
 *
 * @param {string} businessSlug - The business slug identifier
 * @param {string|number} orderNumber - The order number
 * @returns {string} Unique payment reference
 */
function generatePaymentReference(businessSlug, orderNumber) {
  const ts = Date.now();
  const slug = businessSlug || "biz";
  const num = orderNumber || "0";
  return `${slug}-${num}-${ts}`;
}

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return json(200, {});

  // Only accept POST
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = parseBody(event);
    const { order_id, gateway } = body;

    // Validate required fields
    if (!order_id) {
      return json(400, { error: "order_id is required" });
    }

    // Determine gateway: from body, env var, or default
    const selectedGateway = (gateway || process.env.PAYMENTS_GATEWAY || "WOMPI").toUpperCase();

    if (selectedGateway !== "WOMPI" && selectedGateway !== "BOLD") {
      return json(400, { error: "Invalid gateway. Must be WOMPI or BOLD" });
    }

    // Check if payments are disabled
    if (process.env.PAYMENTS_GATEWAY === "disabled") {
      return json(400, { error: "Payments are currently disabled" });
    }

    // Initialize Supabase
    const supabase = supabaseAdmin();

    // Fetch the order with business info
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, business_id, order_number, total, paid, status, customer_name, customer_phone")
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      return json(404, { error: "Order not found" });
    }

    // Calculate balance
    const total = Number(order.total || 0);
    const paid = Number(order.paid || 0);
    const balance = Math.max(0, total - paid);

    // Validate balance > 0
    if (balance <= 0) {
      return json(400, { error: "Order has no pending balance" });
    }

    // Fetch business for slug and name
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, slug, name")
      .eq("id", order.business_id)
      .single();

    if (businessError || !business) {
      return json(404, { error: "Business not found" });
    }

    // Generate unique payment reference
    const paymentReference = generatePaymentReference(business.slug, order.order_number);

    // Amount in COP (whole number for Bold, cents for Wompi)
    const amountCOP = balance;
    const amountCents = Math.round(balance * 100);

    // Build redirect URL (back to the ticket page)
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || "https://tiquetevivo.com";
    const redirectUrl = `${siteUrl}/tiquete.html?order=${order_id}&payment=complete`;

    let checkoutUrl;

    if (selectedGateway === "WOMPI") {
      const publicKey = process.env.WOMPI_PUBLIC_KEY;
      if (!publicKey) {
        return json(502, { error: "Wompi gateway not configured" });
      }

      const result = createWompiCheckout(paymentReference, amountCents, redirectUrl, publicKey);
      checkoutUrl = result.url;
    } else {
      // BOLD
      const apiKey = process.env.BOLD_API_KEY;
      if (!apiKey) {
        return json(502, { error: "Bold gateway not configured" });
      }

      const description = `Pago orden #${order.order_number || order_id} - ${business.name}`;
      try {
        const result = await createBoldLink(paymentReference, amountCOP, description, apiKey);
        checkoutUrl = result.url;
      } catch (boldError) {
        console.error("[create-payment-intent] Bold API error:", boldError.message);
        return json(502, { error: "Gateway unavailable, try again" });
      }
    }

    if (!checkoutUrl) {
      return json(502, { error: "Gateway unavailable, try again" });
    }

    // Return checkout details
    return json(200, {
      checkout_url: checkoutUrl,
      payment_reference: paymentReference,
      amount: amountCOP,
      gateway: selectedGateway
    });
  } catch (error) {
    console.error("[create-payment-intent] Unexpected error:", error);
    return json(500, { error: "Internal server error" });
  }
};

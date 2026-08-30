/**
 * Payment Validation for TiqueteVivo.
 * Validates order payment eligibility and serves the dynamic payment page.
 *
 * GET /api/validate-payment?order_id=uuid&token=uuid
 * Response 200: { order: { order_number, items_text, total, paid, balance, status, business_name }, cancelled, paid_in_full, valid: true }
 * Response 404: { error: "not_found" }
 *
 * POST /api/validate-payment
 * Body: { action: "create-intent", order_id: uuid, token: uuid }
 * (Implemented in task 6.2)
 *
 * Rate limited: 20 req/IP/min for GET, 5 req/IP/min for POST
 * No authentication: secured by ticket_token UUID
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 11.2
 */

import { json, getClientIp, supabaseAdmin } from "./_utils.js";
import { checkRateLimit } from "./_rate-limiter.js";

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return json(200, {});

  // Only accept GET and POST
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // Extract client IP — reject if not determinable
  const clientIp = getClientIp(event);
  if (!clientIp || clientIp === "unknown") {
    return json(400, { error: "ip_required" });
  }

  // Rate limiting: 20/IP/min for GET
  if (event.httpMethod === "GET") {
    const rateLimitKey = `${clientIp}:validate-payment`;
    const rateResult = checkRateLimit(rateLimitKey, 20, 60000);

    if (!rateResult.allowed) {
      return {
        statusCode: 429,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Content-Type": "application/json",
          "Retry-After": String(rateResult.retryAfter)
        },
        body: JSON.stringify({ error: "rate_limited" })
      };
    }

    return handleGet(event);
  }

  // POST handler placeholder (task 6.2)
  return json(405, { error: "Method not allowed" });
};

/**
 * GET handler: validates order by id + ticket_token and returns order data.
 */
async function handleGet(event) {
  try {
    const params = event.queryStringParameters || {};
    const orderId = params.order_id;
    const token = params.token;

    // Validate required parameters
    if (!orderId || !token) {
      return json(404, { error: "not_found" });
    }

    const supabase = supabaseAdmin();

    // Fetch order by id and verify ticket_token via Supabase query
    // Using direct UUID match in the query — Supabase handles the comparison
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, order_number, items_text, total, paid, status, business_id, ticket_token")
      .eq("id", orderId)
      .eq("ticket_token", token)
      .single();

    // Return 404 if not found or token mismatch (indistinguishable)
    if (orderError || !order) {
      return json(404, { error: "not_found" });
    }

    // Fetch business name
    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", order.business_id)
      .single();

    const businessName = business?.name || "";

    // Compute balance server-side
    const total = Number(order.total || 0);
    const paid = Number(order.paid || 0);
    const balance = Math.max(0, total - paid);

    // Determine status indicators
    const cancelled = order.status === "CANCELLED";
    const paidInFull = balance === 0;

    return json(200, {
      order: {
        order_number: order.order_number,
        items_text: order.items_text,
        total,
        paid,
        balance,
        status: order.status,
        business_name: businessName
      },
      cancelled,
      paid_in_full: paidInFull,
      valid: true
    });
  } catch (error) {
    console.error("[validate-payment] Unexpected error:", error);
    return json(500, { error: "Internal server error" });
  }
}

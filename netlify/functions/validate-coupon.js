/**
 * Coupon Validation and Redemption for TiqueteVivo.
 *
 * GET  /api/validate-coupon?code=ABC123
 *   — Returns coupon details if valid (not expired, not used).
 *
 * POST /api/redeem-coupon
 *   — Body: { code, order_id }
 *   — Marks coupon as used, links to order, updates reactivation_log status to CONVERTED.
 *
 * Requirements: 10
 */

import { json, parseBody, supabaseAdmin, getClientIp } from "./_utils.js";
import { checkRateLimit } from "./_rate-limiter.js";

/**
 * Fetches a coupon by its code.
 * @param {object} supabase - Supabase client
 * @param {string} code - Coupon code (case-insensitive lookup)
 * @returns {Promise<object|null>} The coupon row or null
 */
async function getCouponByCode(supabase, code) {
  const { data, error } = await supabase
    .from("coupons")
    .select("id, business_id, code, type, value, expires_at, used_at, used_by_order_id, created_at")
    .eq("code", code.toUpperCase().trim())
    .maybeSingle();

  if (error) {
    console.error("[validate-coupon] Error fetching coupon:", error.message);
    return null;
  }
  return data;
}

/**
 * Validates that a coupon is usable (exists, not expired, not already used).
 * @param {object|null} coupon - The coupon record
 * @returns {{ valid: boolean, error?: string }}
 */
function validateCoupon(coupon) {
  if (!coupon) {
    return { valid: false, error: "Coupon not found" };
  }

  if (coupon.used_at) {
    return { valid: false, error: "Coupon already redeemed" };
  }

  const now = new Date();
  const expiresAt = new Date(coupon.expires_at);
  if (expiresAt <= now) {
    return { valid: false, error: "Coupon expired" };
  }

  return { valid: true };
}

/**
 * Handles GET /api/validate-coupon?code=ABC123
 * Returns coupon details if valid.
 */
async function handleValidate(event) {
  const params = event.queryStringParameters || {};
  const code = params.code;

  if (!code) {
    return json(400, { error: "code query parameter is required" });
  }

  const supabase = supabaseAdmin();
  const coupon = await getCouponByCode(supabase, code);
  const validation = validateCoupon(coupon);

  if (!validation.valid) {
    return json(400, { valid: false, error: validation.error });
  }

  // Return coupon details (without internal IDs)
  return json(200, {
    valid: true,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: Number(coupon.value),
      expires_at: coupon.expires_at,
      business_id: coupon.business_id
    }
  });
}

/**
 * Handles POST /api/redeem-coupon
 * Body: { code, order_id }
 * Marks coupon as used, links to order, updates reactivation_log status to CONVERTED.
 */
async function handleRedeem(event) {
  const body = parseBody(event);
  const { code, order_id } = body;

  if (!code) {
    return json(400, { error: "code is required" });
  }
  if (!order_id) {
    return json(400, { error: "order_id is required" });
  }

  const supabase = supabaseAdmin();

  // Fetch and validate coupon
  const coupon = await getCouponByCode(supabase, code);
  const validation = validateCoupon(coupon);

  if (!validation.valid) {
    return json(400, { redeemed: false, error: validation.error });
  }

  // Verify the order exists
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", order_id)
    .maybeSingle();

  if (orderError || !order) {
    return json(404, { redeemed: false, error: "Order not found" });
  }

  // Mark coupon as used
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("coupons")
    .update({
      used_at: now,
      used_by_order_id: order_id
    })
    .eq("id", coupon.id)
    .is("used_at", null); // Additional single-use guard: only update if still unused

  if (updateError) {
    console.error("[validate-coupon] Error redeeming coupon:", updateError.message);
    return json(500, { redeemed: false, error: "Failed to redeem coupon" });
  }

  // Update reactivation_log: set status to CONVERTED and link the order
  const { error: logError } = await supabase
    .from("reactivation_log")
    .update({
      status: "CONVERTED",
      converted_order_id: order_id
    })
    .eq("coupon_id", coupon.id);

  if (logError) {
    // Log but don't fail — coupon is already redeemed successfully
    console.warn("[validate-coupon] Failed to update reactivation_log:", logError.message);
  }

  return json(200, {
    redeemed: true,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: Number(coupon.value)
    },
    order_id
  });
}

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return json(200, {});

  // Rate limiting: 20 requests per minute per IP
  const clientIp = getClientIp(event);
  const rateResult = checkRateLimit(`${clientIp}:validate-coupon`, 20, 60000);
  if (!rateResult.allowed) {
    return {
      statusCode: 429,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Retry-After": String(rateResult.retryAfter)
      },
      body: JSON.stringify({ error: "Too many requests" })
    };
  }

  const path = event.path || "";

  try {
    // Route: GET /api/validate-coupon
    if (event.httpMethod === "GET" && path.includes("validate-coupon")) {
      return await handleValidate(event);
    }

    // Route: POST /api/redeem-coupon
    if (event.httpMethod === "POST" && path.includes("redeem-coupon")) {
      return await handleRedeem(event);
    }

    // POST to validate-coupon path also triggers redemption (alternative routing)
    if (event.httpMethod === "POST" && path.includes("validate-coupon")) {
      return await handleRedeem(event);
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("[validate-coupon] Unexpected error:", error);
    return json(500, { error: "Internal server error" });
  }
};

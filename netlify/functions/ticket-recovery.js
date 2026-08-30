import { getClientIp, json, parseBody, supabaseAdmin, getBusinessBySlug } from "./_utils.js";
import { validatePhone } from "./_validators.js";
import { checkRateLimit } from "./_rate-limiter.js";
import { generateOTP, storeOTP, verifyOTP, checkOTPRateLimit } from "./_otp.js";
import { sendWhatsAppMessage } from "./_whatsapp.js";

/**
 * Strips sensitive fields from order objects for public ticket recovery responses.
 * Removes internal_notes, customer_name, customer_phone, and notes.
 */
function stripSensitiveFields(order) {
  if (!order) return order;
  const {
    customer_name,
    customer_phone,
    internal_notes,
    notes,
    ...safeOrder
  } = order;
  return safeOrder;
}

/**
 * POST /.netlify/functions/ticket-recovery
 *
 * Action: request-otp
 * Body: { action: "request-otp", phone: string, slug: string }
 * Response 200: { message: "verification_sent" }
 *
 * Action: verify-otp
 * Body: { action: "verify-otp", phone: string, slug: string, code: string }
 * Response 200: { orders: Order[] }
 * Response 400: { error: "invalid_code", remaining_attempts: number }
 * Response 400: { error: "code_locked" }
 * Response 400: { error: "code_expired" }
 */
export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return json(200, {});

  // Method validation: POST only
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // IP extraction and validation (Requirement 11.7)
  const clientIp = getClientIp(event);
  if (!clientIp || clientIp === "unknown") {
    return json(400, { error: "ip_required" });
  }

  // Rate limiting: 10 requests per IP per minute (Requirement 11.1)
  const rateLimitKey = `${clientIp}:ticket-recovery`;
  const rateResult = checkRateLimit(rateLimitKey, 10, 60000);
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

  try {
    const body = parseBody(event);
    const action = body.action;

    if (!action || !["request-otp", "verify-otp"].includes(action)) {
      return json(400, { error: "invalid_action", detail: "action must be 'request-otp' or 'verify-otp'" });
    }

    // Validate phone with validatePhone() (Requirement 1.2)
    const phoneResult = validatePhone(body.phone);
    if (!phoneResult.valid) {
      return json(400, { error: "invalid_phone", detail: phoneResult.error });
    }
    const phone = phoneResult.value;

    const slug = body.slug;
    if (!slug || typeof slug !== "string" || slug.trim() === "") {
      return json(400, { error: "invalid_slug", detail: "slug is required" });
    }

    const supabase = supabaseAdmin();

    if (action === "request-otp") {
      return await handleRequestOTP(supabase, { phone, slug });
    }

    if (action === "verify-otp") {
      const code = body.code;
      if (!code || typeof code !== "string" || code.trim() === "") {
        return json(400, { error: "invalid_code", detail: "code is required" });
      }
      return await handleVerifyOTP(supabase, { phone, slug, code: code.trim() });
    }
  } catch (error) {
    return json(500, { error: error.message });
  }
};

/**
 * Handles the "request-otp" action.
 * Looks up business, checks OTP rate limit, generates and sends OTP.
 * Always returns "verification_sent" to prevent enumeration (Requirements 1.3, 1.7).
 */
async function handleRequestOTP(supabase, { phone, slug }) {
  // Look up business by slug — if not found, still return success (anti-enumeration)
  let business;
  try {
    business = await getBusinessBySlug(supabase, slug);
  } catch {
    // Business not found — return generic success to prevent enumeration
    return json(200, { message: "verification_sent" });
  }

  // Check if phone has any orders for this business — if not, still return success
  const { count: orderCount } = await supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("business_id", business.id)
    .eq("customer_phone", phone);

  if (!orderCount || orderCount === 0) {
    return json(200, { message: "verification_sent" });
  }

  // Check OTP rate limit: 3 requests per phone per 15 minutes (Requirement 2.7)
  const otpRateLimit = await checkOTPRateLimit(supabase, phone, business.id);
  if (!otpRateLimit.allowed) {
    return {
      statusCode: 429,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json",
        "Retry-After": "900"
      },
      body: JSON.stringify({ error: "otp_rate_limit", retry_after: 900 })
    };
  }

  // Generate OTP code
  const code = generateOTP();

  // Store OTP in database
  const storeResult = await storeOTP(supabase, { phone, businessId: business.id, code });
  if (!storeResult.success) {
    return json(500, { error: "verification_failed" });
  }

  // Send OTP via WhatsApp
  const sendResult = await sendWhatsAppMessage({
    to: phone,
    text: `Tu código de verificación es: ${code}. Válido por 5 minutos.`
  });

  if (!sendResult.success && !sendResult.dryRun) {
    return json(500, { error: "verification_failed" });
  }

  return json(200, { message: "verification_sent" });
}

/**
 * Handles the "verify-otp" action.
 * Verifies OTP code and returns active orders on success (Requirements 2.3, 3.1-3.7).
 */
async function handleVerifyOTP(supabase, { phone, slug, code }) {
  // Look up business by slug
  let business;
  try {
    business = await getBusinessBySlug(supabase, slug);
  } catch {
    // Business not found — return generic error
    return json(400, { error: "invalid_code", remaining_attempts: 0 });
  }

  // Verify OTP code
  const verifyResult = await verifyOTP(supabase, { phone, businessId: business.id, code });

  if (!verifyResult.valid) {
    if (verifyResult.expired) {
      return json(400, { error: "code_expired" });
    }
    if (verifyResult.locked) {
      return json(400, { error: "code_locked" });
    }
    if (verifyResult.remainingAttempts !== undefined) {
      return json(400, { error: "invalid_code", remaining_attempts: verifyResult.remainingAttempts });
    }
    return json(400, { error: "invalid_code", remaining_attempts: 0 });
  }

  // OTP valid — fetch active orders for this phone+business
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("*")
    .eq("business_id", business.id)
    .eq("customer_phone", phone)
    .not("status", "in", '("DELIVERED","CANCELLED")')
    .order("created_at", { ascending: false })
    .limit(50);

  if (ordersError) {
    return json(500, { error: "orders_fetch_failed" });
  }

  // Strip sensitive fields from each order (Requirement 3.4)
  const safeOrders = (orders || []).map(stripSensitiveFields);

  return json(200, { orders: safeOrders });
}

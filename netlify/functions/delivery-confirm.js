/**
 * Delivery Confirmation for TiqueteVivo.
 * Handles the simplified delivery flow:
 *
 * GET  /api/delivery-confirm?order_id=uuid&token=uuid
 *   → Validates delivery token and returns order info for delivery personnel
 *   → 404: not found/mismatch, 403: expired, 200: valid or already_delivered
 *
 * POST /api/delivery-confirm
 *   action: "confirm"    → Validate photo, upload, update order status, mark token used
 *   action: "generate-token" → (Authenticated) Generate a new delivery token for an order
 *
 * Rate limited: 15 req/IP/min
 * No auth required for GET and "confirm"; auth required for "generate-token"
 *
 * Requirements: 7.1–7.7, 8.1–8.9, 9.1–9.8, 11.3, 11.5
 */

import crypto from "crypto";
import { json, parseBody, getClientIp, supabaseAdmin, requireAuth } from "./_utils.js";
import { checkRateLimit } from "./_rate-limiter.js";
import { validatePhoto, uploadPhoto } from "./_photo-storage.js";

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") return json(200, {});

  // Only accept GET and POST
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // Extract client IP — reject if not determinable (Req 11.7)
  const clientIp = getClientIp(event);
  if (!clientIp || clientIp === "unknown") {
    return json(400, { error: "ip_required" });
  }

  // Rate limiting: 15/IP/min (Req 11.3)
  const rateLimitKey = `${clientIp}:delivery-confirm`;
  const rateResult = checkRateLimit(rateLimitKey, 15, 60000);

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

  if (event.httpMethod === "GET") {
    return handleGetValidation(event);
  }

  // POST — route by action
  return handlePost(event);
};

/**
 * GET handler: Validates delivery token and returns order info.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.5
 */
async function handleGetValidation(event) {
  try {
    const params = event.queryStringParameters || {};
    const orderId = params.order_id;
    const token = params.token;

    // Validate required params
    if (!orderId || !token) {
      return json(404, { error: "not_found" });
    }

    const supabase = supabaseAdmin();

    // Fetch delivery token by order_id (then compare token in app for constant-time)
    const { data: tokenRow, error: tokenError } = await supabase
      .from("delivery_tokens")
      .select("*")
      .eq("order_id", orderId)
      .is("invalidated_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Not found
    if (tokenError || !tokenRow) {
      return json(404, { error: "not_found" });
    }

    // Constant-time token comparison (Req 11.5)
    const tokenMatch = safeCompareUUIDs(token, tokenRow.token);
    if (!tokenMatch) {
      return json(404, { error: "not_found" });
    }

    // Check if expired (Req 7.6)
    if (new Date(tokenRow.expires_at) < new Date()) {
      return json(403, { error: "expired", message: "Este enlace de entrega ha expirado." });
    }

    // Check if already used (Req 7.7)
    if (tokenRow.used_at) {
      return json(200, { already_delivered: true });
    }

    // Fetch order data
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, customer_name, custom_fields, total, paid, status")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return json(404, { error: "not_found" });
    }

    // Extract delivery address from custom_fields (Req 7.4)
    const cf = order.custom_fields || {};
    const deliveryAddress = cf.direccion || cf.delivery_address || cf.address || cf.direccion_entrega || "Dirección no disponible";

    // Compute balance
    const balance = Math.max(0, Number(order.total || 0) - Number(order.paid || 0));

    return json(200, {
      order: {
        customer_name: order.customer_name || "—",
        delivery_address: deliveryAddress,
        balance
      }
    });
  } catch (error) {
    console.error("[delivery-confirm] GET error:", error);
    return json(500, { error: "Internal server error" });
  }
}

/**
 * POST handler: routes to confirm or generate-token actions.
 */
async function handlePost(event) {
  try {
    const body = parseBody(event);
    const action = body.action;

    if (action === "confirm") {
      return handleConfirm(event, body);
    }

    if (action === "generate-token") {
      return handleGenerateToken(event, body);
    }

    return json(400, { error: "invalid_action" });
  } catch (error) {
    console.error("[delivery-confirm] POST error:", error);
    return json(500, { error: "Internal server error" });
  }
}

/**
 * POST action: "confirm" — Confirm delivery with photo.
 * Requirements: 8.1–8.9
 */
async function handleConfirm(event, body) {
  const { order_id: orderId, token, photo } = body;

  if (!orderId || !token) {
    return json(404, { error: "not_found" });
  }

  const supabase = supabaseAdmin();

  // Re-validate token (not expired, not used)
  const { data: tokenRow, error: tokenError } = await supabase
    .from("delivery_tokens")
    .select("*")
    .eq("order_id", orderId)
    .is("invalidated_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (tokenError || !tokenRow) {
    return json(404, { error: "not_found" });
  }

  // Constant-time comparison
  if (!safeCompareUUIDs(token, tokenRow.token)) {
    return json(404, { error: "not_found" });
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return json(403, { error: "expired" });
  }

  if (tokenRow.used_at) {
    return json(200, { already_delivered: true });
  }

  // Validate photo (Req 8.2)
  const photoValidation = validatePhoto(photo);
  if (!photoValidation.valid) {
    return json(400, { error: "invalid_photo", detail: photoValidation.error });
  }

  // Determine file extension from MIME type
  const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
  const ext = extMap[photoValidation.mimeType] || "jpg";
  const storagePath = `${tokenRow.business_id}/${orderId}/delivery.${ext}`;

  // Upload photo (Req 8.4)
  let uploadResult;
  try {
    uploadResult = await uploadPhoto(supabase, photo, storagePath);
  } catch (uploadErr) {
    console.error("[delivery-confirm] Photo upload failed:", uploadErr.message);
    return json(500, { error: "upload_failed", message: "No se pudo subir la foto. Intenta de nuevo." });
  }

  // Fetch business config to get final status (last entry in status_flow_config)
  const { data: business } = await supabase
    .from("businesses")
    .select("status_flow_config")
    .eq("id", tokenRow.business_id)
    .single();

  const statusFlow = business?.status_flow_config || [];
  const finalStatus = statusFlow.length > 0
    ? statusFlow[statusFlow.length - 1].status_key
    : "DELIVERED";

  // Update order: status, delivery photo info (Req 8.5)
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: finalStatus,
      delivery_photo_url: uploadResult.path,
      delivery_photo_taken_at: now
    })
    .eq("id", orderId);

  if (updateError) {
    console.error("[delivery-confirm] Order update failed:", updateError);
    return json(500, { error: "update_failed", message: "No se pudo confirmar la entrega. Intenta de nuevo." });
  }

  // Mark token as used (Req 9.4)
  await supabase
    .from("delivery_tokens")
    .update({ used_at: now })
    .eq("id", tokenRow.id);

  return json(200, { success: true, status: finalStatus });
}

/**
 * POST action: "generate-token" — Generate a new delivery token (authenticated).
 * Requirements: 9.1, 9.2, 9.3, 9.7, 9.8
 */
async function handleGenerateToken(event, body) {
  const { order_id: orderId, business_id: businessId } = body;

  if (!orderId || !businessId) {
    return json(400, { error: "order_id and business_id are required" });
  }

  const supabase = supabaseAdmin();

  // Require authentication with update_order permission (Req 9.1)
  const authResult = await requireAuth(supabase, event, {
    permission: "update_order",
    businessId
  });
  if (authResult.error) return authResult.error;

  // Validate order exists and status is not DELIVERED/CANCELLED (Req 9.8)
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, customer_name, custom_fields, total, paid")
    .eq("id", orderId)
    .eq("business_id", businessId)
    .single();

  if (orderError || !order) {
    return json(404, { error: "not_found", message: "Pedido no encontrado" });
  }

  // Check status eligibility
  if (order.status === "DELIVERED" || order.status === "CANCELLED") {
    return json(400, { error: "not_eligible", message: "Esta orden no es elegible para entrega." });
  }

  // Also check if the final status in the business flow matches current status
  const { data: business } = await supabase
    .from("businesses")
    .select("status_flow_config")
    .eq("id", businessId)
    .single();

  const statusFlow = business?.status_flow_config || [];
  const finalStatus = statusFlow.length > 0 ? statusFlow[statusFlow.length - 1].status_key : "DELIVERED";
  if (order.status === finalStatus) {
    return json(400, { error: "not_eligible", message: "Esta orden ya fue entregada." });
  }

  // Invalidate previous active tokens for same order_id (Req 9.7)
  const now = new Date().toISOString();
  await supabase
    .from("delivery_tokens")
    .update({ invalidated_at: now })
    .eq("order_id", orderId)
    .is("used_at", null)
    .is("invalidated_at", null);

  // Generate new token (Req 9.1, 9.2)
  const newToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours

  const { error: insertError } = await supabase
    .from("delivery_tokens")
    .insert({
      token: newToken,
      order_id: orderId,
      business_id: businessId,
      expires_at: expiresAt,
      created_by: authResult.user.id
    });

  if (insertError) {
    console.error("[delivery-confirm] Token insert failed:", insertError);
    return json(500, { error: "Internal server error" });
  }

  // Build delivery URL (Req 9.3)
  const siteUrl = process.env.URL || process.env.SITE_URL || "https://tiquetevivo.com";
  const deliveryUrl = `${siteUrl}/entrega.html?order_id=${orderId}&token=${newToken}`;

  return json(200, {
    delivery_url: deliveryUrl,
    token: newToken,
    expires_at: expiresAt
  });
}

/**
 * Constant-time UUID comparison to prevent timing attacks (Req 11.5).
 * Compares two UUID strings using crypto.timingSafeEqual.
 */
function safeCompareUUIDs(a, b) {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(String(a), "utf8");
    const bufB = Buffer.from(String(b), "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

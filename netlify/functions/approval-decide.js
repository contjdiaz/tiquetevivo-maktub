/**
 * Approval flow for TiqueteVivo.
 * Lets a business request a quote approval and lets the customer approve/reject
 * it from a public, token-secured link (WhatsApp / ticket).
 *
 * GET  /api/approval-decide?id=<approval_id>&token=<uuid>
 *   → Validates the token and returns the quote for display.
 *   → 404 not found/mismatch, 403 expired, 200 valid or already decided.
 *
 * POST /api/approval-decide
 *   action: "decide"   → { id, token, decision: "approve"|"reject" } (public)
 *   action: "generate" → { order_id, business_id, amount, description } (authenticated)
 *
 * Rate limited: 30 req/IP/min. Public paths secured by the approval token UUID.
 */

import crypto from "crypto";
import { json, parseBody, getClientIp, supabaseAdmin, requireAuth } from "./_utils.js";
import { checkRateLimit } from "./_rate-limiter.js";
import { selectTemplate, renderTemplate } from "./_template-engine.js";
import { sendWhatsAppMessage, logWhatsAppMessage } from "./_whatsapp.js";

const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const clientIp = getClientIp(event);
  if (!clientIp || clientIp === "unknown") {
    return json(400, { error: "ip_required" });
  }

  const rate = checkRateLimit(`${clientIp}:approval-decide`, 30, 60000);
  if (!rate.allowed) {
    return {
      statusCode: 429,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Content-Type": "application/json",
        "Retry-After": String(rate.retryAfter)
      },
      body: JSON.stringify({ error: "rate_limited" })
    };
  }

  if (event.httpMethod === "GET") return handleGet(event);
  return handlePost(event);
};

/** GET: validate token and return the quote for display. */
async function handleGet(event) {
  try {
    const params = event.queryStringParameters || {};
    const { id, token } = params;
    if (!id || !token) return json(404, { error: "not_found" });

    const supabase = supabaseAdmin();
    const { data: req, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !req) return json(404, { error: "not_found" });
    if (!safeCompareUUIDs(token, req.token)) return json(404, { error: "not_found" });

    if (req.status !== "PENDING") {
      return json(200, { already_decided: true, status: req.status });
    }
    if (new Date(req.expires_at) < new Date()) {
      return json(403, { error: "expired" });
    }

    // Business name for display.
    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", req.business_id)
      .single();

    return json(200, {
      approval: {
        id: req.id,
        amount: Number(req.amount),
        description: req.description || "",
        status: req.status,
        business_name: business?.name || ""
      }
    });
  } catch (err) {
    console.error("[approval-decide] GET error:", err.message);
    return json(500, { error: "Internal server error" });
  }
}

/** POST router. */
async function handlePost(event) {
  try {
    const body = parseBody(event);
    if (body.action === "decide") return handleDecide(event, body);
    if (body.action === "generate") return handleGenerate(event, body);
    return json(400, { error: "invalid_action" });
  } catch (err) {
    console.error("[approval-decide] POST error:", err.message);
    return json(500, { error: "Internal server error" });
  }
}

/** POST decide (public): approve/reject a pending request. Idempotent. */
async function handleDecide(event, body) {
  const { id, token, decision } = body;
  if (!id || !token) return json(404, { error: "not_found" });
  if (decision !== "approve" && decision !== "reject") {
    return json(400, { error: "invalid_decision" });
  }

  const supabase = supabaseAdmin();
  const { data: req, error } = await supabase
    .from("approval_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !req) return json(404, { error: "not_found" });
  if (!safeCompareUUIDs(token, req.token)) return json(404, { error: "not_found" });

  // Idempotency: if already decided, return the existing decision unchanged.
  if (req.status !== "PENDING") {
    return json(200, { success: true, status: req.status, idempotent: true });
  }
  if (new Date(req.expires_at) < new Date()) {
    return json(403, { error: "expired" });
  }

  const newStatus = decision === "approve" ? "APPROVED" : "REJECTED";
  const now = new Date().toISOString();

  // Guarded update: only transition from PENDING (prevents double-decide races).
  const { data: updated, error: updErr } = await supabase
    .from("approval_requests")
    .update({ status: newStatus, decided_at: now, decided_ip: getClientIp(event) })
    .eq("id", req.id)
    .eq("status", "PENDING")
    .select()
    .single();

  if (updErr || !updated) {
    // Lost the race — re-read and return current status idempotently.
    const { data: fresh } = await supabase
      .from("approval_requests")
      .select("status")
      .eq("id", req.id)
      .single();
    return json(200, { success: true, status: fresh?.status || newStatus, idempotent: true });
  }

  // Notify the business's customer of the decision (best-effort).
  await notifyDecision(supabase, req, newStatus);

  return json(200, { success: true, status: newStatus });
}

/** POST generate (authenticated): create an approval request + send WhatsApp. */
async function handleGenerate(event, body) {
  const { order_id: orderId, business_id: businessId, amount, description } = body;
  if (!orderId || !businessId) {
    return json(400, { error: "order_id and business_id are required" });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) {
    return json(400, { error: "invalid_amount" });
  }

  const supabase = supabaseAdmin();
  const authResult = await requireAuth(supabase, event, {
    permission: "update_order",
    businessId
  });
  if (authResult.error) return authResult.error;

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, customer_name, customer_phone, order_number, status")
    .eq("id", orderId)
    .eq("business_id", businessId)
    .single();

  if (orderErr || !order) return json(404, { error: "not_found" });

  // Invalidate previous pending requests for the same order.
  const now = new Date().toISOString();
  await supabase
    .from("approval_requests")
    .update({ invalidated_at: now, status: "EXPIRED" })
    .eq("order_id", orderId)
    .eq("status", "PENDING");

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();

  const { data: created, error: insErr } = await supabase
    .from("approval_requests")
    .insert({
      order_id: orderId,
      business_id: businessId,
      amount: amt,
      description: description || null,
      token,
      expires_at: expiresAt,
      created_by: authResult.user.id
    })
    .select()
    .single();

  if (insErr) {
    console.error("[approval-decide] insert failed:", insErr.message);
    return json(500, { error: "Internal server error" });
  }

  const siteUrl = process.env.URL || process.env.SITE_URL || "https://tiquetevivo.com";
  const approvalLink = `${siteUrl}/aprobar.html?id=${created.id}&token=${token}`;

  // Send WhatsApp with the approval link (best-effort).
  try {
    const { data: business } = await supabase
      .from("businesses")
      .select("name, whatsapp_templates_config")
      .eq("id", businessId)
      .single();

    const template = selectTemplate("approval_requested", business?.whatsapp_templates_config || null, null);
    const messageText = renderTemplate(template, {
      customer_name: order.customer_name,
      order_number: order.order_number,
      approval_amount: amt,
      approval_description: description || "",
      approval_link: approvalLink
    }, { name: business?.name || "" });

    const sendResult = await sendWhatsAppMessage({ to: order.customer_phone, text: messageText });
    await logWhatsAppMessage(supabase, {
      orderId,
      businessId,
      phone: order.customer_phone,
      templateName: "approval_requested",
      messageBody: messageText,
      metaMessageId: sendResult.messageId || null,
      status: sendResult.success ? "SENT" : (sendResult.dryRun ? "DRY_RUN" : "FAILED"),
      errorMessage: sendResult.success || sendResult.dryRun ? null : (sendResult.error || "Unknown")
    });
  } catch (waErr) {
    console.error("[approval-decide] WhatsApp error:", waErr.message);
  }

  return json(200, { approval_id: created.id, approval_link: approvalLink, token, expires_at: expiresAt });
}

/** Sends the decision confirmation WhatsApp to the customer (best-effort). */
async function notifyDecision(supabase, req, status) {
  try {
    const { data: order } = await supabase
      .from("orders")
      .select("customer_name, customer_phone, order_number")
      .eq("id", req.order_id)
      .single();
    if (!order) return;

    const { data: business } = await supabase
      .from("businesses")
      .select("name, whatsapp_templates_config")
      .eq("id", req.business_id)
      .single();

    const decisionLabel = status === "APPROVED" ? "Aprobada" : "Rechazada";
    const template = selectTemplate("approval_decided", business?.whatsapp_templates_config || null, null);
    const messageText = renderTemplate(template, {
      customer_name: order.customer_name,
      order_number: order.order_number,
      approval_decision: decisionLabel
    }, { name: business?.name || "" });

    const sendResult = await sendWhatsAppMessage({ to: order.customer_phone, text: messageText });
    await logWhatsAppMessage(supabase, {
      orderId: req.order_id,
      businessId: req.business_id,
      phone: order.customer_phone,
      templateName: "approval_decided",
      messageBody: messageText,
      metaMessageId: sendResult.messageId || null,
      status: sendResult.success ? "SENT" : (sendResult.dryRun ? "DRY_RUN" : "FAILED"),
      errorMessage: sendResult.success || sendResult.dryRun ? null : (sendResult.error || "Unknown")
    });
  } catch (err) {
    console.error("[approval-decide] notifyDecision error:", err.message);
  }
}

/** Constant-time UUID comparison (prevents timing attacks). */
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

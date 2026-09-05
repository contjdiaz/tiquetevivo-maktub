/**
 * GET /api/public-ticket?slug=<slug>&number=<order_number>
 *
 * Public, unauthenticated endpoint that returns a SINGLE order plus the
 * business public config, for the customer-facing ticket page (tiquete.html).
 *
 * Why this exists: list-orders (slug branch) requires authentication after the
 * security hardening phase. The customer ticket opens with slug+number and has
 * no JWT, so it needs a dedicated public path that returns only the requested
 * order and strips other customers' sensitive fields.
 *
 * Response shape mirrors list-orders?include_business=1:
 *   { orders: [order], business: {...public...}, loyalty }
 */
import { getBusinessBySlug, getClientIp, json, supabaseAdmin } from "./_utils.js";
import { getLoyaltySummary } from "./_loyalty.js";
import { checkRateLimit } from "./_rate-limiter.js";
import { getSignedPhotoUrl } from "./_photo-storage.js";

/** Replace stored photo paths with signed URLs (best-effort). */
async function signPhotos(supabase, order) {
  if (order.intake_photo_url) {
    try { order.intake_photo_url = await getSignedPhotoUrl(supabase, order.intake_photo_url); }
    catch (err) { console.error("[Photo] intake sign failed:", err.message); }
  }
  if (order.delivery_photo_url) {
    try { order.delivery_photo_url = await getSignedPhotoUrl(supabase, order.delivery_photo_url); }
    catch (err) { console.error("[Photo] delivery sign failed:", err.message); }
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const slug = event.queryStringParameters?.slug;
    const number = event.queryStringParameters?.number;

    if (!slug || !number) {
      return json(400, { error: "Missing required parameters: slug, number" });
    }

    // Rate limit public access: 60 requests/min per IP.
    const clientIp = getClientIp(event);
    const rate = checkRateLimit(`${clientIp}:public-ticket`, 60, 60000);
    if (!rate.allowed) {
      return {
        statusCode: 429,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Content-Type": "application/json",
          "Retry-After": String(rate.retryAfter)
        },
        body: JSON.stringify({ error: "Too many requests" })
      };
    }

    const supabase = supabaseAdmin();
    const business = await getBusinessBySlug(supabase, slug);
    if (!business) return json(404, { error: "Business not found" });

    // Fetch only the requested order for this business.
    const { data: order, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("business_id", business.id)
      .eq("order_number", number)
      .single();

    if (error || !order) {
      return json(404, { error: "Order not found" });
    }

    await signPhotos(supabase, order);

    // Vertical emoji
    let verticalEmoji = null;
    if (business.vertical_id) {
      const { data: vertical } = await supabase
        .from("verticals")
        .select("emoji")
        .eq("id", business.vertical_id)
        .single();
      if (vertical) verticalEmoji = vertical.emoji;
    }

    // Loyalty summary for this ticket's customer
    let loyalty = null;
    if (order.customer_phone && business.loyalty_config?.enabled !== false) {
      try {
        const result = await getLoyaltySummary(supabase, order.customer_phone, business.id);
        if (result.success) loyalty = result.summary;
      } catch (err) {
        console.error("[Loyalty] summary error:", err.message);
      }
    }

    // Pending approval (quote) for this order, if any — lets the ticket show
    // an Approve/Reject block inline. Best-effort: absent table => null.
    let approval = null;
    try {
      const { data: appr } = await supabase
        .from("approval_requests")
        .select("id, amount, description, status, token, expires_at")
        .eq("order_id", order.id)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (appr && new Date(appr.expires_at) > new Date()) {
        approval = {
          id: appr.id,
          amount: Number(appr.amount),
          description: appr.description || "",
          token: appr.token
        };
      }
    } catch {
      // No pending approval or table not present yet — ignore.
    }

    return json(200, {
      orders: [order],
      approval,
      business: {
        name: business.name,
        phone: business.phone,
        slug: business.slug,
        plan: business.plan || "free",
        status_flow_config: business.status_flow_config || [],
        custom_fields_config: business.custom_fields_config || [],
        loyalty_config: business.loyalty_config || { enabled: true, target: 5 },
        vertical_emoji: verticalEmoji,
        payment_config: business.payment_config || {}
      },
      loyalty
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

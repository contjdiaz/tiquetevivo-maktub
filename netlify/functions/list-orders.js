import { getBusinessBySlug, getClientIp, json, requireAuth, supabaseAdmin } from "./_utils.js";
import { getLoyaltySummary } from "./_loyalty.js";
import { checkRateLimit } from "./_rate-limiter.js";
import { getSignedPhotoUrl } from "./_photo-storage.js";

/**
 * Replaces storage paths in intake_photo_url and delivery_photo_url
 * with signed URLs (1h expiry) for an array of orders.
 * Only generates signed URLs for non-null/non-empty paths.
 */
async function replacePhotoUrlsWithSigned(supabase, orders) {
  for (const order of orders) {
    if (order.intake_photo_url) {
      try {
        order.intake_photo_url = await getSignedPhotoUrl(supabase, order.intake_photo_url);
      } catch (err) {
        console.error("[Photo] Failed to sign intake URL:", err.message);
      }
    }
    if (order.delivery_photo_url) {
      try {
        order.delivery_photo_url = await getSignedPhotoUrl(supabase, order.delivery_photo_url);
      } catch (err) {
        console.error("[Photo] Failed to sign delivery URL:", err.message);
      }
    }
  }
}

/**
 * Strips sensitive fields from an order for public ticket access.
 * Removes other customers' names, phone numbers, and internal notes.
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

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const supabase = supabaseAdmin();
    const ticketToken = event.queryStringParameters?.ticket_token;

    // --- Public Ticket Access Path ---
    if (ticketToken) {
      // Apply rate limit: 30 requests/min per IP for ticket access
      const clientIp = getClientIp(event);
      const rateLimitKey = `${clientIp}:list-orders-ticket`;
      const rateResult = checkRateLimit(rateLimitKey, 30, 60000);

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
          body: JSON.stringify({ error: "Too many requests" })
        };
      }

      // Query order by ticket_token
      const { data: order, error } = await supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("ticket_token", ticketToken)
        .single();

      if (error || !order) {
        return json(404, { error: "Order not found" });
      }

      // Strip sensitive fields for public access
      const safeOrder = stripSensitiveFields(order);

      // Replace storage paths with signed URLs
      await replacePhotoUrlsWithSigned(supabase, [safeOrder]);

      // When include_business=1 is passed, return business config alongside the order
      const includeBusiness = event.queryStringParameters?.include_business === "1";
      if (includeBusiness) {
        const { data: business } = await supabase
          .from("businesses")
          .select("*")
          .eq("id", order.business_id)
          .single();

        let verticalEmoji = null;
        if (business?.vertical_id) {
          const { data: vertical } = await supabase
            .from("verticals")
            .select("emoji, slug, name")
            .eq("id", business.vertical_id)
            .single();
          if (vertical) {
            verticalEmoji = vertical.emoji;
          }
        }

        // Loyalty summary for the ticket customer
        let loyalty = null;
        if (order.customer_phone && business?.loyalty_config?.enabled !== false) {
          try {
            const loyaltyResult = await getLoyaltySummary(supabase, order.customer_phone, business.id);
            if (loyaltyResult.success) {
              loyalty = loyaltyResult.summary;
            }
          } catch (err) {
            console.error("[Loyalty] getLoyaltySummary error:", err.message);
          }
        }

        return json(200, {
          orders: [safeOrder],
          business: business ? {
            name: business.name,
            phone: business.phone,
            slug: business.slug,
            plan: business.plan || "free",
            status_flow_config: business.status_flow_config || [],
            custom_fields_config: business.custom_fields_config || [],
            loyalty_config: business.loyalty_config || { enabled: true, target: 5 },
            vertical_emoji: verticalEmoji
          } : null,
          loyalty
        });
      }

      return json(200, { orders: [safeOrder] });
    }

    // --- Authenticated Access Path ---
    const slug = event.queryStringParameters?.slug || "majesty";
    const status = event.queryStringParameters?.status;
    const includeBusiness = event.queryStringParameters?.include_business === "1";
    const business = await getBusinessBySlug(supabase, slug);

    // Require authentication with read permission for the target business
    const authResult = await requireAuth(supabase, event, {
      permission: "read",
      businessId: business.id
    });

    if (authResult.error) {
      return authResult.error;
    }

    let query = supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(Number(event.queryStringParameters?.limit || 100));

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    // Replace storage paths with signed URLs for photo fields
    if (data && data.length > 0) {
      await replacePhotoUrlsWithSigned(supabase, data);
    }

    // When include_business=1 is passed, return business config alongside orders
    // This is used by the ticket page to render vertical-specific UI (status stepper, emoji, etc.)
    if (includeBusiness) {
      // Fetch vertical info for the emoji
      let verticalEmoji = null;
      if (business.vertical_id) {
        const { data: vertical } = await supabase
          .from("verticals")
          .select("emoji, slug, name")
          .eq("id", business.vertical_id)
          .single();
        if (vertical) {
          verticalEmoji = vertical.emoji;
        }
      }

      // Fetch loyalty summary for the requesting customer phone
      let loyalty = null;
      const customerPhone = event.queryStringParameters?.phone
        || (data && data.length > 0 ? data[0].customer_phone : null);

      if (customerPhone && business.loyalty_config?.enabled !== false) {
        try {
          const loyaltyResult = await getLoyaltySummary(supabase, customerPhone, business.id);
          if (loyaltyResult.success) {
            loyalty = loyaltyResult.summary;
          }
        } catch (err) {
          console.error("[Loyalty] getLoyaltySummary error:", err.message);
        }
      }

      return json(200, {
        orders: data || [],
        business: {
          name: business.name,
          phone: business.phone,
          slug: business.slug,
          plan: business.plan || "free",
          status_flow_config: business.status_flow_config || [],
          custom_fields_config: business.custom_fields_config || [],
          loyalty_config: business.loyalty_config || { enabled: true, target: 5 },
          vertical_emoji: verticalEmoji
        },
        loyalty
      });
    }

    // When include_loyalty=1 is passed (operator panel), include loyalty summaries per customer
    const includeLoyalty = event.queryStringParameters?.include_loyalty === "1";
    if (includeLoyalty && business.loyalty_config?.enabled !== false) {
      const uniquePhones = [...new Set((data || []).map(o => o.customer_phone).filter(Boolean))];
      const loyaltySummaries = {};
      for (const phone of uniquePhones) {
        try {
          const result = await getLoyaltySummary(supabase, phone, business.id);
          if (result.success) {
            loyaltySummaries[phone] = result.summary;
          }
        } catch (err) {
          console.error("[Loyalty] operator summary error:", err.message);
        }
      }
      return json(200, { orders: data || [], loyalty_summaries: loyaltySummaries });
    }

    return json(200, data || []);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

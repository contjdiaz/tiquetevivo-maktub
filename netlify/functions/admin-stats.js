import { json, supabaseAdmin } from "./_utils.js";
import { validateAdminToken } from "./_admin-auth.js";

/**
 * GET /api/admin-stats
 * 
 * Returns aggregated platform statistics for the admin dashboard.
 * Requires admin authentication.
 */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const auth = validateAdminToken(event);
  if (!auth.valid) return auth.error;

  try {
    const supabase = supabaseAdmin();

    // Count active businesses
    const { count: bizCount } = await supabase
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("active", true);

    // Count total orders
    const { count: orderCount } = await supabase
      .from("orders")
      .select("*", { count: "exact", head: true });

    // Sum revenue (total of all orders)
    const { data: revenueData } = await supabase
      .from("orders")
      .select("total");
    const revenue = (revenueData || []).reduce((sum, o) => sum + Number(o.total || 0), 0);

    // Count WhatsApp messages
    const { count: msgCount } = await supabase
      .from("whatsapp_messages")
      .select("*", { count: "exact", head: true });

    // Recent businesses (last 10)
    const { data: recentBiz } = await supabase
      .from("businesses")
      .select(`
        id, name, slug, active, created_at,
        verticals (emoji, name)
      `)
      .order("created_at", { ascending: false })
      .limit(10);

    const recentBusinesses = (recentBiz || []).map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      active: b.active,
      created_at: b.created_at,
      vertical_emoji: b.verticals?.emoji || "",
      vertical_name: b.verticals?.name || ""
    }));

    return json(200, {
      businesses: bizCount || 0,
      orders: orderCount || 0,
      revenue,
      messages: msgCount || 0,
      recentBusinesses
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

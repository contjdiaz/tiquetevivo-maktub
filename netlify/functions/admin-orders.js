import { json, supabaseAdmin } from "./_utils.js";
import { validateAdminToken } from "./_admin-auth.js";

/**
 * GET /api/admin-orders
 * 
 * Returns the latest 50 orders across all businesses.
 * Requires admin authentication.
 */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const auth = validateAdminToken(event);
  if (!auth.valid) return auth.error;

  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("orders")
      .select(`
        id, order_number, customer_name, customer_phone,
        items_text, total, paid, balance, status,
        created_at, business_id,
        businesses (name, slug)
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const orders = (data || []).map(o => ({
      ...o,
      business_name: o.businesses?.name || "",
      business_slug: o.businesses?.slug || ""
    }));

    return json(200, orders);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

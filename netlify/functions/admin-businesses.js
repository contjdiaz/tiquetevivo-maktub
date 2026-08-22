import { json, supabaseAdmin } from "./_utils.js";
import { validateAdminToken } from "./_admin-auth.js";

/**
 * GET /api/admin-businesses
 * 
 * Returns all businesses (active and inactive) with vertical info.
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
      .from("businesses")
      .select(`
        id, slug, name, phone, active, city, created_at, updated_at,
        verticals (emoji, name, slug)
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const businesses = (data || []).map(b => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      phone: b.phone,
      active: b.active,
      city: b.city,
      created_at: b.created_at,
      vertical_emoji: b.verticals?.emoji || "",
      vertical_name: b.verticals?.name || "",
      vertical_slug: b.verticals?.slug || ""
    }));

    return json(200, businesses);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

import { json, supabaseAdmin } from "./_utils.js";

/**
 * GET /api/list-businesses
 *
 * Returns all active businesses for the business selector dropdown.
 * Each entry includes: id, slug, name, vertical emoji.
 */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("businesses")
      .select(`
        id,
        slug,
        name,
        active,
        vertical_id,
        verticals (emoji, name)
      `)
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    const businesses = (data || []).map(biz => ({
      id: biz.id,
      slug: biz.slug,
      name: biz.name,
      vertical_emoji: biz.verticals?.emoji || "",
      vertical_name: biz.verticals?.name || ""
    }));

    return json(200, businesses);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

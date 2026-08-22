import { json, supabaseAdmin } from "./_utils.js";
import { validateAdminToken } from "./_admin-auth.js";

/**
 * GET /api/admin-verticals
 * 
 * Returns all verticals in the system with their configurations.
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
      .from("verticals")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    return json(200, data || []);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

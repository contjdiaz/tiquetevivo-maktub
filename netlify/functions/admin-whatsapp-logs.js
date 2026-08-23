import { json, supabaseAdmin } from "./_utils.js";
import { validateAdminToken } from "./_admin-auth.js";

/**
 * GET /api/admin-whatsapp-logs
 * 
 * Returns the latest 100 WhatsApp message logs.
 * Requires admin authentication.
 */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const auth = await validateAdminToken(event);
  if (!auth.valid) return auth.error;

  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return json(200, data || []);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

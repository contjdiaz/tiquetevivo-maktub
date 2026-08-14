import { getBusinessBySlug, json, supabaseAdmin } from "./_utils.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const slug = event.queryStringParameters?.slug || "majesty";
    const status = event.queryStringParameters?.status;
    const supabase = supabaseAdmin();
    const business = await getBusinessBySlug(supabase, slug);

    let query = supabase
      .from("orders")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(Number(event.queryStringParameters?.limit || 100));

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;
    return json(200, data || []);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

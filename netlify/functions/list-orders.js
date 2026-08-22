import { getBusinessBySlug, json, supabaseAdmin } from "./_utils.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const slug = event.queryStringParameters?.slug || "majesty";
    const status = event.queryStringParameters?.status;
    const includeBusiness = event.queryStringParameters?.include_business === "1";
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

      return json(200, {
        orders: data || [],
        business: {
          name: business.name,
          phone: business.phone,
          slug: business.slug,
          status_flow_config: business.status_flow_config || [],
          custom_fields_config: business.custom_fields_config || [],
          vertical_emoji: verticalEmoji
        }
      });
    }

    return json(200, data || []);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

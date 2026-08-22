import { getBusinessBySlug, json, supabaseAdmin } from "./_utils.js";

/**
 * GET /api/get-business-config?slug=<business_slug>
 *
 * Returns the business configuration including:
 * - services_config: available services for this business
 * - custom_fields_config: custom field definitions for orders
 * - status_flow_config: ordered status flow for orders
 * - whatsapp_templates_config: WhatsApp message templates
 * - vertical emoji and name
 *
 * Requirements: 10.1
 */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const slug = event.queryStringParameters?.slug || "majesty";
    const supabase = supabaseAdmin();
    const business = await getBusinessBySlug(supabase, slug);

    // Fetch vertical info for emoji/name if vertical_id is set
    let verticalEmoji = "";
    let verticalName = "";
    if (business.vertical_id) {
      const { data: vertical } = await supabase
        .from("verticals")
        .select("emoji, name")
        .eq("id", business.vertical_id)
        .single();
      if (vertical) {
        verticalEmoji = vertical.emoji || "";
        verticalName = vertical.name || "";
      }
    }

    return json(200, {
      business_id: business.id,
      business_name: business.name,
      business_slug: business.slug,
      vertical_emoji: verticalEmoji,
      vertical_name: verticalName,
      services_config: business.services_config || [],
      custom_fields_config: business.custom_fields_config || [],
      status_flow_config: business.status_flow_config || [],
      whatsapp_templates_config: business.whatsapp_templates_config || {}
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

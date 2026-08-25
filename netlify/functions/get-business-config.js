import { getBusinessBySlug, getBearerToken, getAuthUser, getUserBusinessRole, hasPermission, json, supabaseAdmin } from "./_utils.js";

/**
 * GET /api/get-business-config?slug=<business_slug>
 *
 * For unauthenticated requests: returns only public-safe fields
 *   (business_name, business_slug, vertical_emoji, vertical_name,
 *    status_flow_config, custom_fields_config, loyalty_config with only enabled and target)
 *
 * For authenticated requests with `read` permission: returns full configuration
 *   including business_id, services_config, whatsapp_templates_config, reactivation_config,
 *   and full loyalty_config.
 *
 * Requirements: 4.1, 4.2, 4.3
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

    // Attempt authentication (optional - not required for public access)
    const token = getBearerToken(event);
    const user = await getAuthUser(supabase, token);

    let isAuthenticated = false;
    if (user) {
      const role = await getUserBusinessRole(supabase, user.id, business.id);
      if (role && hasPermission(role, "read")) {
        isAuthenticated = true;
      }
    }

    // Authenticated with read permission: return full configuration
    if (isAuthenticated) {
      return json(200, {
        business_id: business.id,
        business_name: business.name,
        business_slug: business.slug,
        plan: business.plan || "free",
        vertical_emoji: verticalEmoji,
        vertical_name: verticalName,
        services_config: business.services_config || [],
        custom_fields_config: business.custom_fields_config || [],
        status_flow_config: business.status_flow_config || [],
        whatsapp_templates_config: business.whatsapp_templates_config || {},
        loyalty_config: business.loyalty_config || { enabled: true, target: 5 },
        reactivation_config: business.reactivation_config || { enabled: true, threshold_days: 30, monthly_limit: 50 }
      });
    }

    // Unauthenticated: return only public-safe fields (whitelist)
    const loyaltyConfig = business.loyalty_config || { enabled: true, target: 5 };
    return json(200, {
      business_name: business.name,
      business_slug: business.slug,
      vertical_emoji: verticalEmoji,
      vertical_name: verticalName,
      status_flow_config: business.status_flow_config || [],
      custom_fields_config: business.custom_fields_config || [],
      loyalty_config: {
        enabled: loyaltyConfig.enabled,
        target: loyaltyConfig.target
      }
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

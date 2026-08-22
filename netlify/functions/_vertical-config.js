/**
 * Shared Vertical Configuration Module for TiqueteVivo Multi-Vertical Platform.
 * Provides functions to fetch business config, retrieve vertical definitions,
 * and apply vertical defaults to businesses during onboarding.
 *
 * Requirements: 1.6, 3.2, 3.3, 3.4, 3.5
 */

/**
 * Fetches the complete business configuration including vertical defaults.
 * Returns merged config with services, custom fields, status flow, and templates.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} businessId
 * @returns {Promise<object>} BusinessConfig object
 */
export async function getBusinessConfig(supabase, businessId) {
  const { data, error } = await supabase
    .from("businesses")
    .select(`
      id,
      slug,
      name,
      vertical_id,
      services_config,
      custom_fields_config,
      status_flow_config,
      whatsapp_templates_config,
      verticals (
        id,
        slug,
        name,
        emoji,
        services_default,
        custom_fields_default,
        status_flow_default,
        whatsapp_templates_default
      )
    `)
    .eq("id", businessId)
    .single();

  if (error) throw error;
  if (!data) throw new Error("Business not found");

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    vertical_id: data.vertical_id,
    services_config: data.services_config || [],
    custom_fields_config: data.custom_fields_config || [],
    status_flow_config: data.status_flow_config || [],
    whatsapp_templates_config: data.whatsapp_templates_config || {},
    vertical: data.verticals || null
  };
}

/**
 * Fetches a vertical definition by slug.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} slug - Vertical slug identifier (e.g. "laundry", "parking")
 * @returns {Promise<object|null>} VerticalDefinition or null if not found
 */
export async function getVerticalBySlug(supabase, slug) {
  const { data, error } = await supabase
    .from("verticals")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .single();

  if (error && error.code === "PGRST116") {
    // PGRST116 = no rows returned by .single()
    return null;
  }
  if (error) throw error;

  return data;
}

/**
 * Copies vertical defaults into business configuration columns.
 * Used during business registration to initialize the business with
 * its vertical's default services, custom fields, status flow, and templates.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} businessId
 * @param {object} vertical - VerticalDefinition object with default configs
 * @returns {Promise<void>}
 */
export async function applyVerticalDefaults(supabase, businessId, vertical) {
  const { error } = await supabase
    .from("businesses")
    .update({
      vertical_id: vertical.id,
      services_config: vertical.services_default || [],
      custom_fields_config: vertical.custom_fields_default || [],
      status_flow_config: vertical.status_flow_default || [],
      whatsapp_templates_config: vertical.whatsapp_templates_default || {}
    })
    .eq("id", businessId);

  if (error) throw error;
}

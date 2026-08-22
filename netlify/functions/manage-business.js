import { json, parseBody, supabaseAdmin } from "./_utils.js";
import { validatePhone } from "./_validators.js";
import { getVerticalBySlug, applyVerticalDefaults } from "./_vertical-config.js";

/**
 * Valid units for service entries.
 */
const VALID_UNITS = ["per_item", "per_kg", "per_hour", "flat_rate"];

/**
 * Finds a service entry index in the services_config array by index or name.
 * @param {Array} services - The services_config array
 * @param {object} identifier - { index } or { name } to locate the service
 * @returns {{ idx: number, error?: string }}
 */
function findServiceIndex(services, identifier) {
  if (identifier.index != null) {
    const idx = Number(identifier.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= services.length) {
      return { idx: -1, error: `Service at index ${identifier.index} not found` };
    }
    return { idx };
  }
  if (identifier.name) {
    const idx = services.findIndex(
      (s) => s.name && s.name.toLowerCase() === identifier.name.toLowerCase()
    );
    if (idx === -1) {
      return { idx: -1, error: `Service '${identifier.name}' not found` };
    }
    return { idx };
  }
  return { idx: -1, error: "Must provide 'index' or 'name' to identify the service" };
}

/**
 * Handles the add-service action.
 * Validates required fields and appends new service entry to business services_config.
 * Requirements: 4.2, 4.5
 */
async function handleAddService(supabase, business, body) {
  const { service } = body;

  if (!service || typeof service !== "object") {
    return json(400, { error: true, message: "service object is required" });
  }

  // Validate required fields
  if (!service.name || typeof service.name !== "string" || !service.name.trim()) {
    return json(400, { error: true, message: "service.name is required", field: "name" });
  }
  if (service.default_price == null || typeof service.default_price !== "number") {
    return json(400, { error: true, message: "service.default_price is required and must be a number", field: "default_price" });
  }
  if (!service.unit || !VALID_UNITS.includes(service.unit)) {
    return json(400, { error: true, message: `service.unit is required and must be one of: ${VALID_UNITS.join(", ")}`, field: "unit" });
  }

  // Build the new service entry
  const newService = {
    name: service.name.trim(),
    description: service.description || "",
    default_price: service.default_price,
    duration: service.duration || 0,
    unit: service.unit,
    active: true
  };

  // Append to services_config (only modifies business copy, never vertical defaults)
  const updatedServices = [...(business.services_config || []), newService];

  const { data, error } = await supabase
    .from("businesses")
    .update({ services_config: updatedServices })
    .eq("id", business.id)
    .select("services_config")
    .single();

  if (error) throw error;
  return json(200, { services_config: data.services_config });
}

/**
 * Handles the update-service action.
 * Identifies service by index or name and updates only provided fields.
 * Requirements: 4.3, 4.5
 */
async function handleUpdateService(supabase, business, body) {
  const { service, index, name } = body;

  if (!service || typeof service !== "object") {
    return json(400, { error: true, message: "service object with fields to update is required" });
  }

  const services = [...(business.services_config || [])];
  const { idx, error: findError } = findServiceIndex(services, { index, name });

  if (idx === -1) {
    return json(404, { error: true, message: findError });
  }

  // Only update fields that are explicitly provided
  const allowedFields = ["name", "description", "default_price", "duration", "unit", "active"];
  const fieldsToUpdate = Object.keys(service).filter((k) => allowedFields.includes(k));

  if (fieldsToUpdate.length === 0) {
    return json(400, { error: true, message: "No fields provided to update" });
  }

  // Validate specific fields if provided
  if (service.unit !== undefined && !VALID_UNITS.includes(service.unit)) {
    return json(400, { error: true, message: `service.unit must be one of: ${VALID_UNITS.join(", ")}`, field: "unit" });
  }
  if (service.default_price !== undefined && typeof service.default_price !== "number") {
    return json(400, { error: true, message: "service.default_price must be a number", field: "default_price" });
  }
  if (service.name !== undefined && (typeof service.name !== "string" || !service.name.trim())) {
    return json(400, { error: true, message: "service.name must be a non-empty string", field: "name" });
  }

  // Apply updates to the target service entry
  for (const field of fieldsToUpdate) {
    services[idx] = { ...services[idx], [field]: field === "name" ? service[field].trim() : service[field] };
  }

  const { data, error } = await supabase
    .from("businesses")
    .update({ services_config: services })
    .eq("id", business.id)
    .select("services_config")
    .single();

  if (error) throw error;
  return json(200, { services_config: data.services_config });
}

/**
 * Handles the disable-service action.
 * Sets active: false on the service entry (soft-delete, no physical removal).
 * Requirements: 4.4, 4.5
 */
async function handleDisableService(supabase, business, body) {
  const { index, name } = body;

  const services = [...(business.services_config || [])];
  const { idx, error: findError } = findServiceIndex(services, { index, name });

  if (idx === -1) {
    return json(404, { error: true, message: findError });
  }

  // Soft-delete: set active flag to false, preserve the entry
  services[idx] = { ...services[idx], active: false };

  const { data, error } = await supabase
    .from("businesses")
    .update({ services_config: services })
    .eq("id", business.id)
    .select("services_config")
    .single();

  if (error) throw error;
  return json(200, { services_config: data.services_config });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const { action, business_id, phone } = body;

    const validActions = [
      "register", "deactivate", "reactivate",
      "add-service", "update-service", "disable-service"
    ];

    // Validate action
    if (!action || !validActions.includes(action)) {
      return json(400, { error: true, message: `action must be one of: ${validActions.join(", ")}` });
    }

    // Validate business_id for non-register actions
    if (action !== "register" && !business_id) {
      return json(400, { error: true, message: "business_id is required" });
    }

    // Validate phone if provided (Requirement 8.4)
    if (phone != null && phone !== "") {
      const phoneResult = validatePhone(phone);
      if (!phoneResult.valid) {
        return json(400, { error: true, message: phoneResult.error, field: "phone" });
      }
    }

    const supabase = supabaseAdmin();

    // Handle registration action (doesn't require existing business_id)
    if (action === "register") {
      const { vertical_slug, name, slug: businessSlug } = body;

      // Require vertical_slug
      if (!vertical_slug) {
        return json(400, { error: true, message: "vertical_slug is required" });
      }

      // Validate vertical slug exists
      const vertical = await getVerticalBySlug(supabase, vertical_slug);
      if (!vertical) {
        return json(400, { error: true, message: `Vertical '${vertical_slug}' not found`, field: "vertical_slug" });
      }

      // Create the new business row
      const { data: newBusiness, error: insertError } = await supabase
        .from("businesses")
        .insert({
          name: name || null,
          slug: businessSlug || null,
          phone: phone || null,
          vertical_id: vertical.id,
          active: true
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Apply vertical defaults (copies services, custom fields, status flow, templates)
      await applyVerticalDefaults(supabase, newBusiness.id, vertical);

      // Fetch the updated business with defaults applied
      const { data: updatedBusiness, error: fetchUpdatedError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", newBusiness.id)
        .single();

      if (fetchUpdatedError) throw fetchUpdatedError;
      return json(201, updatedBusiness);
    }

    // --- All other actions require looking up the business ---
    const { data: business, error: fetchError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", business_id)
      .single();

    if (fetchError || !business) {
      return json(404, { error: true, message: "Business not found" });
    }

    // --- Service catalog CRUD actions (Task 6.2) ---
    if (action === "add-service") {
      return await handleAddService(supabase, business, body);
    }

    if (action === "update-service") {
      return await handleUpdateService(supabase, business, body);
    }

    if (action === "disable-service") {
      return await handleDisableService(supabase, business, body);
    }

    // --- Deactivate/Reactivate actions ---
    if (action === "deactivate") {
      // Check if already deactivated
      if (business.active === false) {
        return json(400, { error: true, message: "Business is already deactivated" });
      }

      const { data, error } = await supabase
        .from("businesses")
        .update({ active: false, deactivated_at: new Date().toISOString() })
        .eq("id", business_id)
        .select()
        .single();

      if (error) throw error;
      return json(200, data);
    }

    if (action === "reactivate") {
      // Check if already active
      if (business.active === true) {
        return json(400, { error: true, message: "Business is already active" });
      }

      const { data, error } = await supabase
        .from("businesses")
        .update({ active: true, deactivated_at: null })
        .eq("id", business_id)
        .select()
        .single();

      if (error) throw error;
      return json(200, data);
    }
  } catch (error) {
    return json(500, { error: true, message: error.message });
  }
};

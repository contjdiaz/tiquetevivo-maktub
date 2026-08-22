import { json, parseBody, slugify, supabaseAdmin } from "./_utils.js";
import { mirrorBusinessToSheets } from "./_sheets.js";
import { validatePhone, validateRequired } from "./_validators.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);

    // Validate required fields (name is always required)
    const requiredCheck = validateRequired(body, ['name']);
    if (!requiredCheck.valid) {
      return json(400, { error: true, message: requiredCheck.errors.join('; '), field: "name" });
    }

    // Generate slug from explicit slug field or from name
    const slug = slugify(body.slug || body.name);
    if (!slug) {
      return json(400, { error: true, message: "A valid slug could not be generated. Provide a valid 'slug' or 'name' containing alphanumeric characters.", field: "slug" });
    }

    // Validate phone format if provided
    if (body.phone) {
      const phoneResult = validatePhone(body.phone);
      if (!phoneResult.valid) {
        return json(400, { error: true, message: phoneResult.error, field: "phone" });
      }
    }

    const supabase = supabaseAdmin();
    const payload = {
      slug,
      name: body.name,
      phone: body.phone || null,
      address: body.address || null,
      city: body.city || null,
      color: body.color || "#18a058",
      logo_url: body.logoUrl || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("businesses")
      .upsert(payload, { onConflict: "slug" })
      .select()
      .single();

    if (error) throw error;
    mirrorBusinessToSheets(data).catch(() => {});
    return json(200, data);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

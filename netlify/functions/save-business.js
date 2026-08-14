import { json, parseBody, slugify, supabaseAdmin } from "./_utils.js";
import { mirrorBusinessToSheets } from "./_sheets.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const slug = slugify(body.slug || body.name);
    if (!slug || !body.name) return json(400, { error: "Business name is required" });

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

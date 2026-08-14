import { json, parseBody, supabaseAdmin } from "./_utils.js";
import { postToSheets } from "./_sheets.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    if (!body.business || !body.name || !body.phone) {
      return json(400, { error: "business, name and phone are required" });
    }

    const lead = {
      business: body.business,
      name: body.name,
      phone: body.phone,
      city: body.city || null,
      created_at: new Date().toISOString()
    };

    // Mirror to Google Sheets for admin visibility
    postToSheets({ type: "lead", lead }).catch(() => {});

    return json(200, { ok: true, lead });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

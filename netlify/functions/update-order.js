import { getBusinessBySlug, json, parseBody, supabaseAdmin } from "./_utils.js";
import { mirrorOrderToSheets } from "./_sheets.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "PUT" && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const body = parseBody(event);
    const orderId = body.id || body.orderId;
    if (!orderId) {
      return json(400, { error: "Order id is required" });
    }

    const updatePayload = {};
    if (body.status) updatePayload.status = body.status;
    if (typeof body.paid !== "undefined") updatePayload.paid = Number(body.paid);
    if (typeof body.total !== "undefined") updatePayload.total = Number(body.total);
    if (body.itemsText) updatePayload.items_text = body.itemsText;
    if (body.dueDate) updatePayload.due_date = body.dueDate;
    if (typeof body.rackLocation !== "undefined" || typeof body.rack_location !== "undefined") {
      updatePayload.rack_location = body.rackLocation || body.rack_location || null;
    }
    if (typeof body.isDelicate !== "undefined" || typeof body.is_delicate !== "undefined") {
      updatePayload.is_delicate = Boolean(body.isDelicate || body.is_delicate);
    }

    if (Object.keys(updatePayload).length === 0) {
      return json(400, { error: "No fields provided to update" });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .select()
      .single();

    if (error) throw error;

    const slug = body.businessSlug || body.slug || "majesty";
    getBusinessBySlug(supabase, slug)
      .then((business) => mirrorOrderToSheets(data, business))
      .catch(() => {});

    return json(200, data);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

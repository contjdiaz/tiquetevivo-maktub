import { getBusinessBySlug, json, parseBody, supabaseAdmin } from "./_utils.js";
import { mirrorOrderToSheets } from "./_sheets.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const slug = body.businessSlug || body.slug || "majesty";
    if (!body.customerName || !body.customerPhone || !body.itemsText) {
      return json(400, { error: "customerName, customerPhone and itemsText are required" });
    }

    const supabase = supabaseAdmin();
    const business = await getBusinessBySlug(supabase, slug);
    const orderNumber = body.orderNumber || String(Date.now()).slice(-6);

    const payload = {
      business_id: business.id,
      order_number: orderNumber,
      customer_name: body.customerName,
      customer_phone: body.customerPhone,
      items_text: body.itemsText,
      total: Number(body.total || 0),
      paid: Number(body.paid || 0),
      status: body.status || "RECEIVED",
      due_date: body.dueDate || null,
      rack_location: body.rackLocation || body.rack_location || null,
      is_delicate: Boolean(body.isDelicate || body.is_delicate)
    };

    const { data, error } = await supabase
      .from("orders")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    mirrorOrderToSheets(data, business).catch(() => {});
    return json(201, data);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

import { getBusinessBySlug, json, supabaseAdmin } from "./_utils.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const number = event.queryStringParameters?.number;
    const slug = event.queryStringParameters?.slug;

    if (!number || !slug) {
      return json(400, { error: "Missing required parameters: number, slug" });
    }

    const supabase = supabaseAdmin();
    const business = await getBusinessBySlug(supabase, slug);

    const { data, error } = await supabase
      .from("orders")
      .select("status, balance, paid, updated_at")
      .eq("business_id", business.id)
      .eq("order_number", number)
      .single();

    if (error || !data) {
      return json(404, { error: "Order not found" });
    }

    return json(200, {
      status: data.status,
      balance: data.balance,
      paid: data.paid,
      updated_at: data.updated_at
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

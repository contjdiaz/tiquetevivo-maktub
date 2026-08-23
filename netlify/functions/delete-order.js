import { json, parseBody, requireAuth, supabaseAdmin } from "./_utils.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const { action, order_id, business_id, confirm } = body;

    if (!action || !order_id || !business_id) {
      return json(400, {
        error: true,
        message: "action, order_id, and business_id are required"
      });
    }

    if (action !== "cancel" && action !== "hard-delete") {
      return json(400, {
        error: true,
        message: 'action must be "cancel" or "hard-delete"'
      });
    }

    const supabase = supabaseAdmin();

    // Lookup order and validate ownership
    const { data: order, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .eq("business_id", business_id)
      .single();

    if (fetchError || !order) {
      return json(404, {
        error: true,
        message: "Order not found or does not belong to this business"
      });
    }

    // --- Authentication and authorization ---
    const permission = action === "hard-delete" ? "delete_order" : "delete_order";
    const authResult = await requireAuth(supabase, event, {
      permission,
      businessId: business_id
    });
    if (authResult.error) return authResult.error;

    // --- Cancel action ---
    if (action === "cancel") {
      if (order.status === "CANCELLED") {
        return json(400, {
          error: true,
          message: "Order is already cancelled"
        });
      }

      const { data: updated, error: updateError } = await supabase
        .from("orders")
        .update({ status: "CANCELLED", cancelled_at: new Date().toISOString() })
        .eq("id", order_id)
        .select()
        .single();

      if (updateError) throw updateError;

      return json(200, updated);
    }

    // --- Hard-delete action ---
    if (action === "hard-delete") {
      if (confirm !== true) {
        return json(400, {
          error: true,
          message: "Hard delete requires confirm=true"
        });
      }

      const { error: deleteError } = await supabase
        .from("orders")
        .delete()
        .eq("id", order_id);

      if (deleteError) throw deleteError;

      return json(200, { deleted: true, order_id });
    }
  } catch (error) {
    return json(500, { error: true, message: error.message });
  }
};

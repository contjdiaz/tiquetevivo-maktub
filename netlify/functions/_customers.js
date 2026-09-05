/**
 * Customers module — first-class customer entity helpers.
 *
 * A customer is unique per (business_id, phone). These helpers create or update
 * the customer record and keep lightweight aggregates used for retention
 * metrics (orders_count, last_order_at). All functions are defensive: failures
 * never block order creation (the caller treats customer linking as best-effort).
 */

/**
 * Creates or updates a customer for a business, returning the customer id.
 *
 * @param {object} supabase - Supabase admin client
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.name
 * @param {string} params.phone - normalized phone (unique key within business)
 * @param {string} [params.email]
 * @param {string} [params.address]
 * @param {boolean} [params.incrementOrder=true] - bump orders_count/last_order_at
 * @returns {Promise<{ id: string|null, created: boolean }>}
 */
export async function upsertCustomer(supabase, params) {
  const { businessId, name, phone } = params;
  if (!businessId || !phone) return { id: null, created: false };

  const nowIso = new Date().toISOString();
  const incrementOrder = params.incrementOrder !== false;

  // Try to find existing customer for this business+phone.
  const { data: existing, error: findErr } = await supabase
    .from("customers")
    .select("id, orders_count")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .single();

  if (!findErr && existing) {
    const update = {};
    if (name) update.name = name;
    if (params.email) update.email = params.email;
    if (params.address) update.address = params.address;
    if (incrementOrder) {
      update.orders_count = (existing.orders_count || 0) + 1;
      update.last_order_at = nowIso;
    }
    if (Object.keys(update).length > 0) {
      const { error: updErr } = await supabase
        .from("customers")
        .update(update)
        .eq("id", existing.id);
      if (updErr) {
        console.error("[customers] update failed:", updErr.message);
      }
    }
    return { id: existing.id, created: false };
  }

  // Insert new customer.
  const insertPayload = {
    business_id: businessId,
    name: name || "Cliente",
    phone,
    email: params.email || null,
    address: params.address || null,
    first_seen_at: nowIso,
    last_order_at: incrementOrder ? nowIso : null,
    orders_count: incrementOrder ? 1 : 0
  };

  const { data: created, error: insErr } = await supabase
    .from("customers")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insErr) {
    // Possible race: another insert won the unique(business_id, phone). Re-read.
    const { data: raced } = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", businessId)
      .eq("phone", phone)
      .single();
    if (raced) return { id: raced.id, created: false };
    console.error("[customers] insert failed:", insErr.message);
    return { id: null, created: false };
  }

  return { id: created.id, created: true };
}

/**
 * Computes retention metrics for a customer from their orders.
 * @param {object} supabase
 * @param {string} customerId
 * @returns {Promise<{ ordersCount: number, daysSinceLast: number|null, avgFrequencyDays: number|null }>}
 */
export async function getCustomerMetrics(supabase, customerId) {
  const empty = { ordersCount: 0, daysSinceLast: null, avgFrequencyDays: null };
  if (!customerId) return empty;

  const { data: orders, error } = await supabase
    .from("orders")
    .select("created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  if (error || !orders || orders.length === 0) return empty;

  const times = orders.map((o) => new Date(o.created_at).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return empty;

  const dayMs = 24 * 60 * 60 * 1000;
  const last = times[times.length - 1];
  const daysSinceLast = Math.floor((Date.now() - last) / dayMs);

  let avgFrequencyDays = null;
  if (times.length >= 2) {
    let sumGaps = 0;
    for (let i = 1; i < times.length; i++) sumGaps += times[i] - times[i - 1];
    avgFrequencyDays = Math.round(sumGaps / (times.length - 1) / dayMs);
  }

  return { ordersCount: orders.length, daysSinceLast, avgFrequencyDays };
}

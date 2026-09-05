/**
 * Unit tests for the customers module (wave 3).
 * Covers upsertCustomer (create new / update existing) and getCustomerMetrics.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { upsertCustomer, getCustomerMetrics } from "../netlify/functions/_customers.js";

/**
 * Builds a minimal chainable Supabase mock for the "customers" and "orders"
 * tables. Behavior is driven by the provided handlers.
 */
function makeSupabase({ findCustomer, insertCustomer, ordersRows } = {}) {
  const updateSpy = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));

  return {
    _updateSpy: updateSpy,
    from(table) {
      if (table === "customers") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () => Promise.resolve(findCustomer ? findCustomer() : { data: null, error: { code: "PGRST116" } })
              })
            })
          }),
          update: updateSpy,
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve(insertCustomer ? insertCustomer() : { data: { id: "new-cust" }, error: null })
            })
          })
        };
      }
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: ordersRows || [], error: null })
            })
          })
        };
      }
      throw new Error("unexpected table " + table);
    }
  };
}

describe("upsertCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns {id:null} when businessId or phone missing", async () => {
    const supabase = makeSupabase();
    const res = await upsertCustomer(supabase, { businessId: "", phone: "" });
    expect(res).toEqual({ id: null, created: false });
  });

  it("creates a new customer when none exists", async () => {
    const supabase = makeSupabase({
      findCustomer: () => ({ data: null, error: { code: "PGRST116" } }),
      insertCustomer: () => ({ data: { id: "cust-1" }, error: null })
    });
    const res = await upsertCustomer(supabase, { businessId: "biz-1", name: "Ana", phone: "+573001112233" });
    expect(res).toEqual({ id: "cust-1", created: true });
  });

  it("updates existing customer and increments orders_count", async () => {
    const supabase = makeSupabase({
      findCustomer: () => ({ data: { id: "cust-9", orders_count: 3 }, error: null })
    });
    const res = await upsertCustomer(supabase, { businessId: "biz-1", name: "Ana", phone: "+573001112233" });
    expect(res).toEqual({ id: "cust-9", created: false });
    // update called with orders_count = 4 and a last_order_at
    const updateArg = supabase._updateSpy.mock.calls[0][0];
    expect(updateArg.orders_count).toBe(4);
    expect(updateArg.last_order_at).toBeTruthy();
  });

  it("does not increment when incrementOrder is false", async () => {
    const supabase = makeSupabase({
      findCustomer: () => ({ data: { id: "cust-9", orders_count: 3 }, error: null })
    });
    await upsertCustomer(supabase, { businessId: "biz-1", name: "Ana", phone: "+57300", incrementOrder: false });
    const updateArg = supabase._updateSpy.mock.calls[0][0];
    expect(updateArg.orders_count).toBeUndefined();
    expect(updateArg.last_order_at).toBeUndefined();
  });
});

describe("getCustomerMetrics", () => {
  it("returns empty metrics for no orders", async () => {
    const supabase = makeSupabase({ ordersRows: [] });
    const m = await getCustomerMetrics(supabase, "cust-1");
    expect(m).toEqual({ ordersCount: 0, daysSinceLast: null, avgFrequencyDays: null });
  });

  it("computes ordersCount and avg frequency across multiple orders", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const rows = [
      { created_at: new Date(now - 20 * day).toISOString() },
      { created_at: new Date(now - 10 * day).toISOString() },
      { created_at: new Date(now - 0 * day).toISOString() }
    ];
    const supabase = makeSupabase({ ordersRows: rows });
    const m = await getCustomerMetrics(supabase, "cust-1");
    expect(m.ordersCount).toBe(3);
    expect(m.daysSinceLast).toBe(0);
    expect(m.avgFrequencyDays).toBe(10);
  });
});

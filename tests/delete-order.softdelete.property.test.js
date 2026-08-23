/**
 * Property Test: Soft-delete is idempotent and does not destroy data
 * Feature: whatsapp-auto-send, Property 6: Soft-delete is idempotent and does not destroy data
 *
 * **Validates: Requirements 5.1, 5.2**
 *
 * For any cancel operation on a valid order, the order remains in the database
 * with status='CANCELLED' and a non-null cancelled_at. Cancelling an already-cancelled
 * order returns an error without modifying the record. The order data is never removed
 * from the database by a cancel operation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock _utils.js before importing the handler
vi.mock("../netlify/functions/_utils.js", () => {
  return {
    json: vi.fn((statusCode, body) => ({
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })),
    parseBody: vi.fn((event) => {
      if (!event.body) return {};
      return JSON.parse(event.body);
    }),
    supabaseAdmin: vi.fn(),
    requireAuth: vi.fn().mockResolvedValue({ user: { id: "auth-user-1" }, role: "owner" }),
  };
});

import { handler } from "../netlify/functions/delete-order.js";
import { json, parseBody, supabaseAdmin } from "../netlify/functions/_utils.js";

// --- Generators ---
const orderIdArb = fc.uuid();
const businessIdArb = fc.uuid();

// Generate a valid ISO date string using integer timestamps (avoids Invalid Date issues)
const validDateArb = fc
  .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2025-12-31").getTime() })
  .map((ts) => new Date(ts).toISOString());

// Generate a realistic order object (non-cancelled)
const activeOrderArb = fc.record({
  id: fc.uuid(),
  business_id: fc.uuid(),
  customer_phone: fc.integer({ min: 1000000000, max: 999999999999999 }).map(String),
  status: fc.constantFrom("RECEIVED", "IN_PROGRESS", "READY", "DELIVERED"),
  total: fc.float({ min: 0, max: 99999, noNaN: true }),
  paid: fc.float({ min: 0, max: 99999, noNaN: true }),
  cancelled_at: fc.constant(null),
  created_at: validDateArb,
});

// Generate an already-cancelled order
const cancelledOrderArb = fc.record({
  id: fc.uuid(),
  business_id: fc.uuid(),
  customer_phone: fc.integer({ min: 1000000000, max: 999999999999999 }).map(String),
  status: fc.constant("CANCELLED"),
  total: fc.float({ min: 0, max: 99999, noNaN: true }),
  paid: fc.float({ min: 0, max: 99999, noNaN: true }),
  cancelled_at: validDateArb,
  created_at: validDateArb,
});

/**
 * Creates a mock Supabase client that simulates the orders table.
 * @param {object|null} existingOrder - The order to return on lookup (null = not found)
 */
function createMockSupabase(existingOrder) {
  let updatedData = null;
  let deleteWasCalled = false;

  const mockSupabase = {
    from(table) {
      return {
        select(columns) {
          return {
            eq(col, val) {
              return {
                eq(col2, val2) {
                  return {
                    single() {
                      if (existingOrder) {
                        return Promise.resolve({ data: existingOrder, error: null });
                      }
                      return Promise.resolve({ data: null, error: { message: "Not found" } });
                    },
                  };
                },
                single() {
                  if (existingOrder) {
                    return Promise.resolve({ data: existingOrder, error: null });
                  }
                  return Promise.resolve({ data: null, error: { message: "Not found" } });
                },
              };
            },
          };
        },
        update(fields) {
          updatedData = { ...existingOrder, ...fields };
          return {
            eq(col, val) {
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({ data: updatedData, error: null });
                    },
                  };
                },
              };
            },
          };
        },
        delete() {
          deleteWasCalled = true;
          return {
            eq(col, val) {
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };

  return { mockSupabase, getUpdatedData: () => updatedData, wasDeleted: () => deleteWasCalled };
}

function makeEvent(body) {
  return {
    httpMethod: "POST",
    body: JSON.stringify(body),
  };
}

describe("Feature: whatsapp-auto-send, Property 6: Soft-delete is idempotent and does not destroy data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancelling an active order sets status='CANCELLED' and cancelled_at to a non-null timestamp", async () => {
    await fc.assert(
      fc.asyncProperty(activeOrderArb, async (order) => {
        const { mockSupabase, getUpdatedData, wasDeleted } = createMockSupabase(order);
        supabaseAdmin.mockReturnValue(mockSupabase);

        const event = makeEvent({
          action: "cancel",
          order_id: order.id,
          business_id: order.business_id,
        });

        const result = await handler(event);
        const parsedBody = JSON.parse(result.body);

        // Property: response is 200 (success)
        expect(result.statusCode).toBe(200);

        // Property: the updated order has status='CANCELLED'
        expect(parsedBody.status).toBe("CANCELLED");

        // Property: cancelled_at is set to a non-null timestamp
        expect(parsedBody.cancelled_at).not.toBeNull();
        expect(parsedBody.cancelled_at).toBeDefined();

        // Property: cancel never triggers a delete operation
        expect(wasDeleted()).toBe(false);

        // Property: the order data is still present (soft-delete preserves data)
        expect(parsedBody.id || parsedBody.id === order.id || getUpdatedData() !== null).toBeTruthy();
        expect(getUpdatedData()).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it("cancelling an already-cancelled order returns 400 (not a crash)", async () => {
    await fc.assert(
      fc.asyncProperty(cancelledOrderArb, async (order) => {
        const { mockSupabase, getUpdatedData, wasDeleted } = createMockSupabase(order);
        supabaseAdmin.mockReturnValue(mockSupabase);

        const event = makeEvent({
          action: "cancel",
          order_id: order.id,
          business_id: order.business_id,
        });

        const result = await handler(event);
        const parsedBody = JSON.parse(result.body);

        // Property: returns 400 status (idempotent guard — no crash, no 500)
        expect(result.statusCode).toBe(400);

        // Property: error response contains meaningful message
        expect(parsedBody.error).toBe(true);
        expect(parsedBody.message).toBeDefined();
        expect(parsedBody.message.toLowerCase()).toContain("already cancelled");

        // Property: no update was performed on the already-cancelled order
        expect(getUpdatedData()).toBeNull();

        // Property: no delete was performed
        expect(wasDeleted()).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("order data is still present after cancellation (soft-delete preserves data)", async () => {
    await fc.assert(
      fc.asyncProperty(activeOrderArb, async (order) => {
        const { mockSupabase, getUpdatedData, wasDeleted } = createMockSupabase(order);
        supabaseAdmin.mockReturnValue(mockSupabase);

        const event = makeEvent({
          action: "cancel",
          order_id: order.id,
          business_id: order.business_id,
        });

        const result = await handler(event);
        const parsedBody = JSON.parse(result.body);

        // Property: the response contains the full order data (not removed)
        expect(parsedBody.id).toBe(order.id);
        expect(parsedBody.business_id).toBe(order.business_id);
        expect(parsedBody.customer_phone).toBe(order.customer_phone);

        // Property: the updated record still has all original fields
        const updated = getUpdatedData();
        expect(updated).not.toBeNull();
        expect(updated.id).toBe(order.id);
        expect(updated.business_id).toBe(order.business_id);
        expect(updated.customer_phone).toBe(order.customer_phone);
        expect(updated.created_at).toBe(order.created_at);

        // Property: delete was never called (data not permanently removed)
        expect(wasDeleted()).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it("for any valid order_id/business_id, the cancel action never permanently removes data", async () => {
    await fc.assert(
      fc.asyncProperty(
        orderIdArb,
        businessIdArb,
        fc.constantFrom("RECEIVED", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"),
        async (orderId, businessId, currentStatus) => {
          const order = {
            id: orderId,
            business_id: businessId,
            customer_phone: "1234567890",
            status: currentStatus,
            total: 100,
            paid: 50,
            cancelled_at: currentStatus === "CANCELLED" ? "2024-01-01T00:00:00.000Z" : null,
            created_at: "2024-01-01T00:00:00.000Z",
          };

          const { mockSupabase, wasDeleted } = createMockSupabase(order);
          supabaseAdmin.mockReturnValue(mockSupabase);

          const event = makeEvent({
            action: "cancel",
            order_id: orderId,
            business_id: businessId,
          });

          const result = await handler(event);

          // Property: regardless of outcome (200 or 400), delete is NEVER called
          expect(wasDeleted()).toBe(false);

          // Property: response is never a 500 (no crash)
          expect(result.statusCode).not.toBe(500);

          // Property: response is either 200 (successful cancel) or 400 (already cancelled)
          expect([200, 400]).toContain(result.statusCode);
        }
      ),
      { numRuns: 100 }
    );
  });
});

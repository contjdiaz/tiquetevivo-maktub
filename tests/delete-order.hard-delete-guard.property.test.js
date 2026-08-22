/**
 * Property Test: Hard-delete requires explicit confirmation
 * Feature: whatsapp-auto-send, Property 7: Hard-delete requires explicit confirmation
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * For any hard-delete request where confirm is not exactly boolean true,
 * the request is rejected with a 400 error and no data is deleted.
 * Only requests with confirm=true proceed with deletion.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock _utils.js before importing the handler
vi.mock("../netlify/functions/_utils.js", () => ({
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  parseBody: (event) => {
    if (!event.body) return {};
    return JSON.parse(event.body);
  },
  supabaseAdmin: vi.fn(),
}));

import { handler } from "../netlify/functions/delete-order.js";
import { supabaseAdmin } from "../netlify/functions/_utils.js";

/**
 * Creates a mock Supabase client that tracks operations.
 * @param {object} options - Configuration for mock behavior
 * @param {object|null} options.existingOrder - Order to return from select query (null = not found)
 * @param {boolean} options.deleteSuccess - Whether delete operation succeeds
 */
function createMockSupabase({ existingOrder = null, deleteSuccess = true } = {}) {
  const deletedIds = [];

  const mockSupabase = {
    from(table) {
      return {
        select() {
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
              };
            },
          };
        },
        delete() {
          return {
            eq(col, val) {
              deletedIds.push(val);
              if (deleteSuccess) {
                return Promise.resolve({ error: null });
              }
              return Promise.resolve({ error: { message: "Delete failed" } });
            },
          };
        },
        update(fields) {
          return {
            eq(col, val) {
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({ data: { ...existingOrder, ...fields }, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { mockSupabase, deletedIds };
}

/**
 * Helper to build a valid event for the handler.
 */
function buildEvent(body) {
  return {
    httpMethod: "POST",
    body: JSON.stringify(body),
  };
}

describe("Feature: whatsapp-auto-send, Property 7: Hard-delete requires explicit confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("when action='hard-delete' and confirm=true and order exists, order is permanently deleted (200)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (orderId, businessId) => {
          const existingOrder = { id: orderId, business_id: businessId, status: "RECEIVED" };
          const { mockSupabase, deletedIds } = createMockSupabase({ existingOrder });
          supabaseAdmin.mockReturnValue(mockSupabase);

          const event = buildEvent({
            action: "hard-delete",
            order_id: orderId,
            business_id: businessId,
            confirm: true,
          });

          const result = await handler(event);
          const responseBody = JSON.parse(result.body);

          // Property: returns 200 when confirm=true and order exists
          expect(result.statusCode).toBe(200);
          // Property: response indicates deletion
          expect(responseBody.deleted).toBe(true);
          expect(responseBody.order_id).toBe(orderId);
          // Property: the delete operation was actually called
          expect(deletedIds).toContain(orderId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when action='hard-delete' and confirm is any value other than true, returns 400", async () => {
    // Generator for values that are NOT boolean true
    const nonTrueConfirmArb = fc.oneof(
      fc.constant(false),
      fc.constant(null),
      fc.constant(undefined),
      fc.constant("true"),
      fc.constant("yes"),
      fc.constant(1),
      fc.constant(0),
      fc.constant(""),
      fc.integer(),
      fc.string(),
      fc.constant([]),
      fc.constant({})
    );

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        nonTrueConfirmArb,
        async (orderId, businessId, confirmValue) => {
          const existingOrder = { id: orderId, business_id: businessId, status: "RECEIVED" };
          const { mockSupabase, deletedIds } = createMockSupabase({ existingOrder });
          supabaseAdmin.mockReturnValue(mockSupabase);

          const event = buildEvent({
            action: "hard-delete",
            order_id: orderId,
            business_id: businessId,
            confirm: confirmValue,
          });

          const result = await handler(event);
          const responseBody = JSON.parse(result.body);

          // Property: returns 400 when confirm is not exactly true
          expect(result.statusCode).toBe(400);
          // Property: response contains error information
          expect(responseBody.error).toBe(true);
          // Property: no data was deleted
          expect(deletedIds.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when action='hard-delete' and confirm is not provided at all, returns 400", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        async (orderId, businessId) => {
          const existingOrder = { id: orderId, business_id: businessId, status: "RECEIVED" };
          const { mockSupabase, deletedIds } = createMockSupabase({ existingOrder });
          supabaseAdmin.mockReturnValue(mockSupabase);

          // Body without confirm field at all
          const event = buildEvent({
            action: "hard-delete",
            order_id: orderId,
            business_id: businessId,
          });

          const result = await handler(event);
          const responseBody = JSON.parse(result.body);

          // Property: returns 400 when confirm is missing
          expect(result.statusCode).toBe(400);
          // Property: response contains error information
          expect(responseBody.error).toBe(true);
          // Property: no data was deleted
          expect(deletedIds.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the 400 response includes a descriptive error about requiring confirm=true", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.uuid(),
        fc.oneof(
          fc.constant(false),
          fc.constant(null),
          fc.constant(undefined),
          fc.constant("true"),
          fc.constant(1),
          fc.constant(0)
        ),
        async (orderId, businessId, confirmValue) => {
          const existingOrder = { id: orderId, business_id: businessId, status: "RECEIVED" };
          const { mockSupabase } = createMockSupabase({ existingOrder });
          supabaseAdmin.mockReturnValue(mockSupabase);

          const event = buildEvent({
            action: "hard-delete",
            order_id: orderId,
            business_id: businessId,
            confirm: confirmValue,
          });

          const result = await handler(event);
          const responseBody = JSON.parse(result.body);

          // Property: response message references confirm=true requirement
          expect(responseBody.message).toBeDefined();
          expect(responseBody.message.toLowerCase()).toContain("confirm");
        }
      ),
      { numRuns: 100 }
    );
  });
});

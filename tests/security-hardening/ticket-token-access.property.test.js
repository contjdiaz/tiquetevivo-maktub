/**
 * Property-based tests for ticket token access in list-orders.
 * Feature: security-hardening, Property 3: Ticket token grants access to exactly one order.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 *
 * Property 3: Ticket token grants access to exactly one order without authentication
 * - For any valid ticket token, the Order_Endpoint SHALL return exactly one order
 *   matching that token, without requiring an Authorization header.
 * - The response SHALL NOT contain sensitive fields: customer_name, customer_phone,
 *   internal_notes, notes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ──────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────

const mockSupabase = {
  from: vi.fn()
};

vi.mock("../../netlify/functions/_utils.js", () => ({
  supabaseAdmin: () => mockSupabase,
  json: (statusCode, body) => ({
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }),
  getClientIp: () => "127.0.0.1",
  getBusinessBySlug: vi.fn().mockResolvedValue({ id: "biz-1", name: "Test", slug: "test" }),
  requireAuth: vi.fn()
}));

vi.mock("../../netlify/functions/_loyalty.js", () => ({
  getLoyaltySummary: vi.fn().mockResolvedValue({ success: false })
}));

// Always allow rate limiter in these tests
vi.mock("../../netlify/functions/_rate-limiter.js", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true }))
}));

vi.mock("../../netlify/functions/_photo-storage.js", () => ({
  getSignedPhotoUrl: vi.fn(async (supabase, path) => `https://signed.url/${path}`)
}));

import { handler } from "../../netlify/functions/list-orders.js";
import { requireAuth } from "../../netlify/functions/_utils.js";

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Generate a valid UUID v4 ticket token */
const ticketTokenArb = fc.uuid();

/** Generate a realistic order ID */
const orderIdArb = fc.uuid();

/** Generate a customer name (non-empty string) */
const customerNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

/** Generate a phone number */
const customerPhoneArb = fc.stringMatching(/^\+\d{7,15}$/);

/** Generate internal/staff notes */
const notesArb = fc.string({ minLength: 0, maxLength: 200 });

/** Generate an order status */
const statusArb = fc.constantFrom("pending", "processing", "ready", "delivered", "cancelled");

/** Generate a total amount */
const totalArb = fc.integer({ min: 0, max: 1000000 });

/** Generate a business_id */
const businessIdArb = fc.uuid();

/**
 * Generate a full order object with both sensitive and non-sensitive fields.
 */
const orderArb = fc.record({
  id: orderIdArb,
  business_id: businessIdArb,
  ticket_token: ticketTokenArb,
  customer_name: customerNameArb,
  customer_phone: customerPhoneArb,
  internal_notes: notesArb,
  notes: notesArb,
  status: statusArb,
  total: totalArb,
  created_at: fc.integer({ min: 1577836800000, max: 1924991999000 }).map(ts => new Date(ts).toISOString()),
  order_items: fc.array(
    fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 30 }),
      quantity: fc.integer({ min: 1, max: 10 })
    }),
    { minLength: 0, maxLength: 5 }
  )
});

// ──────────────────────────────────────────────────────────────────
// Sensitive fields that must be stripped
// ──────────────────────────────────────────────────────────────────

const SENSITIVE_FIELDS = ["customer_name", "customer_phone", "internal_notes", "notes"];

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 3: Ticket token grants access to exactly one order without authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * For any valid ticket token and any order associated with it,
   * the endpoint SHALL return exactly one order in the `orders` array.
   * No Authorization header is required.
   */
  it("returns exactly one order for any valid ticket token without requiring auth", async () => {
    await fc.assert(
      fc.asyncProperty(orderArb, async (order) => {
        vi.clearAllMocks();
        // Mock supabase to return this order when queried by ticket_token
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: order, error: null })
            })
          })
        });

        const event = {
          httpMethod: "GET",
          headers: {}, // No Authorization header
          queryStringParameters: { ticket_token: order.ticket_token }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);

        // Must return exactly one order in the array
        expect(body.orders).toBeDefined();
        expect(Array.isArray(body.orders)).toBe(true);
        expect(body.orders).toHaveLength(1);

        // requireAuth must NOT be called for ticket token path
        expect(requireAuth).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.3**
   *
   * For any order returned via ticket token access, the response SHALL NOT
   * contain sensitive fields: customer_name, customer_phone, internal_notes, notes.
   */
  it("response never contains sensitive fields (customer_name, customer_phone, internal_notes, notes)", async () => {
    await fc.assert(
      fc.asyncProperty(orderArb, async (order) => {
        vi.clearAllMocks();
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: order, error: null })
            })
          })
        });

        const event = {
          httpMethod: "GET",
          headers: {},
          queryStringParameters: { ticket_token: order.ticket_token }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const returnedOrder = body.orders[0];

        // None of the sensitive fields should be present
        for (const field of SENSITIVE_FIELDS) {
          expect(returnedOrder).not.toHaveProperty(field);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2, 2.3**
   *
   * For any order accessed via ticket token, the non-sensitive fields
   * (id, status, total, order_items, business_id, created_at, ticket_token)
   * SHALL be preserved in the response.
   */
  it("non-sensitive fields are preserved in the response", async () => {
    await fc.assert(
      fc.asyncProperty(orderArb, async (order) => {
        vi.clearAllMocks();
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: order, error: null })
            })
          })
        });

        const event = {
          httpMethod: "GET",
          headers: {},
          queryStringParameters: { ticket_token: order.ticket_token }
        };

        const response = await handler(event);

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        const returnedOrder = body.orders[0];

        // Non-sensitive fields must be present and correct
        expect(returnedOrder.id).toBe(order.id);
        expect(returnedOrder.status).toBe(order.status);
        expect(returnedOrder.total).toBe(order.total);
        expect(returnedOrder.business_id).toBe(order.business_id);
        expect(returnedOrder.created_at).toBe(order.created_at);
        expect(returnedOrder.ticket_token).toBe(order.ticket_token);
        expect(returnedOrder.order_items).toEqual(order.order_items);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for invalid ticket token handling.
 * Feature: security-hardening, Property 4: Invalid ticket tokens produce 404.
 *
 * **Validates: Requirements 2.4**
 *
 * Property 4: Invalid ticket tokens produce a generic 404
 * - For any string that does not match a valid ticket_token in the database
 *   (including random strings, expired tokens, or empty values), the
 *   Order_Endpoint SHALL return HTTP 404 with "Order not found".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ──────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────

/**
 * Create a fresh supabase mock that always returns no matching order.
 * This simulates the PGRST116 error (no single row found).
 */
function createNoMatchSupabaseMock() {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } })
        }))
      }))
    })),
    auth: { getUser: vi.fn() }
  };
}

let mockSupabase = createNoMatchSupabaseMock();

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
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "u1" }, role: "operator" })
}));

vi.mock("../../netlify/functions/_loyalty.js", () => ({
  getLoyaltySummary: vi.fn().mockResolvedValue({ success: false })
}));

// Rate limiter always allows — we're testing token logic, not rate limiting
vi.mock("../../netlify/functions/_rate-limiter.js", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true }))
}));

vi.mock("../../netlify/functions/_photo-storage.js", () => ({
  getSignedPhotoUrl: vi.fn(async (supabase, path) => `https://signed.url/${path}`)
}));

import { handler } from "../../netlify/functions/list-orders.js";

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Generate random strings that won't match any real ticket token */
const randomInvalidTokenArb = fc.oneof(
  // Random strings of various lengths
  fc.string({ minLength: 1, maxLength: 100 }),
  // UUID-like strings with random hex characters
  fc.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  // Short random strings
  fc.stringMatching(/^[a-zA-Z0-9]{1,64}$/),
  // Strings with special characters
  fc.stringMatching(/^[a-f0-9\-_]{1,50}$/)
);

/** Generate empty-like/unusual token values */
const emptyLikeTokenArb = fc.constantFrom(
  " ",
  "  ",
  "\t",
  "null",
  "undefined",
  "0",
  "false",
  "NaN",
  "{}",
  "[]"
);

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 4: Invalid ticket tokens produce a generic 404", () => {
  beforeEach(() => {
    // Refresh the mock so each it() block starts clean
    mockSupabase = createNoMatchSupabaseMock();
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * For any random string that does not match a valid ticket_token in the
   * database, the endpoint SHALL return HTTP 404 with "Order not found".
   */
  it("random strings that don't match any token produce 404 with 'Order not found'", async () => {
    await fc.assert(
      fc.asyncProperty(
        randomInvalidTokenArb,
        async (invalidToken) => {
          // Ensure mock returns no match for every iteration
          mockSupabase = createNoMatchSupabaseMock();

          const event = {
            httpMethod: "GET",
            headers: { "x-nf-client-connection-ip": "192.168.1.1" },
            queryStringParameters: { ticket_token: invalidToken }
          };

          const response = await handler(event);

          expect(response.statusCode).toBe(404);
          const body = JSON.parse(response.body);
          expect(body.error).toBe("Order not found");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * Empty-like token values (whitespace, "null", "undefined", etc.) also
   * produce a 404 with the generic error message, not a different error.
   */
  it("empty-like token values produce 404 with 'Order not found'", async () => {
    await fc.assert(
      fc.asyncProperty(
        emptyLikeTokenArb,
        async (emptyToken) => {
          mockSupabase = createNoMatchSupabaseMock();

          const event = {
            httpMethod: "GET",
            headers: { "x-nf-client-connection-ip": "10.0.0.1" },
            queryStringParameters: { ticket_token: emptyToken }
          };

          const response = await handler(event);

          expect(response.statusCode).toBe(404);
          const body = JSON.parse(response.body);
          expect(body.error).toBe("Order not found");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4**
   *
   * The 404 response never leaks information about whether the token format
   * is valid or not — always returns the same generic message regardless
   * of the input shape.
   */
  it("response message is always exactly 'Order not found' regardless of token shape", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(randomInvalidTokenArb, emptyLikeTokenArb),
        async (token) => {
          mockSupabase = createNoMatchSupabaseMock();

          const event = {
            httpMethod: "GET",
            headers: { "x-nf-client-connection-ip": "172.16.0.1" },
            queryStringParameters: { ticket_token: token }
          };

          const response = await handler(event);

          // Must always be exactly 404
          expect(response.statusCode).toBe(404);

          // Body must be valid JSON
          const body = JSON.parse(response.body);

          // Error message must be exactly "Order not found" — no variation
          expect(body.error).toBe("Order not found");

          // Response should NOT contain any other error details that could leak info
          expect(body).toEqual({ error: "Order not found" });
        }
      ),
      { numRuns: 100 }
    );
  });
});

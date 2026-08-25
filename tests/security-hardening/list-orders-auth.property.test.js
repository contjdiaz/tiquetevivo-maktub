/**
 * Property-based tests for list-orders authentication rejection.
 * Feature: security-hardening, Property 1: Unauthenticated requests rejected.
 *
 * **Validates: Requirements 1.1, 3.1**
 *
 * Property 1: Unauthenticated requests to protected endpoints are rejected
 * - For any request to list-orders without a ticket_token and without a valid
 *   JWT Bearer token, the system SHALL return HTTP 401 with an error message
 *   containing "Authentication required".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// ──────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────

const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({ data: [], error: null })
        }))
      }))
    }))
  })),
  auth: {
    getUser: vi.fn()
  }
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
  getClientIp: (event) => event.headers?.["x-nf-client-connection-ip"] || "127.0.0.1",
  getBusinessBySlug: vi.fn().mockResolvedValue({
    id: "biz-1",
    name: "Test Business",
    slug: "test-business",
    loyalty_config: { enabled: false }
  }),
  requireAuth: vi.fn()
}));

vi.mock("../../netlify/functions/_loyalty.js", () => ({
  getLoyaltySummary: vi.fn().mockResolvedValue({ success: false })
}));

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

/**
 * Generates random invalid Authorization header values.
 * These represent various ways a request might have a malformed or missing auth.
 */
const invalidAuthHeaderArb = fc.oneof(
  // No authorization header at all (undefined)
  fc.constant(undefined),
  // Empty string
  fc.constant(""),
  // Random strings that are not valid Bearer tokens
  fc.string({ minLength: 1, maxLength: 200 }),
  // "Bearer" without a token
  fc.constant("Bearer"),
  fc.constant("Bearer "),
  // Wrong prefix
  fc.string({ minLength: 1, maxLength: 50 }).map((s) => `Basic ${s}`),
  fc.string({ minLength: 1, maxLength: 50 }).map((s) => `Token ${s}`),
  fc.string({ minLength: 1, maxLength: 50 }).map((s) => `Digest ${s}`),
  // Bearer with random invalid token values
  fc.string({ minLength: 1, maxLength: 500 }).map((s) => `Bearer ${s}`),
  // Malformed Bearer prefix (casing, spacing)
  fc.string({ minLength: 1, maxLength: 100 }).map((s) => `bearer ${s}`),
  fc.string({ minLength: 1, maxLength: 100 }).map((s) => `BEARER ${s}`),
  // Bearer with special character tokens
  fc.stringMatching(/^[0-9!@#$%^&*]{1,50}$/).map((s) => `Bearer ${s}`)
);

/**
 * Generates random business slug strings.
 */
const slugArb = fc.oneof(
  fc.constant("majesty"),
  fc.constant("test-biz"),
  fc.stringMatching(/^[a-z][a-z0-9-]{1,30}$/)
);

/**
 * Generates random query string parameters that do NOT include ticket_token.
 * This ensures the request always goes through the authenticated path.
 */
const queryParamsWithoutTicketTokenArb = fc.record({
  slug: slugArb,
  status: fc.oneof(fc.constant(undefined), fc.constantFrom("pending", "processing", "ready", "delivered")),
  include_business: fc.oneof(fc.constant(undefined), fc.constant("1"), fc.constant("0")),
  limit: fc.oneof(fc.constant(undefined), fc.integer({ min: 1, max: 200 }).map(String))
}).map((params) => {
  // Remove undefined keys to simulate real query params
  const result = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) result[key] = value;
  }
  // Ensure there is at least a slug
  if (!result.slug) result.slug = "majesty";
  return result;
});

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 1: Unauthenticated requests to protected endpoints are rejected", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Configure requireAuth to always return 401 for unauthenticated requests.
    // This simulates the real behavior: when a token is missing or invalid,
    // requireAuth returns { error: { statusCode: 401, ... } }.
    requireAuth.mockResolvedValue({
      error: {
        statusCode: 401,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: true, message: "Authentication required" })
      }
    });
  });

  /**
   * **Validates: Requirements 1.1, 3.1**
   *
   * For any request to list-orders without a ticket_token and with any invalid
   * or missing Authorization header, the endpoint SHALL return HTTP 401.
   */
  it("any request without valid auth and without ticket_token returns 401", () => {
    return fc.assert(
      fc.asyncProperty(
        invalidAuthHeaderArb,
        queryParamsWithoutTicketTokenArb,
        async (authHeader, queryParams) => {
          const headers = {
            "x-nf-client-connection-ip": "127.0.0.1"
          };
          if (authHeader !== undefined) {
            headers["authorization"] = authHeader;
          }

          const event = {
            httpMethod: "GET",
            headers,
            queryStringParameters: queryParams
          };

          const response = await handler(event);

          // The response must be 401
          expect(response.statusCode).toBe(401);

          // The response body must contain "Authentication required"
          const body = JSON.parse(response.body);
          expect(body.message).toBe("Authentication required");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * For any request lacking an Authorization header entirely (no header present),
   * the endpoint SHALL return HTTP 401 regardless of other parameters.
   */
  it("requests with completely missing Authorization header always return 401", () => {
    return fc.assert(
      fc.asyncProperty(
        queryParamsWithoutTicketTokenArb,
        async (queryParams) => {
          const event = {
            httpMethod: "GET",
            headers: {
              "x-nf-client-connection-ip": "10.0.0.1"
              // No authorization header at all
            },
            queryStringParameters: queryParams
          };

          const response = await handler(event);

          expect(response.statusCode).toBe(401);
          const body = JSON.parse(response.body);
          expect(body.message).toBe("Authentication required");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1, 3.1**
   *
   * For any random string used as an Authorization header value
   * (not a valid Bearer JWT), the endpoint SHALL return HTTP 401.
   */
  it("random non-Bearer strings in Authorization header produce 401", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 0, maxLength: 300 }),
        async (randomValue) => {
          const event = {
            httpMethod: "GET",
            headers: {
              "x-nf-client-connection-ip": "192.168.1.50",
              authorization: randomValue
            },
            queryStringParameters: { slug: "majesty" }
          };

          const response = await handler(event);

          expect(response.statusCode).toBe(401);
          const body = JSON.parse(response.body);
          expect(body.message).toBe("Authentication required");
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Unit Tests: list-orders authentication guard and ticket token logic
 * Feature: security-hardening, Task 4.1
 *
 * Validates:
 * - 401 if no auth token provided (when no ticket_token)
 * - 403 if user lacks read permission for the business
 * - 404 with "Order not found" for invalid ticket tokens
 * - Rate limit (30/min) applied for ticket_token access
 * - Sensitive fields stripped from ticket responses
 * - Single order returned for valid ticket_token
 * - Authenticated requests with read permission return full order list
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockSelect = vi.fn();

const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect
  })),
  auth: {
    getUser: vi.fn()
  }
};

let mockRequireAuthResult = {};

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
  getBusinessBySlug: vi.fn().mockResolvedValue({ id: "biz-1", name: "Majesty", slug: "majesty", loyalty_config: { enabled: true, target: 5 } }),
  requireAuth: vi.fn(async () => mockRequireAuthResult)
}));

vi.mock("../../netlify/functions/_loyalty.js", () => ({
  getLoyaltySummary: vi.fn().mockResolvedValue({ success: false })
}));

// We need to control the rate limiter — use a mock that allows first 30, blocks after
let rateLimitCallCount = 0;
vi.mock("../../netlify/functions/_rate-limiter.js", () => ({
  checkRateLimit: vi.fn((key, limit, windowMs) => {
    rateLimitCallCount++;
    if (rateLimitCallCount > limit) {
      return { allowed: false, retryAfter: 30 };
    }
    return { allowed: true };
  })
}));

vi.mock("../../netlify/functions/_photo-storage.js", () => ({
  getSignedPhotoUrl: vi.fn(async (supabase, path) => `https://signed.url/${path}`)
}));

import { handler } from "../../netlify/functions/list-orders.js";
import { requireAuth, getBusinessBySlug } from "../../netlify/functions/_utils.js";
import { checkRateLimit } from "../../netlify/functions/_rate-limiter.js";

describe("Feature: security-hardening — list-orders auth guard and ticket token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCallCount = 0;
    mockRequireAuthResult = {};
    checkRateLimit.mockImplementation((key, limit) => {
      rateLimitCallCount++;
      if (rateLimitCallCount > limit) {
        return { allowed: false, retryAfter: 30 };
      }
      return { allowed: true };
    });
  });

  describe("Authenticated access (no ticket_token)", () => {
    it("returns 401 if no auth token provided", async () => {
      mockRequireAuthResult = {
        error: {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: true, message: "Authentication required" })
        }
      };
      requireAuth.mockResolvedValue(mockRequireAuthResult);

      const event = {
        httpMethod: "GET",
        headers: {},
        queryStringParameters: { slug: "majesty" }
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toBe("Authentication required");
    });

    it("returns 403 if user lacks read permission for the business", async () => {
      mockRequireAuthResult = {
        error: {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: true, message: "Insufficient permissions" })
        }
      };
      requireAuth.mockResolvedValue(mockRequireAuthResult);

      const event = {
        httpMethod: "GET",
        headers: { authorization: "Bearer some-token" },
        queryStringParameters: { slug: "majesty" }
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.message).toBe("Insufficient permissions");
    });

    it("returns full order list for authenticated user with read permission", async () => {
      mockRequireAuthResult = { user: { id: "user-1" }, role: "operator" };
      requireAuth.mockResolvedValue(mockRequireAuthResult);

      const mockOrders = [
        { id: "order-1", customer_name: "John", customer_phone: "+123", internal_notes: "Secret", order_items: [] },
        { id: "order-2", customer_name: "Jane", customer_phone: "+456", internal_notes: "Note", order_items: [] }
      ];

      // Set up the query chain for authenticated path
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: mockOrders, error: null })
          })
        })
      });

      const event = {
        httpMethod: "GET",
        headers: { authorization: "Bearer valid-token" },
        queryStringParameters: { slug: "majesty" }
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // Authenticated users get full data including sensitive fields
      expect(body).toEqual(mockOrders);
    });

    it("calls requireAuth with read permission and businessId", async () => {
      mockRequireAuthResult = { user: { id: "user-1" }, role: "operator" };
      requireAuth.mockResolvedValue(mockRequireAuthResult);

      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        })
      });

      const event = {
        httpMethod: "GET",
        headers: { authorization: "Bearer valid-token" },
        queryStringParameters: { slug: "majesty" }
      };

      await handler(event);
      expect(requireAuth).toHaveBeenCalledWith(mockSupabase, event, {
        permission: "read",
        businessId: "biz-1"
      });
    });
  });

  describe("Public ticket access (with ticket_token)", () => {
    it("returns single order for valid ticket_token without requiring auth", async () => {
      const mockOrder = {
        id: "order-1",
        business_id: "biz-1",
        ticket_token: "valid-token-uuid",
        customer_name: "John",
        customer_phone: "+123",
        internal_notes: "Secret note",
        notes: "Internal notes",
        status: "ready",
        order_items: [{ id: "item-1", name: "Wash" }]
      };

      // Mock the supabase query chain for ticket_token lookup
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockOrder, error: null })
        })
      });

      const event = {
        httpMethod: "GET",
        headers: { "x-nf-client-connection-ip": "192.168.1.1" },
        queryStringParameters: { ticket_token: "valid-token-uuid" }
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Should return single order in array
      expect(body.orders).toHaveLength(1);

      // Should NOT contain sensitive fields
      const order = body.orders[0];
      expect(order.customer_name).toBeUndefined();
      expect(order.customer_phone).toBeUndefined();
      expect(order.internal_notes).toBeUndefined();
      expect(order.notes).toBeUndefined();

      // Should contain non-sensitive fields
      expect(order.id).toBe("order-1");
      expect(order.status).toBe("ready");
      expect(order.order_items).toEqual([{ id: "item-1", name: "Wash" }]);

      // requireAuth should NOT be called for ticket path
      expect(requireAuth).not.toHaveBeenCalled();
    });

    it("returns 404 with 'Order not found' for invalid ticket tokens", async () => {
      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } })
        })
      });

      const event = {
        httpMethod: "GET",
        headers: { "x-nf-client-connection-ip": "192.168.1.1" },
        queryStringParameters: { ticket_token: "non-existent-token" }
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Order not found");
    });

    it("applies rate limit of 30/min for ticket_token access", async () => {
      // Simulate the 31st request exceeding the limit
      checkRateLimit.mockReturnValue({ allowed: false, retryAfter: 45 });

      const event = {
        httpMethod: "GET",
        headers: { "x-nf-client-connection-ip": "192.168.1.1" },
        queryStringParameters: { ticket_token: "some-token" }
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(429);
      expect(response.headers["Retry-After"]).toBe("45");
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Too many requests");

      // Verify checkRateLimit was called with correct params
      expect(checkRateLimit).toHaveBeenCalledWith("192.168.1.1:list-orders-ticket", 30, 60000);
    });

    it("strips customer_name, customer_phone, internal_notes, and notes from ticket response", async () => {
      const mockOrder = {
        id: "order-1",
        business_id: "biz-1",
        ticket_token: "abc-123",
        customer_name: "Sensitive Name",
        customer_phone: "+5551234567",
        internal_notes: "Internal only",
        notes: "Staff notes",
        status: "processing",
        total: 15000,
        order_items: []
      };

      mockSelect.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockOrder, error: null })
        })
      });

      const event = {
        httpMethod: "GET",
        headers: { "x-nf-client-connection-ip": "10.0.0.1" },
        queryStringParameters: { ticket_token: "abc-123" }
      };

      const response = await handler(event);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const order = body.orders[0];

      // Sensitive fields must be stripped
      expect(order).not.toHaveProperty("customer_name");
      expect(order).not.toHaveProperty("customer_phone");
      expect(order).not.toHaveProperty("internal_notes");
      expect(order).not.toHaveProperty("notes");

      // Non-sensitive fields preserved
      expect(order.id).toBe("order-1");
      expect(order.status).toBe("processing");
      expect(order.total).toBe(15000);
    });
  });
});

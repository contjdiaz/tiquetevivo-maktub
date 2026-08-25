/**
 * Unit tests for get-business-config.js field-whitelist filtering.
 * Feature: security-hardening
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 *
 * - Unauthenticated requests return only public-safe fields
 * - Authenticated requests with `read` permission return full config
 * - business_id is excluded from unauthenticated responses
 * - loyalty_config only exposes enabled and target for unauthenticated requests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll mock _utils.js entirely so the handler uses our controlled functions
vi.mock("../../netlify/functions/_utils.js", () => {
  // Create a mock supabase client that handles the verticals query
  const createMockSupabase = () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: { emoji: "🧺", name: "Laundry" } })
          })),
          single: vi.fn().mockResolvedValue({ data: { emoji: "🧺", name: "Laundry" } })
        }))
      }))
    })),
    auth: { getUser: vi.fn() }
  });

  const mockSupabaseInstance = createMockSupabase();

  return {
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
    supabaseAdmin: () => mockSupabaseInstance,
    getBusinessBySlug: vi.fn(),
    getBearerToken: vi.fn(),
    getAuthUser: vi.fn(),
    getUserBusinessRole: vi.fn(),
    hasPermission: vi.fn(),
    // Expose mock supabase for test manipulation
    __mockSupabase: mockSupabaseInstance
  };
});

// Import after mocks are set up
import { handler } from "../../netlify/functions/get-business-config.js";
import { getBusinessBySlug, getBearerToken, getAuthUser, getUserBusinessRole, hasPermission } from "../../netlify/functions/_utils.js";

// Sample full business config
const fullBusiness = {
  id: "biz-123",
  name: "Maktub Laundry",
  slug: "maktub",
  plan: "premium",
  vertical_id: "v-1",
  services_config: [{ id: "s1", name: "Wash & Fold", price: 10 }],
  custom_fields_config: [{ key: "notes", label: "Notes" }],
  status_flow_config: ["received", "washing", "ready", "delivered"],
  whatsapp_templates_config: { welcome: "Hello {{name}}" },
  loyalty_config: { enabled: true, target: 5, reward_type: "discount", reward_value: 20, message_template: "Congrats!" },
  reactivation_config: { enabled: true, threshold_days: 30, monthly_limit: 50 }
};

describe("get-business-config field-whitelist filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBusinessBySlug.mockResolvedValue(fullBusiness);
  });

  function makeEvent(options = {}) {
    return {
      httpMethod: "GET",
      queryStringParameters: { slug: "maktub" },
      headers: options.headers || {}
    };
  }

  describe("Unauthenticated requests (Requirement 4.1, 4.3)", () => {
    beforeEach(() => {
      getBearerToken.mockReturnValue(null);
      getAuthUser.mockResolvedValue(null);
    });

    it("returns only public-safe fields", async () => {
      const event = makeEvent();
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);

      // Should include public-safe fields
      expect(body).toHaveProperty("business_name", "Maktub Laundry");
      expect(body).toHaveProperty("business_slug", "maktub");
      expect(body).toHaveProperty("vertical_emoji", "🧺");
      expect(body).toHaveProperty("vertical_name", "Laundry");
      expect(body).toHaveProperty("status_flow_config");
      expect(body).toHaveProperty("custom_fields_config");
      expect(body).toHaveProperty("loyalty_config");
    });

    it("excludes business_id from response", async () => {
      const event = makeEvent();
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body).not.toHaveProperty("business_id");
    });

    it("excludes internal fields (services_config, whatsapp_templates_config, reactivation_config, plan)", async () => {
      const event = makeEvent();
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body).not.toHaveProperty("services_config");
      expect(body).not.toHaveProperty("whatsapp_templates_config");
      expect(body).not.toHaveProperty("reactivation_config");
      expect(body).not.toHaveProperty("plan");
    });

    it("loyalty_config only includes enabled and target (strips other fields)", async () => {
      const event = makeEvent();
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.loyalty_config).toEqual({ enabled: true, target: 5 });
      expect(body.loyalty_config).not.toHaveProperty("reward_type");
      expect(body.loyalty_config).not.toHaveProperty("reward_value");
      expect(body.loyalty_config).not.toHaveProperty("message_template");
    });
  });

  describe("Authenticated requests with read permission (Requirement 4.2)", () => {
    beforeEach(() => {
      getBearerToken.mockReturnValue("valid-token");
      getAuthUser.mockResolvedValue({ id: "user-1" });
      getUserBusinessRole.mockResolvedValue("owner");
      hasPermission.mockReturnValue(true);
    });

    it("returns full configuration including business_id", async () => {
      const event = makeEvent({ headers: { authorization: "Bearer valid-token" } });
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body).toHaveProperty("business_id", "biz-123");
      expect(body).toHaveProperty("business_name", "Maktub Laundry");
      expect(body).toHaveProperty("business_slug", "maktub");
      expect(body).toHaveProperty("plan", "premium");
      expect(body).toHaveProperty("services_config");
      expect(body).toHaveProperty("whatsapp_templates_config");
      expect(body).toHaveProperty("reactivation_config");
    });

    it("returns full loyalty_config with all fields", async () => {
      const event = makeEvent({ headers: { authorization: "Bearer valid-token" } });
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.loyalty_config).toEqual(fullBusiness.loyalty_config);
    });
  });

  describe("Authenticated but without read permission", () => {
    beforeEach(() => {
      getBearerToken.mockReturnValue("valid-token");
      getAuthUser.mockResolvedValue({ id: "user-1" });
      getUserBusinessRole.mockResolvedValue("viewer");
      hasPermission.mockReturnValue(false);
    });

    it("returns only public-safe fields (same as unauthenticated)", async () => {
      const event = makeEvent({ headers: { authorization: "Bearer valid-token" } });
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body).not.toHaveProperty("business_id");
      expect(body).not.toHaveProperty("services_config");
      expect(body).not.toHaveProperty("whatsapp_templates_config");
      expect(body).not.toHaveProperty("reactivation_config");
      expect(body.loyalty_config).toEqual({ enabled: true, target: 5 });
    });
  });

  describe("Edge cases", () => {
    beforeEach(() => {
      getBearerToken.mockReturnValue(null);
      getAuthUser.mockResolvedValue(null);
    });

    it("handles business with no loyalty_config gracefully", async () => {
      getBusinessBySlug.mockResolvedValue({ ...fullBusiness, loyalty_config: null });
      const event = makeEvent();
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.loyalty_config).toEqual({ enabled: true, target: 5 });
    });

    it("handles business with partial loyalty_config", async () => {
      getBusinessBySlug.mockResolvedValue({
        ...fullBusiness,
        loyalty_config: { enabled: false, target: 10, reward_type: "free_service", secret_key: "abc" }
      });
      const event = makeEvent();
      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.loyalty_config).toEqual({ enabled: false, target: 10 });
      expect(body.loyalty_config).not.toHaveProperty("reward_type");
      expect(body.loyalty_config).not.toHaveProperty("secret_key");
    });
  });
});

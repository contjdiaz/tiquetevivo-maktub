import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../netlify/functions/manage-business.js";

/**
 * Unit tests for service catalog CRUD actions in manage-business.js
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

// --- Mock Supabase ---
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();

function createMockSupabase(businessData) {
  // Reset mocks
  mockSelect.mockReset();
  mockUpdate.mockReset();
  mockSingle.mockReset();
  mockEq.mockReset();

  // Chain builder for select (business lookup)
  const selectChain = {
    eq: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: businessData, error: null })
    })
  };

  // Chain builder for update (service save)
  const updateSelectChain = {
    single: vi.fn().mockImplementation(() => {
      // Return whatever services_config was passed to update
      return Promise.resolve({
        data: { services_config: updateSelectChain._updatedConfig },
        error: null
      });
    })
  };

  const updateEqChain = {
    select: vi.fn().mockReturnValue(updateSelectChain)
  };

  const updateChain = {
    eq: vi.fn().mockImplementation(() => updateEqChain)
  };

  const fromMock = vi.fn().mockImplementation((table) => {
    return {
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockImplementation((payload) => {
        updateSelectChain._updatedConfig = payload.services_config;
        return updateChain;
      })
    };
  });

  return { from: fromMock };
}

// Mock the _utils module
vi.mock("../netlify/functions/_utils.js", () => ({
  json: (status, body) => ({ statusCode: status, body: JSON.stringify(body) }),
  parseBody: (event) => JSON.parse(event.body || "{}"),
  supabaseAdmin: vi.fn(),
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" }, role: "owner" }),
  getBearerToken: vi.fn().mockReturnValue("valid-token"),
  getAuthUser: vi.fn().mockResolvedValue({ id: "user-1" })
}));

// Mock validators
vi.mock("../netlify/functions/_validators.js", () => ({
  validatePhone: () => ({ valid: true })
}));

// Mock vertical-config
vi.mock("../netlify/functions/_vertical-config.js", () => ({
  getVerticalBySlug: vi.fn(),
  applyVerticalDefaults: vi.fn()
}));

// Get mocked supabaseAdmin
import { supabaseAdmin } from "../netlify/functions/_utils.js";

function makeEvent(body) {
  return {
    httpMethod: "POST",
    headers: { authorization: "Bearer valid-token" },
    body: JSON.stringify(body)
  };
}

describe("manage-business: add-service action", () => {
  const baseBusiness = {
    id: "biz-123",
    services_config: [
      { name: "Lavado estándar", description: "Lavado regular", default_price: 12000, duration: 180, unit: "per_kg", active: true }
    ],
    active: true
  };

  beforeEach(() => {
    supabaseAdmin.mockReturnValue(createMockSupabase(baseBusiness));
  });

  it("adds a valid service to services_config", async () => {
    const result = await handler(makeEvent({
      action: "add-service",
      business_id: "biz-123",
      service: { name: "Planchado", default_price: 5000, unit: "per_item", description: "Planchado profesional" }
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.services_config).toBeDefined();
  });

  it("rejects when service object is missing", async () => {
    const result = await handler(makeEvent({
      action: "add-service",
      business_id: "biz-123"
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("service object is required");
  });

  it("rejects when name is missing", async () => {
    const result = await handler(makeEvent({
      action: "add-service",
      business_id: "biz-123",
      service: { default_price: 5000, unit: "per_item" }
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.field).toBe("name");
  });

  it("rejects when default_price is missing", async () => {
    const result = await handler(makeEvent({
      action: "add-service",
      business_id: "biz-123",
      service: { name: "Test", unit: "per_item" }
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.field).toBe("default_price");
  });

  it("rejects when unit is invalid", async () => {
    const result = await handler(makeEvent({
      action: "add-service",
      business_id: "biz-123",
      service: { name: "Test", default_price: 1000, unit: "invalid" }
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.field).toBe("unit");
  });

  it("rejects when unit is missing", async () => {
    const result = await handler(makeEvent({
      action: "add-service",
      business_id: "biz-123",
      service: { name: "Test", default_price: 1000 }
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.field).toBe("unit");
  });
});

describe("manage-business: update-service action", () => {
  const baseBusiness = {
    id: "biz-123",
    services_config: [
      { name: "Lavado estándar", description: "Lavado regular", default_price: 12000, duration: 180, unit: "per_kg", active: true },
      { name: "Planchado", description: "Planchado simple", default_price: 5000, duration: 30, unit: "per_item", active: true }
    ],
    active: true
  };

  beforeEach(() => {
    supabaseAdmin.mockReturnValue(createMockSupabase(baseBusiness));
  });

  it("rejects when service object is missing", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      index: 0
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("service object");
  });

  it("rejects when neither index nor name is provided", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      service: { default_price: 15000 }
    }));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Must provide");
  });

  it("rejects when index is out of range", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      index: 99,
      service: { default_price: 15000 }
    }));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("not found");
  });

  it("rejects when name does not match any service", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      name: "Nonexistent",
      service: { default_price: 15000 }
    }));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Nonexistent");
  });

  it("rejects when no allowed fields are provided", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      index: 0,
      service: { random_field: "value" }
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("No fields provided");
  });

  it("rejects invalid unit value", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      index: 0,
      service: { unit: "bad_unit" }
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.field).toBe("unit");
  });

  it("rejects non-numeric default_price", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      index: 0,
      service: { default_price: "not a number" }
    }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.field).toBe("default_price");
  });

  it("updates service by index successfully", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      index: 0,
      service: { default_price: 15000 }
    }));

    expect(result.statusCode).toBe(200);
  });

  it("updates service by name (case-insensitive)", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      name: "lavado estándar",
      service: { default_price: 15000 }
    }));

    expect(result.statusCode).toBe(200);
  });
});

describe("manage-business: disable-service action", () => {
  const baseBusiness = {
    id: "biz-123",
    services_config: [
      { name: "Lavado estándar", description: "Lavado regular", default_price: 12000, duration: 180, unit: "per_kg", active: true },
      { name: "Planchado", description: "Planchado simple", default_price: 5000, duration: 30, unit: "per_item", active: true }
    ],
    active: true
  };

  beforeEach(() => {
    supabaseAdmin.mockReturnValue(createMockSupabase(baseBusiness));
  });

  it("rejects when neither index nor name provided", async () => {
    const result = await handler(makeEvent({
      action: "disable-service",
      business_id: "biz-123"
    }));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Must provide");
  });

  it("rejects when index is out of range", async () => {
    const result = await handler(makeEvent({
      action: "disable-service",
      business_id: "biz-123",
      index: 10
    }));

    expect(result.statusCode).toBe(404);
  });

  it("disables service by index successfully", async () => {
    const result = await handler(makeEvent({
      action: "disable-service",
      business_id: "biz-123",
      index: 0
    }));

    expect(result.statusCode).toBe(200);
  });

  it("disables service by name successfully", async () => {
    const result = await handler(makeEvent({
      action: "disable-service",
      business_id: "biz-123",
      name: "Planchado"
    }));

    expect(result.statusCode).toBe(200);
  });
});

describe("manage-business: action validation", () => {
  beforeEach(() => {
    supabaseAdmin.mockReturnValue(createMockSupabase({ id: "biz-123", services_config: [], active: true }));
  });

  it("accepts add-service as a valid action", async () => {
    const result = await handler(makeEvent({
      action: "add-service",
      business_id: "biz-123",
      service: { name: "Test", default_price: 1000, unit: "per_item" }
    }));

    // Should not be rejected for invalid action
    expect(result.statusCode).not.toBe(400);
  });

  it("accepts update-service as a valid action", async () => {
    const result = await handler(makeEvent({
      action: "update-service",
      business_id: "biz-123",
      index: 0,
      service: { default_price: 2000 }
    }));

    // Will be 404 because no services exist, but it's not a 400 action validation error
    expect(JSON.parse(result.body).message).not.toContain("action must be");
  });

  it("accepts disable-service as a valid action", async () => {
    const result = await handler(makeEvent({
      action: "disable-service",
      business_id: "biz-123",
      index: 0
    }));

    // Will be 404 because empty services, but not an invalid action error
    expect(JSON.parse(result.body).message).not.toContain("action must be");
  });

  it("rejects invalid action", async () => {
    const result = await handler(makeEvent({
      action: "invalid-action",
      business_id: "biz-123"
    }));

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain("action must be");
  });
});

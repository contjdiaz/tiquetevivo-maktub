/**
 * Unit Test: Digital confirmation on order delivery
 * Feature: digital-signature
 *
 * Validates that update-order stores delivery confirmation timestamp and IP when provided.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedPayload = null;
let currentBusinessPlan = "paid";

function createSupabaseMock() {
  return {
    from: (table) => {
      if (table === "businesses") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: "biz-confirm-1", slug: "majesty", name: "Majesty", active: true, plan: currentBusinessPlan },
                  error: null
                })
              )
            }))
          }))
        };
      }
      if (table === "orders") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: {
                    id: "order-confirm-123",
                    order_number: "1234",
                    customer_phone: "573102688991",
                    business_id: "biz-confirm-1",
                    status: "DELIVERED",
                    custom_fields: {}
                  },
                  error: null
                })
              )
            }))
          })),
          update: vi.fn((payload) => {
            if (!capturedPayload) capturedPayload = { ...payload };
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: { ...payload, id: "order-confirm-123", business_id: "biz-confirm-1" },
                      error: null
                    })
                  )
                }))
              }))
            };
          })
        };
      }
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: {}, error: null }))
          }))
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ data: {}, error: null }))
        }))
      };
    }
  };
}

vi.mock("../netlify/functions/_utils.js", () => ({
  supabaseAdmin: vi.fn(() => createSupabaseMock()),
  getBusinessBySlug: vi.fn().mockResolvedValue({ id: "biz-confirm-1", slug: "majesty", name: "Majesty", active: true, plan: "paid" }),
  getClientIp: vi.fn().mockReturnValue("192.168.1.200"),
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "auth-user-1" }, role: "owner" }),
  json: (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }),
  parseBody: (event) => {
    if (!event.body) return {};
    return JSON.parse(event.body);
  }
}));

vi.mock("../netlify/functions/_sheets.js", () => ({
  mirrorOrderToSheets: vi.fn().mockResolvedValue({})
}));

vi.mock("../netlify/functions/_whatsapp.js", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true, messageId: "msg-123" }),
  buildFallbackLink: vi.fn().mockReturnValue("https://wa.me/123"),
  logWhatsAppMessage: vi.fn().mockResolvedValue({})
}));

vi.mock("../netlify/functions/_vertical-config.js", () => ({
  getBusinessConfig: vi.fn().mockResolvedValue({
    id: "biz-confirm-1",
    slug: "majesty",
    name: "Majesty",
    services_config: [],
    custom_fields_config: [],
    status_flow_config: [
      { status_key: "RECEIVED", display_label: "Recibido" },
      { status_key: "IN_PROGRESS", display_label: "En proceso" },
      { status_key: "READY", display_label: "Listo" },
      { status_key: "DELIVERED", display_label: "Entregado" }
    ],
    whatsapp_templates_config: {},
    vertical: { whatsapp_templates_default: {} }
  })
}));

vi.mock("../netlify/functions/_template-engine.js", () => ({
  selectTemplate: vi.fn().mockReturnValue("Delivered message"),
  renderTemplate: vi.fn().mockReturnValue("Delivered message")
}));

import { handler } from "../netlify/functions/update-order.js";

describe("Feature: digital confirmation on order delivery", () => {
  beforeEach(() => {
    capturedPayload = null;
    currentBusinessPlan = "paid";
    vi.clearAllMocks();
  });

  it("stores intake_confirmed_at and intake_confirmed_ip when intakeConfirmed is true", async () => {
    const event = {
      httpMethod: "PUT",
      headers: { "x-forwarded-for": "10.0.0.10" },
      body: JSON.stringify({
        id: "order-confirm-123",
        business_id: "biz-confirm-1",
        intakeConfirmed: true
      })
    };

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.intake_confirmed_at).toBeDefined();
    expect(capturedPayload.intake_confirmed_ip).toBe("192.168.1.200");
    expect(body.intake_confirmed_at).toBeDefined();
  });

  it("stores delivery_confirmed_at and delivery_confirmed_ip when deliveryConfirmed is true", async () => {
    const event = {
      httpMethod: "PUT",
      headers: { "x-forwarded-for": "10.0.0.10" },
      body: JSON.stringify({
        id: "order-confirm-123",
        business_id: "biz-confirm-1",
        deliveryConfirmed: true
      })
    };

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.delivery_confirmed_at).toBeDefined();
    expect(capturedPayload.delivery_confirmed_ip).toBe("192.168.1.200");
    expect(body.delivery_confirmed_at).toBeDefined();
  });

  it("accepts deliveryConfirmed as string 'true'", async () => {
    const event = {
      httpMethod: "PUT",
      headers: {},
      body: JSON.stringify({
        id: "order-confirm-123",
        business_id: "biz-confirm-1",
        deliveryConfirmed: "true"
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    expect(capturedPayload.delivery_confirmed_at).toBeDefined();
  });

  it("does not include delivery confirmation columns when deliveryConfirmed is false", async () => {
    const event = {
      httpMethod: "PUT",
      headers: {},
      body: JSON.stringify({
        id: "order-confirm-123",
        business_id: "biz-confirm-1",
        paid: 50000,
        deliveryConfirmed: false
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    expect(capturedPayload.paid).toBe(50000);
    expect(capturedPayload.delivery_confirmed_at).toBeUndefined();
    expect(capturedPayload.delivery_confirmed_ip).toBeUndefined();
  });

  it("rejects digital confirmations for free plan businesses", async () => {
    currentBusinessPlan = "free";

    const event = {
      httpMethod: "PUT",
      headers: {},
      body: JSON.stringify({
        id: "order-confirm-123",
        business_id: "biz-confirm-1",
        deliveryConfirmed: true
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe(true);
    expect(body.message).toMatch(/paid plan/i);
  });
});

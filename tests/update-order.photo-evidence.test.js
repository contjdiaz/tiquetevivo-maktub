/**
 * Unit Test: Photo evidence on order delivery
 * Feature: photo-evidence
 *
 * Validates that update-order stores a delivery photo when provided as a base64 data URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedPayload = null;

function createSupabaseMock() {
  return {
    from: (table) => {
      if (table === "businesses") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: "biz-photo-1", slug: "majesty", name: "Majesty", active: true },
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
                    id: "order-photo-123",
                    order_number: "1234",
                    customer_phone: "573102688991",
                    business_id: "biz-photo-1",
                    status: "READY",
                    custom_fields: {}
                  },
                  error: null
                })
              )
            }))
          })),
          update: vi.fn((payload) => {
            if (!capturedPayload) {
              capturedPayload = { ...payload };
            }
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: { ...payload, id: "order-photo-123", business_id: "biz-photo-1" },
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
  getBusinessBySlug: vi.fn().mockResolvedValue({ id: "biz-photo-1", slug: "majesty", name: "Majesty", active: true }),
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
    id: "biz-photo-1",
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

describe("Feature: photo-evidence on order delivery", () => {
  beforeEach(() => {
    capturedPayload = null;
    vi.clearAllMocks();
  });

  it("stores delivery_photo_url and delivery_photo_taken_at when deliveryPhoto is provided", async () => {
    const deliveryPhoto = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ";
    const event = {
      httpMethod: "PUT",
      body: JSON.stringify({
        id: "order-photo-123",
        business_id: "biz-photo-1",
        status: "DELIVERED",
        deliveryPhoto
      })
    };

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.delivery_photo_url).toBe(deliveryPhoto);
    expect(capturedPayload.delivery_photo_taken_at).toBeDefined();
    expect(body.delivery_photo_url).toBe(deliveryPhoto);
  });

  it("rejects invalid deliveryPhoto values", async () => {
    const event = {
      httpMethod: "PUT",
      body: JSON.stringify({
        id: "order-photo-123",
        business_id: "biz-photo-1",
        status: "DELIVERED",
        deliveryPhoto: "not-a-data-url"
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe(true);
    expect(body.field).toBe("deliveryPhoto");
  });

  it("does not include delivery photo columns when no deliveryPhoto is provided", async () => {
    const event = {
      httpMethod: "PUT",
      body: JSON.stringify({
        id: "order-photo-123",
        business_id: "biz-photo-1",
        status: "DELIVERED"
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    expect(capturedPayload.delivery_photo_url).toBeUndefined();
    expect(capturedPayload.delivery_photo_taken_at).toBeUndefined();
  });
});

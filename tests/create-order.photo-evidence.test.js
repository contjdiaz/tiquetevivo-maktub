/**
 * Unit Test: Photo evidence on order creation
 * Feature: photo-evidence
 *
 * Validates that create-order stores an intake photo when provided as a base64 data URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedPayload = null;

const mockSupabase = {
  from: vi.fn((table) => ({
    insert: vi.fn((payload) => {
      if (table === "orders") capturedPayload = payload;
      return {
        select: vi.fn(() => ({
          single: vi.fn(() =>
            Promise.resolve({
              data: { id: "order-photo-123", ...payload },
              error: null
            })
          )
        }))
      };
    }),
    update: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: {}, error: null }))
    })),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    }))
  }))
};

vi.mock("../netlify/functions/_utils.js", () => ({
  supabaseAdmin: () => mockSupabase,
  getBusinessBySlug: vi.fn().mockResolvedValue({
    id: "biz-photo-1",
    slug: "majesty",
    name: "Majesty",
    phone: "573001234567",
    active: true,
    plan: "paid"
  }),
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
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: false, dryRun: true, fallbackLink: "https://wa.me/123" }),
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
      { status_key: "RECEIVED", display_label: "Recibido" }
    ],
    whatsapp_templates_config: {},
    vertical: { whatsapp_templates_default: {} }
  })
}));

vi.mock("../netlify/functions/_template-engine.js", () => ({
  selectTemplate: vi.fn().mockReturnValue("Order confirmation"),
  renderTemplate: vi.fn().mockReturnValue("Order confirmation")
}));

import { handler } from "../netlify/functions/create-order.js";

describe("Feature: photo-evidence on order creation", () => {
  beforeEach(() => {
    capturedPayload = null;
    vi.clearAllMocks();
  });

  it("stores intake_photo_url and intake_photo_taken_at when intakePhoto is provided", async () => {
    const intakePhoto = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ";
    const event = {
      httpMethod: "POST",
      body: JSON.stringify({
        businessSlug: "majesty",
        customerName: "Jimy Diaz",
        customerPhone: "573102688991",
        itemsText: "1 sabana",
        total: 25000,
        paid: 10000,
        intakePhoto
      })
    };

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(201);
    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.intake_photo_url).toBe(intakePhoto);
    expect(capturedPayload.intake_photo_taken_at).toBeDefined();
    expect(body.intake_photo_url).toBe(intakePhoto);
  });

  it("rejects invalid intakePhoto values", async () => {
    const event = {
      httpMethod: "POST",
      body: JSON.stringify({
        businessSlug: "majesty",
        customerName: "Jimy Diaz",
        customerPhone: "573102688991",
        itemsText: "1 sabana",
        total: 25000,
        paid: 10000,
        intakePhoto: "not-a-data-url"
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe(true);
    expect(body.field).toBe("intakePhoto");
  });

  it("does not include photo columns when no intakePhoto is provided", async () => {
    const event = {
      httpMethod: "POST",
      body: JSON.stringify({
        businessSlug: "majesty",
        customerName: "Jimy Diaz",
        customerPhone: "573102688991",
        itemsText: "1 sabana",
        total: 25000,
        paid: 10000
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    expect(capturedPayload.intake_photo_url).toBeUndefined();
    expect(capturedPayload.intake_photo_taken_at).toBeUndefined();
  });

  it("rejects intakePhoto for free plan businesses", async () => {
    const { getBusinessBySlug } = await import("../netlify/functions/_utils.js");
    getBusinessBySlug.mockResolvedValueOnce({
      id: "biz-free-1",
      slug: "freebiz",
      name: "Free Business",
      phone: "573001234567",
      active: true,
      plan: "free"
    });

    const event = {
      httpMethod: "POST",
      body: JSON.stringify({
        businessSlug: "freebiz",
        customerName: "Jimy Diaz",
        customerPhone: "573102688991",
        itemsText: "1 sabana",
        total: 25000,
        paid: 10000,
        intakePhoto: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ"
      })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe(true);
    expect(body.message).toMatch(/paid plan/i);
  });
});

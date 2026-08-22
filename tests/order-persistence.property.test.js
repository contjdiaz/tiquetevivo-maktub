/**
 * Property Test: Order persistence is independent of WhatsApp outcome
 * Feature: whatsapp-auto-send, Property 1: Order persistence is independent of WhatsApp outcome
 *
 * **Validates: Requirements 1.5, 3.4**
 *
 * For any valid order payload, the order is persisted in the database regardless of
 * whether the WhatsApp API call succeeds, fails, or runs in dry-run mode.
 * The order creation response always contains the full order object.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock _utils.js
vi.mock("../netlify/functions/_utils.js", () => {
  let insertedOrders = [];
  let updatedOrders = [];

  const mockSupabase = {
    from(table) {
      return {
        insert(record) {
          if (table === "orders") insertedOrders.push(record);
          return {
            select() {
              return {
                single() {
                  const orderData = {
                    id: "order-uuid-123",
                    ...record,
                    created_at: new Date().toISOString()
                  };
                  return Promise.resolve({ data: orderData, error: null });
                }
              };
            }
          };
        },
        update(record) {
          if (table === "orders") updatedOrders.push(record);
          return {
            eq() {
              return Promise.resolve({ data: record, error: null });
            }
          };
        },
        select() {
          return {
            eq() {
              return {
                single() {
                  return Promise.resolve({ data: null, error: null });
                }
              };
            }
          };
        }
      };
    },
    _getInsertedOrders() { return insertedOrders; },
    _getUpdatedOrders() { return updatedOrders; },
    _reset() { insertedOrders = []; updatedOrders = []; }
  };

  return {
    supabaseAdmin: () => mockSupabase,
    getBusinessBySlug: vi.fn().mockResolvedValue({
      id: "biz-uuid-123",
      slug: "test-biz",
      name: "Test Business",
      phone: "573001234567",
      active: true
    }),
    json: (statusCode, body) => ({
      statusCode,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }),
    parseBody: (event) => {
      if (!event.body) return {};
      return JSON.parse(event.body);
    }
  };
});

// Mock _sheets.js
vi.mock("../netlify/functions/_sheets.js", () => ({
  mirrorOrderToSheets: vi.fn().mockResolvedValue({ ok: true })
}));

// Variable to control WhatsApp behavior per test iteration
let whatsappBehavior = "success";

// Mock _whatsapp.js
vi.mock("../netlify/functions/_whatsapp.js", () => ({
  buildOrderMessage: vi.fn().mockReturnValue("Order confirmation message"),
  buildFallbackLink: vi.fn().mockReturnValue("https://wa.me/573001234567?text=test"),
  logWhatsAppMessage: vi.fn().mockResolvedValue({ data: { id: "log-id" }, error: null }),
  sendWhatsAppMessage: vi.fn().mockImplementation(async () => {
    if (whatsappBehavior === "success") {
      return { success: true, messageId: "wamid.abc123" };
    } else if (whatsappBehavior === "failure") {
      return { success: false, error: "Meta API error", fallbackLink: "https://wa.me/573001234567?text=test" };
    } else if (whatsappBehavior === "dry-run") {
      return { success: false, dryRun: true, fallbackLink: "https://wa.me/573001234567?text=test" };
    } else if (whatsappBehavior === "throw") {
      throw new Error("Network timeout");
    }
  })
}));

// Mock _vertical-config.js
vi.mock("../netlify/functions/_vertical-config.js", () => ({
  getBusinessConfig: vi.fn().mockResolvedValue({
    id: "biz-uuid-123",
    slug: "test-biz",
    name: "Test Business",
    vertical_id: "vert-uuid-1",
    services_config: [],
    custom_fields_config: [],
    status_flow_config: [
      { status_key: "RECEIVED", display_label: "Recibido" },
      { status_key: "IN_PROGRESS", display_label: "En proceso" },
      { status_key: "READY", display_label: "Listo" },
      { status_key: "DELIVERED", display_label: "Entregado" }
    ],
    whatsapp_templates_config: {},
    vertical: {
      whatsapp_templates_default: {}
    }
  }),
  getVerticalBySlug: vi.fn(),
  applyVerticalDefaults: vi.fn()
}));

// Mock _template-engine.js
vi.mock("../netlify/functions/_template-engine.js", () => ({
  selectTemplate: vi.fn().mockReturnValue("📋 *{business_name}*\n\nOrden #{order_number}\nEstado: {status_label}"),
  renderTemplate: vi.fn().mockReturnValue("Order confirmation message")
}));

// Import handler after mocks are set up
const { handler } = await import("../netlify/functions/create-order.js");
const { supabaseAdmin } = await import("../netlify/functions/_utils.js");

// Generator for valid order payloads
const validOrderPayloadArb = fc.record({
  customerName: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
  customerPhone: fc.integer({ min: 1000000000, max: 999999999999999 }).map(String),
  itemsText: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
  total: fc.integer({ min: 0, max: 9999999 }),
  paid: fc.integer({ min: 0, max: 9999999 }),
  businessSlug: fc.constant("test-biz")
});

// Generator for WhatsApp outcomes
const whatsappOutcomeArb = fc.constantFrom("success", "failure", "dry-run", "throw");

describe("Feature: whatsapp-auto-send, Property 1: Order persistence is independent of WhatsApp outcome", () => {
  beforeEach(() => {
    const supabase = supabaseAdmin();
    supabase._reset();
    vi.clearAllMocks();
  });

  it("order is always persisted regardless of WhatsApp send outcome (response is 201)", async () => {
    await fc.assert(
      fc.asyncProperty(
        validOrderPayloadArb,
        whatsappOutcomeArb,
        async (orderPayload, outcome) => {
          // Set the WhatsApp behavior for this iteration
          whatsappBehavior = outcome;

          const supabase = supabaseAdmin();
          supabase._reset();

          const event = {
            httpMethod: "POST",
            body: JSON.stringify(orderPayload)
          };

          const response = await handler(event);
          const responseBody = JSON.parse(response.body);

          // Property: the response is always 201 (order created)
          expect(response.statusCode).toBe(201);

          // Property: the response always includes order data
          expect(responseBody.customer_name).toBe(orderPayload.customerName);
          expect(responseBody.items_text).toBe(orderPayload.itemsText);
          expect(responseBody.business_id).toBe("biz-uuid-123");

          // Property: the order was persisted (insert was called)
          const insertedOrders = supabase._getInsertedOrders();
          expect(insertedOrders.length).toBe(1);
          expect(insertedOrders[0].customer_name).toBe(orderPayload.customerName);
          expect(insertedOrders[0].items_text).toBe(orderPayload.itemsText);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("response always includes order data regardless of WhatsApp outcome", async () => {
    await fc.assert(
      fc.asyncProperty(
        validOrderPayloadArb,
        whatsappOutcomeArb,
        async (orderPayload, outcome) => {
          whatsappBehavior = outcome;

          const supabase = supabaseAdmin();
          supabase._reset();

          const event = {
            httpMethod: "POST",
            body: JSON.stringify(orderPayload)
          };

          const response = await handler(event);
          const responseBody = JSON.parse(response.body);

          // Property: the response always contains the full order object
          expect(responseBody).toHaveProperty("id");
          expect(responseBody).toHaveProperty("customer_name");
          expect(responseBody).toHaveProperty("customer_phone");
          expect(responseBody).toHaveProperty("items_text");
          expect(responseBody).toHaveProperty("business_id");
          expect(responseBody).toHaveProperty("total");
          expect(responseBody).toHaveProperty("paid");
          expect(responseBody).toHaveProperty("status");

          // Property: whatsapp field is always present in the response
          expect(responseBody).toHaveProperty("whatsapp");
          expect(responseBody.whatsapp).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

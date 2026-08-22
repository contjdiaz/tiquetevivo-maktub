/**
 * Property Test: Status notifications are sent only for READY and DELIVERED
 * Feature: whatsapp-auto-send, Property 5: Status notifications are sent only for READY and DELIVERED
 *
 * **Validates: Requirements 3.1, 3.2, 3.5**
 *
 * For any status update operation, a WhatsApp notification is triggered if and only if
 * the new status is 'READY' or 'DELIVERED'. Status changes to 'RECEIVED', 'IN_PROGRESS',
 * or 'CANCELLED' produce no WhatsApp send attempt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock _utils.js
const mockSupabaseUpdate = vi.fn();
const mockSupabaseSelect = vi.fn();
const mockSupabaseSingle = vi.fn();
const mockSupabaseEq = vi.fn();
const mockSupabaseFrom = vi.fn();

const mockSupabaseClient = {
  from: mockSupabaseFrom,
};

vi.mock("../netlify/functions/_utils.js", () => ({
  supabaseAdmin: vi.fn(() => mockSupabaseClient),
  getBusinessBySlug: vi.fn(() => Promise.resolve({ id: "biz-1", slug: "majesty", name: "Majesty" })),
  json: vi.fn((statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })),
  parseBody: vi.fn((event) => {
    if (!event.body) return {};
    return JSON.parse(event.body);
  }),
}));

// Mock _whatsapp.js
const mockSendWhatsAppMessage = vi.fn();
const mockBuildFallbackLink = vi.fn(() => "https://wa.me/123?text=test");
const mockLogWhatsAppMessage = vi.fn(() => Promise.resolve({ data: {}, error: null }));

vi.mock("../netlify/functions/_whatsapp.js", () => ({
  sendWhatsAppMessage: (...args) => mockSendWhatsAppMessage(...args),
  buildFallbackLink: (...args) => mockBuildFallbackLink(...args),
  logWhatsAppMessage: (...args) => mockLogWhatsAppMessage(...args),
}));

// Mock _sheets.js
vi.mock("../netlify/functions/_sheets.js", () => ({
  mirrorOrderToSheets: vi.fn(() => Promise.resolve()),
}));

// Mock _validators.js - pass-through valid results
vi.mock("../netlify/functions/_validators.js", () => ({
  validateStatus: vi.fn((status) => {
    const allowed = ["RECEIVED", "IN_PROGRESS", "READY", "DELIVERED", "CANCELLED"];
    const upper = String(status || "").toUpperCase();
    if (allowed.includes(upper)) {
      return { valid: true, value: upper };
    }
    return { valid: false, error: `Invalid status: ${status}` };
  }),
  validateAmount: vi.fn((value, fieldName) => ({
    valid: true,
    value: Number(value),
  })),
  validateStatusTransition: vi.fn(() => ({ valid: true })),
  validateStatusInFlow: vi.fn((status, flow) => {
    const upper = String(status || "").toUpperCase();
    const match = flow.find(entry => entry.status_key.toUpperCase() === upper);
    if (match) return { valid: true, value: match.status_key };
    return { valid: false, error: `Invalid status: ${status}` };
  }),
}));

// Mock _vertical-config.js
vi.mock("../netlify/functions/_vertical-config.js", () => ({
  getBusinessConfig: vi.fn(() => Promise.resolve({
    id: "biz-1",
    slug: "majesty",
    name: "Majesty",
    vertical_id: "v-1",
    services_config: [],
    custom_fields_config: [],
    status_flow_config: [
      { status_key: "RECEIVED", display_label: "Recibido" },
      { status_key: "IN_PROGRESS", display_label: "En proceso" },
      { status_key: "READY", display_label: "Listo" },
      { status_key: "DELIVERED", display_label: "Entregado" },
    ],
    whatsapp_templates_config: {},
    vertical: {
      whatsapp_templates_default: {
        status_ready: "✅ *{business_name}*\n\nHola {customer_name}, tu orden #{order_number} está lista.",
        status_delivered: "🎉 *{business_name}*\n\nHola {customer_name}, tu orden #{order_number} ha sido entregada.",
      }
    }
  })),
}));

// Mock _template-engine.js
vi.mock("../netlify/functions/_template-engine.js", () => ({
  selectTemplate: vi.fn((triggerEvent) => {
    if (triggerEvent === "status_ready") return "Tu orden está lista.";
    if (triggerEvent === "status_delivered") return "Tu orden ha sido entregada.";
    return "Estado actualizado.";
  }),
  renderTemplate: vi.fn((template) => template),
}));

/**
 * Helper to create a supabase mock that supports table-aware queries.
 * Distinguishes between "businesses" and "orders" tables.
 */
function createSupabaseMock(orderData) {
  return (table) => {
    if (table === "businesses") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  id: "biz-1",
                  slug: "majesty",
                  name: "Majesty",
                  active: true,
                },
                error: null,
              })
            ),
          })),
        })),
      };
    }
    if (table === "orders") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  ...orderData,
                  status: "IN_PROGRESS", // current status before update
                  business_id: "biz-1",
                  custom_fields: {},
                },
                error: null,
              })
            ),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: { ...orderData, business_id: "biz-1", custom_fields: {} },
                  error: null,
                })
              ),
            })),
          })),
        })),
      };
    }
    // Default: whatsapp_messages table for logging
    return {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: {}, error: null })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      })),
    };
  };
}

describe("Feature: whatsapp-auto-send, Property 5: Status notifications are sent only for READY and DELIVERED", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup the default supabase mock chain for select (order fetch) and update operations
    mockSupabaseFrom.mockImplementation(createSupabaseMock({
      id: "order-123",
      order_number: "ORD-001",
      customer_phone: "573001234567",
      business_id: "biz-1",
      status: "READY",
    }));

    // Default sendWhatsAppMessage mock: successful send
    mockSendWhatsAppMessage.mockResolvedValue({
      success: true,
      messageId: "msg-abc123",
    });
  });

  it("when status changes to READY, sendWhatsAppMessage is called exactly once", async () => {
    /**
     * Validates: Requirements 3.1
     */
    const { handler } = await import("../netlify/functions/update-order.js");

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (orderId) => {
          vi.clearAllMocks();

          mockSupabaseFrom.mockImplementation(createSupabaseMock({
            id: orderId,
            order_number: "ORD-001",
            customer_phone: "573001234567",
            business_id: "biz-1",
            status: "READY",
          }));

          mockSendWhatsAppMessage.mockResolvedValue({
            success: true,
            messageId: "msg-abc123",
          });

          const event = {
            httpMethod: "PUT",
            body: JSON.stringify({ id: orderId, status: "READY", business_id: "biz-1" }),
          };

          await handler(event);

          // Property: sendWhatsAppMessage is called exactly once for READY
          expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1);
          expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
            expect.objectContaining({ to: "573001234567" })
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when status changes to DELIVERED, sendWhatsAppMessage is called exactly once", async () => {
    /**
     * Validates: Requirements 3.2
     */
    const { handler } = await import("../netlify/functions/update-order.js");

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (orderId) => {
          vi.clearAllMocks();

          mockSupabaseFrom.mockImplementation(createSupabaseMock({
            id: orderId,
            order_number: "ORD-002",
            customer_phone: "573009876543",
            business_id: "biz-1",
            status: "DELIVERED",
          }));

          mockSendWhatsAppMessage.mockResolvedValue({
            success: true,
            messageId: "msg-def456",
          });

          const event = {
            httpMethod: "PUT",
            body: JSON.stringify({ id: orderId, status: "DELIVERED", business_id: "biz-1" }),
          };

          await handler(event);

          // Property: sendWhatsAppMessage is called exactly once for DELIVERED
          expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1);
          expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
            expect.objectContaining({ to: "573009876543" })
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when status changes to IN_PROGRESS, sendWhatsAppMessage is NOT called", async () => {
    /**
     * Validates: Requirements 3.5
     */
    const { handler } = await import("../netlify/functions/update-order.js");

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (orderId) => {
          vi.clearAllMocks();

          mockSupabaseFrom.mockImplementation(createSupabaseMock({
            id: orderId,
            order_number: "ORD-003",
            customer_phone: "573001111111",
            business_id: "biz-1",
            status: "IN_PROGRESS",
          }));

          const event = {
            httpMethod: "PUT",
            body: JSON.stringify({ id: orderId, status: "IN_PROGRESS", business_id: "biz-1" }),
          };

          await handler(event);

          // Property: sendWhatsAppMessage is NOT called for IN_PROGRESS
          expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when status changes to CANCELLED, sendWhatsAppMessage is NOT called", async () => {
    /**
     * Validates: Requirements 3.5
     */
    const { handler } = await import("../netlify/functions/update-order.js");

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (orderId) => {
          vi.clearAllMocks();

          mockSupabaseFrom.mockImplementation(createSupabaseMock({
            id: orderId,
            order_number: "ORD-004",
            customer_phone: "573002222222",
            business_id: "biz-1",
            status: "CANCELLED",
          }));

          const event = {
            httpMethod: "PUT",
            body: JSON.stringify({ id: orderId, status: "CANCELLED", business_id: "biz-1" }),
          };

          await handler(event);

          // Property: sendWhatsAppMessage is NOT called for CANCELLED
          expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("when status changes to RECEIVED, sendWhatsAppMessage is NOT called", async () => {
    /**
     * Validates: Requirements 3.5
     */
    const { handler } = await import("../netlify/functions/update-order.js");

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (orderId) => {
          vi.clearAllMocks();

          mockSupabaseFrom.mockImplementation(createSupabaseMock({
            id: orderId,
            order_number: "ORD-005",
            customer_phone: "573003333333",
            business_id: "biz-1",
            status: "RECEIVED",
          }));

          const event = {
            httpMethod: "PUT",
            body: JSON.stringify({ id: orderId, status: "RECEIVED", business_id: "biz-1" }),
          };

          await handler(event);

          // Property: sendWhatsAppMessage is NOT called for RECEIVED
          expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any non-notifiable status, no WhatsApp message is sent (generalized property)", async () => {
    /**
     * Validates: Requirements 3.5
     *
     * Generalized property: for any status that is NOT READY or DELIVERED,
     * the handler never calls sendWhatsAppMessage.
     */
    const { handler } = await import("../netlify/functions/update-order.js");
    const NON_NOTIFIABLE = ["RECEIVED", "IN_PROGRESS", "CANCELLED"];

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(...NON_NOTIFIABLE),
        async (orderId, status) => {
          vi.clearAllMocks();

          mockSupabaseFrom.mockImplementation(createSupabaseMock({
            id: orderId,
            order_number: "ORD-GEN",
            customer_phone: "573004444444",
            business_id: "biz-1",
            status: status,
          }));

          const event = {
            httpMethod: "PUT",
            body: JSON.stringify({ id: orderId, status, business_id: "biz-1" }),
          };

          await handler(event);

          // Property: sendWhatsAppMessage is NEVER called for non-notifiable statuses
          expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any notifiable status (READY or DELIVERED), WhatsApp message is sent exactly once", async () => {
    /**
     * Validates: Requirements 3.1, 3.2
     *
     * Generalized property: for any status that IS READY or DELIVERED,
     * the handler calls sendWhatsAppMessage exactly once.
     */
    const { handler } = await import("../netlify/functions/update-order.js");
    const NOTIFIABLE = ["READY", "DELIVERED"];

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.constantFrom(...NOTIFIABLE),
        fc.integer({ min: 1000000000, max: 999999999999999 }).map(String),
        async (orderId, status, phone) => {
          vi.clearAllMocks();

          mockSupabaseFrom.mockImplementation(createSupabaseMock({
            id: orderId,
            order_number: "ORD-NOTIFY",
            customer_phone: phone,
            business_id: "biz-1",
            status: status,
          }));

          mockSendWhatsAppMessage.mockResolvedValue({
            success: true,
            messageId: "msg-prop",
          });

          const event = {
            httpMethod: "PUT",
            body: JSON.stringify({ id: orderId, status, business_id: "biz-1" }),
          };

          await handler(event);

          // Property: sendWhatsAppMessage is called exactly once for notifiable statuses
          expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1);
          // Property: the message is sent to the correct phone number
          expect(mockSendWhatsAppMessage).toHaveBeenCalledWith(
            expect.objectContaining({ to: phone })
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

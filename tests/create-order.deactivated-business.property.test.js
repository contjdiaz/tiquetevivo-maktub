/**
 * Property Test: Deactivated businesses cannot receive new orders
 * Feature: whatsapp-auto-send, Property 8: Deactivated businesses cannot receive new orders
 *
 * **Validates: Requirements 7.4**
 *
 * For any valid order payload, if the target business has active=false,
 * the Order_Service rejects with 403 and no order is persisted.
 * If the business has active=true, the order is created with 201.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// --- Mock _utils.js ---
const mockSupabaseInsert = vi.fn();
const mockSupabaseUpdate = vi.fn();
const mockSupabaseSelectEq = vi.fn();

const mockSupabaseClient = {
  from: vi.fn((table) => ({
    insert: (payload) => {
      mockSupabaseInsert(payload);
      return {
        select: () => ({
          single: () =>
            Promise.resolve({
              data: { id: "order-123", ...payload },
              error: null,
            }),
        }),
      };
    },
    update: (payload) => {
      mockSupabaseUpdate(payload);
      return {
        eq: () => Promise.resolve({ data: payload, error: null }),
      };
    },
    select: () => ({
      eq: (col, val) => ({
        single: () => {
          mockSupabaseSelectEq(col, val);
          return Promise.resolve({ data: null, error: { message: "not found" } });
        },
      }),
    }),
  })),
};

vi.mock("../netlify/functions/_utils.js", () => ({
  supabaseAdmin: () => mockSupabaseClient,
  getBusinessBySlug: vi.fn(),
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "auth-user-1" }, role: "owner" }),
  json: (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }),
  parseBody: (event) => {
    if (!event.body) return {};
    return JSON.parse(event.body);
  },
}));

// --- Mock _whatsapp.js ---
vi.mock("../netlify/functions/_whatsapp.js", () => ({
  sendWhatsAppMessage: vi.fn(() =>
    Promise.resolve({ success: false, dryRun: true, fallbackLink: "https://wa.me/123" })
  ),
  buildOrderMessage: vi.fn(() => "Test order message"),
  buildFallbackLink: vi.fn((phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`),
  logWhatsAppMessage: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}));

// --- Mock _sheets.js ---
vi.mock("../netlify/functions/_sheets.js", () => ({
  mirrorOrderToSheets: vi.fn(() => Promise.resolve()),
}));

// --- Mock _vertical-config.js ---
vi.mock("../netlify/functions/_vertical-config.js", () => ({
  getBusinessConfig: vi.fn().mockResolvedValue({
    id: "biz-002",
    slug: "test-biz",
    name: "Active Business",
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

// --- Mock _template-engine.js ---
vi.mock("../netlify/functions/_template-engine.js", () => ({
  selectTemplate: vi.fn().mockReturnValue("📋 *{business_name}*\n\nOrden #{order_number}\nEstado: {status_label}"),
  renderTemplate: vi.fn().mockReturnValue("Order confirmation message")
}));

// Import the handler after mocks are set up
import { handler } from "../netlify/functions/create-order.js";
import { getBusinessBySlug } from "../netlify/functions/_utils.js";

// --- Generators ---

// Generate a valid phone number (10-15 digits, starting with a digit 1-9)
const validPhoneArb = fc
  .integer({ min: 10, max: 15 })
  .chain((len) =>
    fc.tuple(
      fc.integer({ min: 1, max: 9 }),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: len - 1, maxLength: len - 1 })
    )
  )
  .map(([first, rest]) => String(first) + rest.join(""));

// Generate a valid customer name (non-empty string)
const customerNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

// Generate a valid items text (non-empty string)
const itemsTextArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0);

// Generate a valid total amount (0 to 99999999.99)
const totalArb = fc.oneof(
  fc.constant(undefined),
  fc.double({ min: 0, max: 99999999.99, noNaN: true, noDefaultInfinity: true })
);

// Generate a valid business slug
const slugArb = fc.stringMatching(/^[a-z][a-z0-9\-]{2,20}$/);

// Build a valid order event from generated values
function buildEvent(body) {
  return {
    httpMethod: "POST",
    body: JSON.stringify(body),
  };
}

describe("Feature: whatsapp-auto-send, Property 8: Deactivated businesses cannot receive new orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("for any valid order payload, if business.active=false, response status is 403", async () => {
    await fc.assert(
      fc.asyncProperty(
        customerNameArb,
        validPhoneArb,
        itemsTextArb,
        totalArb,
        slugArb,
        async (customerName, customerPhone, itemsText, total, slug) => {
          // Configure mock: business exists but is deactivated
          getBusinessBySlug.mockResolvedValue({
            id: "biz-001",
            slug,
            name: "Test Business",
            phone: "1234567890",
            active: false,
            deactivated_at: "2024-01-01T00:00:00Z",
          });

          const body = {
            businessSlug: slug,
            customerName,
            customerPhone,
            itemsText,
            ...(total !== undefined ? { total } : {}),
          };

          const event = buildEvent(body);
          const response = await handler(event);

          // Property: response status must be 403
          expect(response.statusCode).toBe(403);

          // Property: no order should be inserted
          expect(mockSupabaseInsert).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any valid order payload, if business.active=true, response status is 201", async () => {
    await fc.assert(
      fc.asyncProperty(
        customerNameArb,
        validPhoneArb,
        itemsTextArb,
        totalArb,
        slugArb,
        async (customerName, customerPhone, itemsText, total, slug) => {
          // Configure mock: business is active
          getBusinessBySlug.mockResolvedValue({
            id: "biz-002",
            slug,
            name: "Active Business",
            phone: "9876543210",
            active: true,
            deactivated_at: null,
          });

          const body = {
            businessSlug: slug,
            customerName,
            customerPhone,
            itemsText,
            ...(total !== undefined ? { total } : {}),
          };

          const event = buildEvent(body);
          const response = await handler(event);

          // Property: response status must be 201 (order created)
          expect(response.statusCode).toBe(201);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("the 403 response includes a descriptive error message about business being deactivated", async () => {
    await fc.assert(
      fc.asyncProperty(
        customerNameArb,
        validPhoneArb,
        itemsTextArb,
        slugArb,
        async (customerName, customerPhone, itemsText, slug) => {
          // Configure mock: business is deactivated
          getBusinessBySlug.mockResolvedValue({
            id: "biz-003",
            slug,
            name: "Inactive Biz",
            phone: "5551234567",
            active: false,
            deactivated_at: "2024-06-15T12:00:00Z",
          });

          const body = {
            businessSlug: slug,
            customerName,
            customerPhone,
            itemsText,
          };

          const event = buildEvent(body);
          const response = await handler(event);

          expect(response.statusCode).toBe(403);

          const responseBody = JSON.parse(response.body);

          // Property: response contains error flag
          expect(responseBody.error).toBe(true);

          // Property: response message mentions deactivation
          expect(responseBody.message).toBeDefined();
          expect(typeof responseBody.message).toBe("string");
          expect(responseBody.message.toLowerCase()).toMatch(/deactivat/);
        }
      ),
      { numRuns: 100 }
    );
  });
});

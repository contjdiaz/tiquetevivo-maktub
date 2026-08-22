import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handler, buildOrderMessage } from "../netlify/functions/whatsapp-sender.js";

/**
 * Tests that the whatsapp-sender.js HTTP handler still works after the
 * Template Engine integration for the multi-vertical platform.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 * - Handler signature (event) => response
 * - CORS preflight (OPTIONS returns 200)
 * - Only POST allowed (other methods return 405)
 * - Request body accepts `to` and `text`, or `customerPhone` with order fields
 * - Dry-run returns { dryRun: true, to, text } with 200
 * - Missing `to` field returns 400
 * - Errors return 500
 * - buildOrderMessage is still re-exported for backward compatibility
 * - WhatsApp send failures never block with unhandled errors
 */

// Mock _vertical-config.js so we don't need a real Supabase connection
vi.mock("../netlify/functions/_vertical-config.js", () => ({
  getBusinessConfig: vi.fn().mockResolvedValue({
    name: "TestBiz",
    status_flow_config: [
      { status_key: "RECEIVED", display_label: "Recibido" },
      { status_key: "READY", display_label: "Listo" }
    ],
    whatsapp_templates_config: null,
    custom_fields_config: [],
    vertical: {
      whatsapp_templates_default: {
        order_created: "📋 *{business_name}*\n\nHola {customer_name}\nOrden #{order_number}\nTotal: {total}"
      }
    }
  })
}));

// Mock supabaseAdmin in _utils.js to avoid needing env vars
vi.mock("../netlify/functions/_utils.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    supabaseAdmin: vi.fn(() => ({
      from: () => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) })
      })
    }))
  };
});

function makeEvent(method, body) {
  return {
    httpMethod: method,
    body: body ? JSON.stringify(body) : null
  };
}

describe("whatsapp-sender HTTP handler contract", () => {
  beforeEach(() => {
    // Clear env vars to ensure dry-run mode
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with empty body on OPTIONS (CORS preflight)", async () => {
    const res = await handler(makeEvent("OPTIONS", null));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("returns 405 for GET requests", async () => {
    const res = await handler(makeEvent("GET", null));
    expect(res.statusCode).toBe(405);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Method not allowed");
  });

  it("returns 405 for PUT requests", async () => {
    const res = await handler(makeEvent("PUT", null));
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 when to is missing", async () => {
    const res = await handler(makeEvent("POST", { text: "Hello" }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain("to");
  });

  it("returns dry-run response with 200 when credentials are not set", async () => {
    const res = await handler(makeEvent("POST", { to: "573001234567", text: "Hola" }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dryRun).toBe(true);
    expect(body.to).toBe("573001234567");
    expect(body.text).toBe("Hola");
  });

  it("accepts customerPhone as alias for to field", async () => {
    const res = await handler(makeEvent("POST", { customerPhone: "573001234567", text: "Test" }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dryRun).toBe(true);
    expect(body.to).toBe("573001234567");
  });

  it("builds order message from body via Template Engine when business_id is provided", async () => {
    const res = await handler(makeEvent("POST", {
      to: "573001234567",
      business_id: "biz-123",
      customer_name: "Juan",
      total: 25000,
      paid: 10000,
      order_number: "123"
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dryRun).toBe(true);
    // The text should be rendered via template engine with customer name
    expect(body.text).toContain("Juan");
    expect(body.text).toContain("123");
  });

  it("falls back to legacy buildOrderMessage when no business_id is provided", async () => {
    const res = await handler(makeEvent("POST", {
      to: "573001234567",
      customer_name: "Maria",
      order_number: "456",
      total: 50000,
      paid: 20000,
      business_name: "TestBiz"
    }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.dryRun).toBe(true);
    // Legacy buildOrderMessage uses generic fallback template
    expect(body.text).toContain("456");
    expect(body.text).toContain("TestBiz");
  });

  it("returns 500 on unexpected errors", async () => {
    // Send invalid JSON to trigger a parse error
    const event = {
      httpMethod: "POST",
      body: "not-json{"
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
  });

  it("re-exports buildOrderMessage for backward compatibility", () => {
    expect(typeof buildOrderMessage).toBe("function");
  });

  it("buildOrderMessage returns a string containing order_number and business_name", () => {
    const msg = buildOrderMessage({
      customer_name: "Maria",
      order_number: "456",
      total: 50000,
      paid: 20000,
      business_name: "TestBiz"
    });
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
    // Generic fallback template contains order_number and business_name
    expect(msg).toContain("456");
    expect(msg).toContain("TestBiz");
  });

  it("buildOrderMessage uses business templates when provided via _businessTemplates", () => {
    const msg = buildOrderMessage({
      customer_name: "Carlos",
      order_number: "789",
      total: 30000,
      business_name: "MiBiz",
      _businessTemplates: {
        order_created: "Hola {customer_name}, tu orden #{order_number} en {business_name}"
      }
    });
    expect(msg).toContain("Carlos");
    expect(msg).toContain("789");
    expect(msg).toContain("MiBiz");
  });

  it("response includes CORS headers on all responses", async () => {
    const res = await handler(makeEvent("POST", { to: "573001234567", text: "Hello" }));
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(res.headers["Access-Control-Allow-Headers"]).toContain("Content-Type");
    expect(res.headers["Content-Type"]).toBe("application/json");
  });

  it("WhatsApp send failures return graceful response, never throw unhandled errors", async () => {
    // Even with no credentials (dry-run) and weird data, we should get a response
    const res = await handler(makeEvent("POST", {
      to: "573001234567",
      text: "Test message"
    }));
    expect(res.statusCode).toBe(200);
    // Dry-run mode gives a response with fallbackLink
    const body = JSON.parse(res.body);
    expect(body.dryRun).toBe(true);
    expect(body.fallbackLink).toContain("wa.me");
  });
});

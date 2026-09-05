/**
 * Regression tests: public-ticket endpoint.
 *
 * Guards against the regression where the customer ticket page broke because
 * list-orders became authenticated. public-ticket must be PUBLIC (no auth),
 * return a single order by slug+number, expose payment_config, and 404 when the
 * order does not exist.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSingle = vi.fn();

// Chainable query: from().select().eq().eq().single()  (orders)
//                  from().select().eq().single()        (vertical/business)
function makeChain(resultFn) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.single = vi.fn(() => resultFn());
  return chain;
}

let ordersResult;
let verticalResult;
let approvalResult;

const mockSupabase = {
  from: vi.fn((table) => {
    if (table === "orders") return makeChain(() => ordersResult);
    if (table === "verticals") return makeChain(() => verticalResult);
    if (table === "approval_requests") return makeChain(() => approvalResult);
    return makeChain(() => ({ data: null, error: null }));
  })
};

vi.mock("../netlify/functions/_utils.js", () => ({
  supabaseAdmin: () => mockSupabase,
  json: (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }),
  getClientIp: (event) => event.headers?.["x-nf-client-connection-ip"] || "127.0.0.1",
  getBusinessBySlug: vi.fn().mockResolvedValue({
    id: "biz-1",
    name: "Taller Demo",
    slug: "demo-mechanic",
    plan: "free",
    vertical_id: "vert-1",
    loyalty_config: { enabled: false },
    payment_config: { nequi: "300 111 2233" }
  })
}));

vi.mock("../netlify/functions/_loyalty.js", () => ({
  getLoyaltySummary: vi.fn().mockResolvedValue({ success: false })
}));

let rateAllowed = true;
vi.mock("../netlify/functions/_rate-limiter.js", () => ({
  checkRateLimit: vi.fn(() => (rateAllowed ? { allowed: true } : { allowed: false, retryAfter: 30 }))
}));

vi.mock("../netlify/functions/_photo-storage.js", () => ({
  getSignedPhotoUrl: vi.fn(async (_s, path) => `https://signed.url/${path}`)
}));

import { readFileSync } from "fs";
import { resolve } from "path";
import { handler } from "../netlify/functions/public-ticket.js";

describe("public-ticket endpoint (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateAllowed = true;
    ordersResult = { data: null, error: null };
    verticalResult = { data: { emoji: "🔧" }, error: null };
    approvalResult = { data: null, error: { code: "PGRST116" } };
  });

  it("does not use auth (public by design)", () => {
    // Source-level guard: the public ticket endpoint must never call requireAuth.
    const src = readFileSync(
      resolve(process.cwd(), "netlify/functions/public-ticket.js"),
      "utf8"
    );
    expect(src).not.toMatch(/requireAuth/);
  });

  it("returns 400 when slug or number is missing", async () => {
    const res = await handler({ httpMethod: "GET", headers: {}, queryStringParameters: { slug: "demo-mechanic" } });
    expect(res.statusCode).toBe(400);
  });

  it("returns the single order + public business config for slug+number", async () => {
    ordersResult = {
      data: {
        id: "order-1",
        business_id: "biz-1",
        order_number: "1003",
        status: "READY",
        total: 30000,
        paid: 5000,
        customer_phone: "+573001234567",
        order_items: []
      },
      error: null
    };

    const res = await handler({
      httpMethod: "GET",
      headers: { "x-nf-client-connection-ip": "10.0.0.1" },
      queryStringParameters: { slug: "demo-mechanic", number: "1003" }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].order_number).toBe("1003");
    expect(body.business.slug).toBe("demo-mechanic");
    expect(body.business.vertical_emoji).toBe("🔧");
    // payment_config must be exposed for the public payment methods block
    expect(body.business.payment_config).toEqual({ nequi: "300 111 2233" });
  });

  it("includes a pending approval when present and not expired", async () => {
    ordersResult = {
      data: { id: "order-1", business_id: "biz-1", order_number: "1003", status: "IN_PROGRESS", total: 30000, paid: 0, customer_phone: "+57300", order_items: [] },
      error: null
    };
    approvalResult = {
      data: { id: "appr-1", amount: 250000, description: "Cambio de pantalla", status: "PENDING", token: "tok-1", expires_at: new Date(Date.now() + 3600_000).toISOString() },
      error: null
    };

    const res = await handler({
      httpMethod: "GET",
      headers: { "x-nf-client-connection-ip": "10.0.0.1" },
      queryStringParameters: { slug: "demo-mechanic", number: "1003" }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.approval).not.toBeNull();
    expect(body.approval.amount).toBe(250000);
    expect(body.approval.token).toBe("tok-1");
  });

  it("returns approval:null when the pending approval is expired", async () => {
    ordersResult = {
      data: { id: "order-1", business_id: "biz-1", order_number: "1003", status: "IN_PROGRESS", total: 30000, paid: 0, customer_phone: "+57300", order_items: [] },
      error: null
    };
    approvalResult = {
      data: { id: "appr-1", amount: 100, description: "x", status: "PENDING", token: "tok-1", expires_at: new Date(Date.now() - 3600_000).toISOString() },
      error: null
    };

    const res = await handler({
      httpMethod: "GET",
      headers: { "x-nf-client-connection-ip": "10.0.0.1" },
      queryStringParameters: { slug: "demo-mechanic", number: "1003" }
    });

    const body = JSON.parse(res.body);
    expect(body.approval).toBeNull();
  });

  it("returns 404 when the order does not exist", async () => {
    ordersResult = { data: null, error: { code: "PGRST116" } };

    const res = await handler({
      httpMethod: "GET",
      headers: { "x-nf-client-connection-ip": "10.0.0.1" },
      queryStringParameters: { slug: "demo-mechanic", number: "9999" }
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 429 when rate limited", async () => {
    rateAllowed = false;
    const res = await handler({
      httpMethod: "GET",
      headers: { "x-nf-client-connection-ip": "10.0.0.1" },
      queryStringParameters: { slug: "demo-mechanic", number: "1003" }
    });
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("30");
  });

  it("rejects non-GET methods", async () => {
    const res = await handler({ httpMethod: "POST", headers: {}, queryStringParameters: {} });
    expect(res.statusCode).toBe(405);
  });
});

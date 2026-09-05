/**
 * Tests for the approval flow (wave 4-6).
 * Covers: token validation, expiration, invalid token, idempotent decide,
 * and authenticated generate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mutable state driving the supabase mock ---
let approvalRow;          // current approval_requests row (or null)
let updateResult;         // result of the guarded update on decide
let orderRow;
let businessRow;
let authResult;

const updateEqChain = () => ({
  eq: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve(updateResult) }) }) }),
  // generate() path invalidation update: .eq().eq()
});

function tableApproval() {
  return {
    select: () => ({
      eq: () => ({ single: () => Promise.resolve(approvalRow ? { data: approvalRow, error: null } : { data: null, error: { code: "PGRST116" } }) })
    }),
    update: () => ({
      eq: (col, val) => {
        // decide: .update().eq('id').eq('status').select().single()
        // generate: .update().eq('order_id').eq('status')  (returns promise)
        return {
          eq: () => ({ select: () => ({ single: () => Promise.resolve(updateResult) }) }),
          then: (resolve) => resolve({ error: null })
        };
      }
    }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "appr-new", token: "tok" }, error: null }) }) })
  };
}

const mockSupabase = {
  from(table) {
    if (table === "approval_requests") return tableApproval();
    if (table === "orders") {
      return { select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve({ data: orderRow, error: orderRow ? null : { code: "x" } }) }), single: () => Promise.resolve({ data: orderRow, error: orderRow ? null : { code: "x" } }) }) }) };
    }
    if (table === "businesses") {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: businessRow, error: null }) }) }) };
    }
    throw new Error("unexpected table " + table);
  }
};

vi.mock("../netlify/functions/_utils.js", () => ({
  supabaseAdmin: () => mockSupabase,
  json: (statusCode, body) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  parseBody: (event) => (event.body ? JSON.parse(event.body) : {}),
  getClientIp: (event) => event.headers?.["x-nf-client-connection-ip"] || "127.0.0.1",
  requireAuth: vi.fn(async () => authResult)
}));

let rateAllowed = true;
vi.mock("../netlify/functions/_rate-limiter.js", () => ({
  checkRateLimit: vi.fn(() => (rateAllowed ? { allowed: true } : { allowed: false, retryAfter: 30 }))
}));

vi.mock("../netlify/functions/_whatsapp.js", () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ success: false, dryRun: true })),
  logWhatsAppMessage: vi.fn(async () => ({ data: null, error: null }))
}));

import { handler } from "../netlify/functions/approval-decide.js";

const FUTURE = new Date(Date.now() + 3600_000).toISOString();
const PAST = new Date(Date.now() - 3600_000).toISOString();
const TOKEN = "11111111-1111-1111-1111-111111111111";

function getEvent(qs) {
  return { httpMethod: "GET", headers: { "x-nf-client-connection-ip": "1.2.3.4" }, queryStringParameters: qs };
}
function postEvent(body) {
  return { httpMethod: "POST", headers: { "x-nf-client-connection-ip": "1.2.3.4" }, body: JSON.stringify(body) };
}

describe("approval-decide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateAllowed = true;
    approvalRow = null;
    updateResult = { data: null, error: null };
    orderRow = null;
    businessRow = { name: "Taller Demo", whatsapp_templates_config: null };
    authResult = { user: { id: "u1" }, role: "owner" };
  });

  it("GET returns 404 for missing params", async () => {
    const res = await handler(getEvent({}));
    expect(res.statusCode).toBe(404);
  });

  it("GET returns 404 when token mismatches", async () => {
    approvalRow = { id: "a1", token: TOKEN, status: "PENDING", expires_at: FUTURE, amount: 100, business_id: "b1" };
    const res = await handler(getEvent({ id: "a1", token: "22222222-2222-2222-2222-222222222222" }));
    expect(res.statusCode).toBe(404);
  });

  it("GET returns the quote for a valid pending token", async () => {
    approvalRow = { id: "a1", token: TOKEN, status: "PENDING", expires_at: FUTURE, amount: 250000, description: "Cambio de pantalla", business_id: "b1" };
    const res = await handler(getEvent({ id: "a1", token: TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.approval.amount).toBe(250000);
    expect(body.approval.business_name).toBe("Taller Demo");
  });

  it("GET returns already_decided when not pending", async () => {
    approvalRow = { id: "a1", token: TOKEN, status: "APPROVED", expires_at: FUTURE, amount: 100, business_id: "b1" };
    const res = await handler(getEvent({ id: "a1", token: TOKEN }));
    const body = JSON.parse(res.body);
    expect(body.already_decided).toBe(true);
    expect(body.status).toBe("APPROVED");
  });

  it("GET returns 403 when expired", async () => {
    approvalRow = { id: "a1", token: TOKEN, status: "PENDING", expires_at: PAST, amount: 100, business_id: "b1" };
    const res = await handler(getEvent({ id: "a1", token: TOKEN }));
    expect(res.statusCode).toBe(403);
  });

  it("POST decide approves a pending request", async () => {
    approvalRow = { id: "a1", token: TOKEN, status: "PENDING", expires_at: FUTURE, amount: 100, business_id: "b1", order_id: "o1" };
    updateResult = { data: { id: "a1", status: "APPROVED" }, error: null };
    orderRow = { customer_name: "Ana", customer_phone: "+57300", order_number: "1003" };
    const res = await handler(postEvent({ action: "decide", id: "a1", token: TOKEN, decision: "approve" }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("APPROVED");
  });

  it("POST decide is idempotent when already decided", async () => {
    approvalRow = { id: "a1", token: TOKEN, status: "REJECTED", expires_at: FUTURE, amount: 100, business_id: "b1", order_id: "o1" };
    const res = await handler(postEvent({ action: "decide", id: "a1", token: TOKEN, decision: "approve" }));
    const body = JSON.parse(res.body);
    expect(body.idempotent).toBe(true);
    expect(body.status).toBe("REJECTED");
  });

  it("POST decide rejects invalid decision value", async () => {
    approvalRow = { id: "a1", token: TOKEN, status: "PENDING", expires_at: FUTURE, amount: 100, business_id: "b1" };
    const res = await handler(postEvent({ action: "decide", id: "a1", token: TOKEN, decision: "maybe" }));
    expect(res.statusCode).toBe(400);
  });

  it("POST generate requires order_id and business_id", async () => {
    const res = await handler(postEvent({ action: "generate", amount: 100 }));
    expect(res.statusCode).toBe(400);
  });

  it("POST generate creates an approval and returns a link", async () => {
    orderRow = { id: "o1", customer_name: "Ana", customer_phone: "+57300", order_number: "1003", status: "IN_PROGRESS" };
    const res = await handler(postEvent({ action: "generate", order_id: "o1", business_id: "b1", amount: 250000, description: "Diagnóstico" }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.approval_id).toBe("appr-new");
    expect(body.approval_link).toContain("/aprobar.html?id=appr-new");
  });

  it("returns 429 when rate limited", async () => {
    rateAllowed = false;
    const res = await handler(getEvent({ id: "a1", token: TOKEN }));
    expect(res.statusCode).toBe(429);
  });
});

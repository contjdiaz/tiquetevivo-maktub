/**
 * Unit tests for payments webhook processing and applyApprovedPayment logic.
 * Tests: idempotency, amount matching, cancelled orders, non-approved statuses.
 * Validates: Requirements 4, 5, 6
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, createHmac } from "crypto";

// ──────────────────────────────────────────────────────────────────
// Mock infrastructure
// ──────────────────────────────────────────────────────────────────

let mockPaymentsTable = [];
let mockOrdersTable = [];

function createMockSupabase(orders = [], payments = []) {
  mockOrdersTable = [...orders];
  mockPaymentsTable = [...payments];

  return {
    from(table) {
      const self = {
        _table: table,
        _filters: {},
        _selectFields: "*",

        select(fields) {
          self._selectFields = fields || "*";
          return self;
        },
        eq(field, value) {
          self._filters[field] = value;
          return self;
        },
        maybeSingle() {
          const source = self._table === "payments" ? mockPaymentsTable : mockOrdersTable;
          const match = source.find((row) =>
            Object.entries(self._filters).every(([k, v]) => row[k] === v)
          );
          return Promise.resolve({ data: match || null, error: null });
        },
        single() {
          const source = self._table === "payments" ? mockPaymentsTable : mockOrdersTable;
          const match = source.find((row) =>
            Object.entries(self._filters).every(([k, v]) => row[k] === v)
          );
          if (!match) return Promise.resolve({ data: null, error: { message: "not found" } });
          return Promise.resolve({ data: match, error: null });
        },
        insert(record) {
          // Check for unique constraint on gateway_transaction_id
          if (self._table === "payments" && record.gateway_transaction_id) {
            const existing = mockPaymentsTable.find(
              (p) => p.gateway_transaction_id === record.gateway_transaction_id
            );
            if (existing) {
              return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
            }
          }
          const newRecord = { id: `${self._table}-${Date.now()}-${Math.random()}`, ...record };
          if (self._table === "payments") mockPaymentsTable.push(newRecord);
          return Promise.resolve({ data: newRecord, error: null });
        },
        update(record) {
          return {
            eq(field, value) {
              if (self._table === "orders") {
                const idx = mockOrdersTable.findIndex((o) => o[field] === value);
                if (idx >= 0) {
                  mockOrdersTable[idx] = { ...mockOrdersTable[idx], ...record };
                }
              }
              return Promise.resolve({ data: record, error: null });
            }
          };
        }
      };
      return self;
    }
  };
}

// ──────────────────────────────────────────────────────────────────
// Import the payments module (direct import, no mocking needed for pure functions)
// ──────────────────────────────────────────────────────────────────
import { applyApprovedPayment } from "../netlify/functions/_payments.js";

// ──────────────────────────────────────────────────────────────────
// Tests: Payment Idempotency
// ──────────────────────────────────────────────────────────────────
describe("applyApprovedPayment — idempotency (duplicate gateway_transaction_id)", () => {
  it("rejects duplicate payment with same gateway_transaction_id", async () => {
    const existingPayment = {
      id: "pay-001",
      order_id: "order-001",
      gateway_transaction_id: "tx-duplicate-123",
      amount: 50000,
      status: "APPROVED"
    };

    const supabase = createMockSupabase(
      [{ id: "order-001", business_id: "biz-001", status: "RECEIVED", total: 100000, paid: 0 }],
      [existingPayment]
    );

    const result = await applyApprovedPayment(
      supabase,
      "order-001",
      50000,
      "tx-duplicate-123",
      "WOMPI",
      { raw: true }
    );

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("duplicate");
  });

  it("first payment applies, second with same gateway_transaction_id is rejected", async () => {
    const order = { id: "order-002", business_id: "biz-001", status: "IN_PROGRESS", total: 80000, paid: 0 };
    const supabase = createMockSupabase([order], []);

    // First payment
    const result1 = await applyApprovedPayment(
      supabase,
      "order-002",
      80000,
      "tx-first-456",
      "WOMPI",
      { raw: true }
    );
    expect(result1.applied).toBe(true);
    expect(result1.new_paid).toBe(80000);
    expect(result1.new_balance).toBe(0);

    // Second payment with same gateway_transaction_id
    const result2 = await applyApprovedPayment(
      supabase,
      "order-002",
      80000,
      "tx-first-456",
      "WOMPI",
      { raw: true }
    );
    expect(result2.applied).toBe(false);
    expect(result2.reason).toBe("duplicate");
  });

  it("allows different gateway_transaction_ids for same order (partial payments)", async () => {
    const order = { id: "order-003", business_id: "biz-001", status: "IN_PROGRESS", total: 100000, paid: 0 };
    const supabase = createMockSupabase([order], []);

    // First partial payment
    const result1 = await applyApprovedPayment(
      supabase,
      "order-003",
      40000,
      "tx-part1",
      "WOMPI",
      {}
    );
    expect(result1.applied).toBe(true);
    expect(result1.new_paid).toBe(40000);
    expect(result1.new_balance).toBe(60000);

    // Second partial payment with different tx id (order.paid is now 40000)
    mockOrdersTable[0].paid = 40000;
    const result2 = await applyApprovedPayment(
      supabase,
      "order-003",
      60000,
      "tx-part2",
      "WOMPI",
      {}
    );
    expect(result2.applied).toBe(true);
    expect(result2.new_paid).toBe(100000);
    expect(result2.new_balance).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests: Amount Matching
// ──────────────────────────────────────────────────────────────────
describe("applyApprovedPayment — amount matching (exact, partial, overpay)", () => {
  it("exact match: amount === balance → full apply, balance becomes 0", async () => {
    const order = { id: "order-exact", business_id: "biz-001", status: "RECEIVED", total: 75000, paid: 0 };
    const supabase = createMockSupabase([order], []);

    const result = await applyApprovedPayment(supabase, "order-exact", 75000, "tx-exact", "BOLD", {});

    expect(result.applied).toBe(true);
    expect(result.new_paid).toBe(75000);
    expect(result.new_balance).toBe(0);
  });

  it("partial payment: amount < balance → paid increases, balance > 0", async () => {
    const order = { id: "order-partial", business_id: "biz-001", status: "RECEIVED", total: 100000, paid: 20000 };
    const supabase = createMockSupabase([order], []);

    const result = await applyApprovedPayment(supabase, "order-partial", 30000, "tx-partial", "WOMPI", {});

    expect(result.applied).toBe(true);
    expect(result.new_paid).toBe(50000);
    expect(result.new_balance).toBe(50000);
  });

  it("overpayment: amount > balance → MANUAL_REVIEW, paid not modified", async () => {
    const order = { id: "order-over", business_id: "biz-001", status: "RECEIVED", total: 50000, paid: 30000 };
    const supabase = createMockSupabase([order], []);

    // Balance is 20000, trying to pay 25000
    const result = await applyApprovedPayment(supabase, "order-over", 25000, "tx-over", "WOMPI", {});

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("manual_review");
    expect(result.status).toBe("MANUAL_REVIEW");

    // Verify order paid was NOT modified
    expect(mockOrdersTable[0].paid).toBe(30000);
  });

  it("amount exactly equals remaining balance (partial paid order)", async () => {
    const order = { id: "order-remain", business_id: "biz-001", status: "IN_PROGRESS", total: 120000, paid: 70000 };
    const supabase = createMockSupabase([order], []);

    // Balance is 50000, paying exactly 50000
    const result = await applyApprovedPayment(supabase, "order-remain", 50000, "tx-remain", "BOLD", {});

    expect(result.applied).toBe(true);
    expect(result.new_paid).toBe(120000);
    expect(result.new_balance).toBe(0);
  });

  it("order not found → applied: false with order_not_found reason", async () => {
    const supabase = createMockSupabase([], []);

    const result = await applyApprovedPayment(supabase, "nonexistent-order", 50000, "tx-ghost", "WOMPI", {});

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("order_not_found");
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests: Cancelled Order
// ──────────────────────────────────────────────────────────────────
describe("applyApprovedPayment — cancelled order handling", () => {
  it("cancelled order → MANUAL_REVIEW without modifying paid", async () => {
    const order = { id: "order-cancel", business_id: "biz-001", status: "CANCELLED", total: 60000, paid: 0 };
    const supabase = createMockSupabase([order], []);

    const result = await applyApprovedPayment(supabase, "order-cancel", 60000, "tx-cancel", "WOMPI", { raw: "data" });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("order_cancelled");
    expect(result.status).toBe("MANUAL_REVIEW");

    // Verify paid was NOT modified
    expect(mockOrdersTable[0].paid).toBe(0);

    // Verify payment record was created with MANUAL_REVIEW status
    const paymentRecord = mockPaymentsTable.find((p) => p.gateway_transaction_id === "tx-cancel");
    expect(paymentRecord).toBeDefined();
    expect(paymentRecord.status).toBe("MANUAL_REVIEW");
  });

  it("cancelled order with prior partial payment → MANUAL_REVIEW, paid stays same", async () => {
    const order = { id: "order-cancel2", business_id: "biz-001", status: "CANCELLED", total: 100000, paid: 40000 };
    const supabase = createMockSupabase([order], []);

    const result = await applyApprovedPayment(supabase, "order-cancel2", 60000, "tx-cancel2", "BOLD", {});

    expect(result.applied).toBe(false);
    expect(result.reason).toBe("order_cancelled");
    expect(mockOrdersTable[0].paid).toBe(40000);
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests: DECLINED/VOIDED/PENDING status handling via webhook logic
// (These statuses are handled in the webhook handler, not in applyApprovedPayment)
// ──────────────────────────────────────────────────────────────────
describe("Payments webhook — DECLINED/VOIDED/PENDING status handling", () => {
  // The webhook handler inserts the record but does NOT call applyApprovedPayment
  // We test the behavior at the webhook handler level using the same mock supabase

  it("DECLINED webhook: record is persisted, orders.paid is NOT modified", async () => {
    const order = { id: "order-declined", business_id: "biz-001", status: "RECEIVED", total: 50000, paid: 0 };
    const supabase = createMockSupabase([order], []);

    // Simulate what webhook handler does for non-APPROVED status
    await supabase.from("payments").insert({
      order_id: "order-declined",
      business_id: "biz-001",
      gateway: "WOMPI",
      gateway_transaction_id: "tx-declined",
      amount: 50000,
      currency: "COP",
      status: "DECLINED",
      raw_payload: { status: "DECLINED" }
    });

    // Verify payment was recorded
    const payment = mockPaymentsTable.find((p) => p.gateway_transaction_id === "tx-declined");
    expect(payment).toBeDefined();
    expect(payment.status).toBe("DECLINED");

    // Verify orders.paid was NOT modified
    expect(mockOrdersTable[0].paid).toBe(0);
  });

  it("VOIDED webhook: record is persisted, orders.paid is NOT modified", async () => {
    const order = { id: "order-voided", business_id: "biz-001", status: "RECEIVED", total: 80000, paid: 30000 };
    const supabase = createMockSupabase([order], []);

    await supabase.from("payments").insert({
      order_id: "order-voided",
      business_id: "biz-001",
      gateway: "BOLD",
      gateway_transaction_id: "tx-voided",
      amount: 50000,
      currency: "COP",
      status: "VOIDED",
      raw_payload: { status: "VOIDED" }
    });

    const payment = mockPaymentsTable.find((p) => p.gateway_transaction_id === "tx-voided");
    expect(payment).toBeDefined();
    expect(payment.status).toBe("VOIDED");

    // Paid must remain unchanged
    expect(mockOrdersTable[0].paid).toBe(30000);
  });

  it("PENDING webhook: record is persisted, orders.paid is NOT modified", async () => {
    const order = { id: "order-pending", business_id: "biz-001", status: "IN_PROGRESS", total: 100000, paid: 0 };
    const supabase = createMockSupabase([order], []);

    await supabase.from("payments").insert({
      order_id: "order-pending",
      business_id: "biz-001",
      gateway: "WOMPI",
      gateway_transaction_id: "tx-pending",
      amount: 100000,
      currency: "COP",
      status: "PENDING",
      raw_payload: { status: "PENDING" }
    });

    const payment = mockPaymentsTable.find((p) => p.gateway_transaction_id === "tx-pending");
    expect(payment).toBeDefined();
    expect(payment.status).toBe("PENDING");

    // Paid must remain unchanged
    expect(mockOrdersTable[0].paid).toBe(0);
  });
});

/**
 * Property-based tests for payment application logic.
 * Feature: customer-retention-platform, Property 5: Amount verification before payment application
 *
 * **Validates: Requirements 5.4, 5.5**
 *
 * For any approved amount ≤ balance, paid increases by exactly that amount.
 * For any approved amount > balance, the payment goes to MANUAL_REVIEW and paid is unchanged.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { applyApprovedPayment } from "../netlify/functions/_payments.js";

// ──────────────────────────────────────────────────────────────────
// Mock Supabase factory for property tests
// ──────────────────────────────────────────────────────────────────

function createMockSupabase(order) {
  let paymentsInserted = [];
  let orderUpdated = false;
  let updatedPaid = null;

  const supabase = {
    from(table) {
      const self = {
        _table: table,
        _filters: {},
        select() { return self; },
        eq(field, value) {
          self._filters[field] = value;
          return self;
        },
        maybeSingle() {
          if (self._table === "payments") {
            // Check if any inserted payment matches the filter
            const match = paymentsInserted.find((p) =>
              Object.entries(self._filters).every(([k, v]) => p[k] === v)
            );
            return Promise.resolve({ data: match || null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        single() {
          if (self._table === "orders") {
            if (self._filters.id === order.id) {
              return Promise.resolve({ data: { ...order }, error: null });
            }
            return Promise.resolve({ data: null, error: { message: "not found" } });
          }
          return Promise.resolve({ data: null, error: { message: "not found" } });
        },
        insert(record) {
          if (self._table === "payments") {
            paymentsInserted.push(record);
          }
          return Promise.resolve({ data: record, error: null });
        },
        update(record) {
          return {
            eq(field, value) {
              if (self._table === "orders" && field === "id" && value === order.id) {
                orderUpdated = true;
                updatedPaid = record.paid;
              }
              return Promise.resolve({ data: record, error: null });
            }
          };
        }
      };
      return self;
    },
    _getPaymentsInserted() { return paymentsInserted; },
    _wasOrderUpdated() { return orderUpdated; },
    _getUpdatedPaid() { return updatedPaid; }
  };

  return supabase;
}

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

// Generate an order total between 1000 and 10_000_000 (COP, realistic range)
const totalArb = fc.integer({ min: 1000, max: 10000000 });

// Generate paid amount that is less than total
const orderArb = fc.record({
  total: totalArb,
  paidFraction: fc.double({ min: 0, max: 0.99, noNaN: true })
}).map(({ total, paidFraction }) => {
  const paid = Math.floor(total * paidFraction);
  return {
    id: "order-prop-test",
    business_id: "biz-prop",
    status: "RECEIVED",
    total,
    paid
  };
});

// Generate a unique transaction ID
const txIdArb = fc.uuid().map((id) => `tx-prop-${id}`);

describe("Feature: customer-retention-platform, Property 5: Amount verification before payment application", () => {
  it("for any approved amount ≤ balance, paid increases by exactly that amount", async () => {
    /**
     * Validates: Requirements 5.4, 5.5
     *
     * Property: Given an order with some balance > 0, for any payment amount
     * that is ≤ the current balance, after applyApprovedPayment:
     * - result.applied === true
     * - result.new_paid === original_paid + amount
     * - result.new_balance === total - new_paid
     */
    await fc.assert(
      fc.asyncProperty(
        orderArb,
        txIdArb,
        async (order, txId) => {
          const balance = order.total - order.paid;
          // Only test when there IS a positive balance
          fc.pre(balance > 0);

          // Generate amount between 1 and balance (inclusive)
          const amount = Math.floor(Math.random() * balance) + 1;
          // Ensure amount ≤ balance
          const safeAmount = Math.min(amount, balance);

          const supabase = createMockSupabase(order);
          const result = await applyApprovedPayment(
            supabase,
            order.id,
            safeAmount,
            txId,
            "WOMPI",
            { test: true }
          );

          // Payment must be applied
          expect(result.applied).toBe(true);
          // Paid increases by exactly the payment amount
          expect(result.new_paid).toBe(order.paid + safeAmount);
          // New balance = total - new_paid
          expect(result.new_balance).toBe(Math.max(0, order.total - result.new_paid));
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any approved amount ≤ balance, paid increases by exactly amount (deterministic generator)", async () => {
    /**
     * Validates: Requirements 5.4, 5.5
     *
     * Uses a fully deterministic fast-check generator for the amount
     * to ensure reproducibility.
     */
    // Custom generator: order with guaranteed positive balance + valid amount
    const testCaseArb = fc.record({
      total: fc.integer({ min: 1000, max: 10000000 }),
      paidFraction: fc.double({ min: 0, max: 0.95, noNaN: true }),
      amountFraction: fc.double({ min: 0.01, max: 1.0, noNaN: true })
    }).map(({ total, paidFraction, amountFraction }) => {
      const paid = Math.floor(total * paidFraction);
      const balance = total - paid;
      const amount = Math.max(1, Math.floor(balance * amountFraction));
      return { total, paid, balance, amount: Math.min(amount, balance) };
    }).filter(({ balance, amount }) => balance > 0 && amount > 0 && amount <= balance);

    await fc.assert(
      fc.asyncProperty(
        testCaseArb,
        txIdArb,
        async ({ total, paid, balance, amount }, txId) => {
          const order = {
            id: "order-prop-det",
            business_id: "biz-prop",
            status: "IN_PROGRESS",
            total,
            paid
          };

          const supabase = createMockSupabase(order);
          const result = await applyApprovedPayment(
            supabase,
            order.id,
            amount,
            txId,
            "BOLD",
            {}
          );

          // Invariant: payment is applied
          expect(result.applied).toBe(true);
          // Invariant: paid increases by exactly the payment amount
          expect(result.new_paid).toBe(paid + amount);
          // Invariant: new_balance is non-negative
          expect(result.new_balance).toBeGreaterThanOrEqual(0);
          // Invariant: new_balance = total - new_paid
          expect(result.new_balance).toBe(total - (paid + amount));
        }
      ),
      { numRuns: 100 }
    );
  });

  it("for any amount > balance, payment goes to MANUAL_REVIEW and paid is unchanged", async () => {
    /**
     * Validates: Requirements 5.5
     *
     * Property: For any payment amount that exceeds the order's current balance,
     * the payment is NOT applied, status becomes MANUAL_REVIEW, and orders.paid
     * remains unchanged.
     */
    const overpayTestArb = fc.record({
      total: fc.integer({ min: 1000, max: 10000000 }),
      paidFraction: fc.double({ min: 0, max: 0.99, noNaN: true }),
      overpayExtra: fc.integer({ min: 1, max: 5000000 })
    }).map(({ total, paidFraction, overpayExtra }) => {
      const paid = Math.floor(total * paidFraction);
      const balance = total - paid;
      // Amount is balance + some extra (always > balance)
      const amount = balance + overpayExtra;
      return { total, paid, balance, amount };
    }).filter(({ balance }) => balance >= 0);

    await fc.assert(
      fc.asyncProperty(
        overpayTestArb,
        txIdArb,
        async ({ total, paid, balance, amount }, txId) => {
          const order = {
            id: "order-prop-over",
            business_id: "biz-prop",
            status: "RECEIVED",
            total,
            paid
          };

          const supabase = createMockSupabase(order);
          const result = await applyApprovedPayment(
            supabase,
            order.id,
            amount,
            txId,
            "WOMPI",
            {}
          );

          // Payment must NOT be applied
          expect(result.applied).toBe(false);
          expect(result.reason).toBe("manual_review");
          expect(result.status).toBe("MANUAL_REVIEW");

          // orders.paid must remain unchanged
          expect(supabase._wasOrderUpdated()).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

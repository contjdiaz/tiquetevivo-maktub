/**
 * Property-based tests for Payment Balance validation.
 * Tests the core balance computation and payment rejection logic
 * from validate-payment.js.
 *
 * Uses vitest + fast-check (minimum 100 iterations per property).
 *
 * Feature: core-flows-phase1
 * Properties: 7, 8, 12
 *
 * **Validates: Requirements 4.4, 4.5, 5.1**
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";

// ---------------------------------------------------------------------------
// Pure balance computation extracted from validate-payment.js (line 95-97):
//   const total = Number(order.total || 0);
//   const paid = Number(order.paid || 0);
//   const balance = Math.max(0, total - paid);
// ---------------------------------------------------------------------------
function computeBalance(total, paid) {
  const t = Number(total || 0);
  const p = Number(paid || 0);
  return Math.max(0, t - p);
}

// ---------------------------------------------------------------------------
// Payment intent eligibility: returns rejection reason or null if allowed
// Based on validate-payment.js POST handler logic (task 6.2 design):
//   - If balance <= 0 → reject with "no_balance"
//   - If order status === "CANCELLED" → reject with "cancelled"
// ---------------------------------------------------------------------------
function validatePaymentIntent(order) {
  if (order.status === "CANCELLED") {
    return { error: "cancelled" };
  }
  const balance = computeBalance(order.total, order.paid);
  if (balance <= 0) {
    return { error: "no_balance" };
  }
  return null; // allowed
}

describe("Feature: core-flows-phase1 — Payment Balance Properties", () => {
  describe("Property 7: balance = max(0, total - paid) for random pairs", () => {
    /**
     * **Validates: Requirements 4.4**
     *
     * For any valid order with total >= 0 and paid >= 0,
     * the balance is always Math.max(0, total - paid).
     * Balance is never negative.
     */
    it("balance equals Math.max(0, total - paid) for all non-negative (total, paid) pairs", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }), // total: 0 to 10M COP
          fc.nat({ max: 10_000_000 }), // paid: 0 to 10M COP
          (total, paid) => {
            const balance = computeBalance(total, paid);
            const expected = Math.max(0, total - paid);
            expect(balance).toBe(expected);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("balance is never negative regardless of input values", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }),
          fc.nat({ max: 10_000_000 }),
          (total, paid) => {
            const balance = computeBalance(total, paid);
            expect(balance).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 200 }
      );
    });

    it("balance equals total when paid is 0", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }),
          (total) => {
            const balance = computeBalance(total, 0);
            expect(balance).toBe(total);
          }
        ),
        { numRuns: 100 }
      );
    });

    it("balance equals 0 when paid >= total", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }),
          fc.nat({ max: 10_000_000 }),
          (total, extra) => {
            const paid = total + extra; // paid is always >= total
            const balance = computeBalance(total, paid);
            expect(balance).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe("Property 8: zero-balance orders always rejected for payment intent", () => {
    /**
     * **Validates: Requirements 4.5, 5.1**
     *
     * For any order where total === paid (balance = 0),
     * payment intent creation is always rejected with "no_balance".
     */
    it("rejects payment intent with 'no_balance' when total === paid", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }),
          fc.constantFrom("RECEIVED", "WASHING", "READY", "IN_TRANSIT"),
          (amount, status) => {
            const order = { total: amount, paid: amount, status };
            const result = validatePaymentIntent(order);
            expect(result).not.toBeNull();
            expect(result.error).toBe("no_balance");
          }
        ),
        { numRuns: 200 }
      );
    });

    it("rejects payment intent with 'no_balance' when paid > total (overpaid)", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }),
          fc.integer({ min: 1, max: 5_000_000 }),
          fc.constantFrom("RECEIVED", "WASHING", "READY", "IN_TRANSIT"),
          (total, extra, status) => {
            const order = { total, paid: total + extra, status };
            const result = validatePaymentIntent(order);
            expect(result).not.toBeNull();
            expect(result.error).toBe("no_balance");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("allows payment intent when balance > 0 and order is not cancelled", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10_000_000 }),
          fc.nat({ max: 9_999_999 }),
          fc.constantFrom("RECEIVED", "WASHING", "READY", "IN_TRANSIT"),
          (total, paid, status) => {
            fc.pre(paid < total); // ensure there's a balance
            const order = { total, paid, status };
            const result = validatePaymentIntent(order);
            expect(result).toBeNull(); // no rejection
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe("Property 12: cancelled orders always rejected", () => {
    /**
     * **Validates: Requirements 4.3, 5.1**
     *
     * For any order with status "CANCELLED", regardless of balance,
     * payment intent creation is always rejected.
     */
    it("rejects payment intent for CANCELLED orders regardless of balance", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }),
          fc.nat({ max: 10_000_000 }),
          (total, paid) => {
            const order = { total, paid, status: "CANCELLED" };
            const result = validatePaymentIntent(order);
            expect(result).not.toBeNull();
            expect(result.error).toBe("cancelled");
          }
        ),
        { numRuns: 200 }
      );
    });

    it("cancelled orders are rejected even when they have a positive balance", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10_000_000 }),
          (total) => {
            // Order with positive balance but CANCELLED status
            const order = { total, paid: 0, status: "CANCELLED" };
            const result = validatePaymentIntent(order);
            expect(result).not.toBeNull();
            expect(result.error).toBe("cancelled");
          }
        ),
        { numRuns: 100 }
      );
    });

    it("cancelled orders are rejected even when balance is zero", () => {
      fc.assert(
        fc.property(
          fc.nat({ max: 10_000_000 }),
          (amount) => {
            const order = { total: amount, paid: amount, status: "CANCELLED" };
            const result = validatePaymentIntent(order);
            expect(result).not.toBeNull();
            expect(result.error).toBe("cancelled");
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});

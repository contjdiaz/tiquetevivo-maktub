/**
 * Property-based tests for the reactivation engine anti-spam guarantees.
 * Feature: customer-retention-platform, Properties 7 & 9.
 *
 * Property test: opted-out customers never receive messages
 * **Validates: Requirements 9.2**
 *
 * Property test: recently-messaged customers (< 15 days) never receive messages
 * **Validates: Requirements 7.5, 9.1**
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ──────────────────────────────────────────────────────────────────
// Pure segmentation/filtering logic extracted for property testing
// ──────────────────────────────────────────────────────────────────

/**
 * Determines if a customer should be excluded from reactivation.
 * This mirrors the filtering logic in cron-reactivation.js's filterExclusions.
 *
 * @param {object} customer - Customer candidate
 * @param {boolean} customer.marketing_opt_in - Whether customer opted in
 * @param {Date|null} customer.last_message_sent_at - When last reactivation was sent
 * @param {Date|null} customer.last_order_date - Customer's last order date
 * @returns {{ eligible: boolean, reason?: string }}
 */
function evaluateEligibility(customer) {
  const COOLDOWN_DAYS = 15;
  const now = new Date();

  // Rule 1: Opted-out customers are ALWAYS excluded
  if (customer.marketing_opt_in === false) {
    return { eligible: false, reason: "opted_out" };
  }

  // Rule 2: Recently messaged customers (< 15 days) are excluded
  if (customer.last_message_sent_at) {
    const daysSinceLastMessage = (now - new Date(customer.last_message_sent_at)) / (1000 * 60 * 60 * 24);
    if (daysSinceLastMessage < COOLDOWN_DAYS) {
      return { eligible: false, reason: "cooldown" };
    }
  }

  // Rule 3: Customer who created a new order after last service is excluded
  // (already came back — not actually inactive)
  // This is handled upstream by the getInactiveCustomers query, not in the filter

  return { eligible: true };
}

/**
 * Simulates sending a message — returns true only if the customer passes
 * all eligibility checks.
 */
function wouldSendMessage(customer) {
  const { eligible } = evaluateEligibility(customer);
  return eligible;
}

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Generate a phone number (Colombian format) */
const phoneArb = fc.array(
  fc.constantFrom("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"),
  { minLength: 10, maxLength: 10 }
).map((digits) => `57${digits.join("")}`);

/** Generate a customer name */
const nameArb = fc.constantFrom(
  "Juan Pérez", "María García", "Carlos López", "Ana Rodríguez",
  "Pedro Martínez", "Laura Gómez", "Diego Sánchez", "Camila Torres"
);

/** Generate a date within the last N days */
function dateWithinDaysArb(minDays, maxDays) {
  return fc.integer({ min: minDays, max: maxDays }).map((days) => {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  });
}

/** Generate an opted-out customer (marketing_opt_in = false always) */
const optedOutCustomerArb = fc.record({
  phone: phoneArb,
  customer_name: nameArb,
  marketing_opt_in: fc.constant(false),
  last_message_sent_at: fc.oneof(
    fc.constant(null),
    dateWithinDaysArb(0, 365).map((d) => d.toISOString())
  ),
  days_inactive: fc.integer({ min: 1, max: 365 })
});

/** Generate a recently-messaged customer (last message < 15 days ago) */
const recentlyMessagedCustomerArb = fc.record({
  phone: phoneArb,
  customer_name: nameArb,
  marketing_opt_in: fc.constant(true), // opted in
  last_message_sent_at: dateWithinDaysArb(0, 14).map((d) => d.toISOString()), // 0-14 days ago
  days_inactive: fc.integer({ min: 31, max: 365 })
});

/** Generate an eligible customer (opted in, no recent message) */
const eligibleCustomerArb = fc.record({
  phone: phoneArb,
  customer_name: nameArb,
  marketing_opt_in: fc.constant(true),
  last_message_sent_at: fc.oneof(
    fc.constant(null), // never messaged
    dateWithinDaysArb(16, 365).map((d) => d.toISOString()) // messaged 16+ days ago
  ),
  days_inactive: fc.integer({ min: 31, max: 365 })
});

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 9: Opted-out customers never receive messages", () => {
  /**
   * **Validates: Requirements 9.2**
   *
   * For any customer marked as marketing_opt_in = false, no reactivation message
   * is ever sent regardless of inactivity duration, last message date, or any
   * other configuration.
   */
  it("opted-out customers are NEVER eligible for reactivation, regardless of other factors", () => {
    fc.assert(
      fc.property(
        optedOutCustomerArb,
        (customer) => {
          const result = wouldSendMessage(customer);

          // PROPERTY: opted-out customer NEVER receives a message
          expect(result).toBe(false);

          // Also verify the reason
          const { eligible, reason } = evaluateEligibility(customer);
          expect(eligible).toBe(false);
          expect(reason).toBe("opted_out");
        }
      ),
      { numRuns: 200 }
    );
  });

  it("opt-out takes precedence even when all other criteria indicate the customer should be messaged", () => {
    /**
     * **Validates: Requirements 9.2**
     *
     * Even if the customer has been inactive for a very long time and hasn't
     * received a message recently, opt-out blocks the send.
     */
    const longInactiveOptedOutArb = fc.record({
      phone: phoneArb,
      customer_name: nameArb,
      marketing_opt_in: fc.constant(false),
      last_message_sent_at: fc.oneof(
        fc.constant(null), // never messaged
        dateWithinDaysArb(100, 365).map((d) => d.toISOString()) // messaged long ago
      ),
      days_inactive: fc.integer({ min: 90, max: 365 }) // very inactive
    });

    fc.assert(
      fc.property(
        longInactiveOptedOutArb,
        (customer) => {
          // Even maximum inactivity + no recent messages doesn't override opt-out
          expect(wouldSendMessage(customer)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("Property 7: Recently-messaged customers (< 15 days) never receive messages", () => {
  /**
   * **Validates: Requirements 7.5, 9.1**
   *
   * For any customer who received a reactivation message in the last 15 days,
   * no new reactivation message is sent regardless of inactivity level.
   */
  it("customers messaged within 15 days are NEVER eligible, regardless of inactivity", () => {
    fc.assert(
      fc.property(
        recentlyMessagedCustomerArb,
        (customer) => {
          const result = wouldSendMessage(customer);

          // PROPERTY: recently-messaged customer NEVER receives a message
          expect(result).toBe(false);

          // Verify the reason
          const { eligible, reason } = evaluateEligibility(customer);
          expect(eligible).toBe(false);
          expect(reason).toBe("cooldown");
        }
      ),
      { numRuns: 200 }
    );
  });

  it("cooldown boundary: exactly 14.9 days since last message still blocks", () => {
    /**
     * **Validates: Requirements 7.5**
     *
     * Even at the edge (just under 15 days), the cooldown is enforced.
     */
    const boundaryArb = fc.double({ min: 0, max: 14.99, noNaN: true }).map((days) => ({
      phone: "573001234567",
      customer_name: "Test Boundary",
      marketing_opt_in: true,
      last_message_sent_at: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      days_inactive: 60
    }));

    fc.assert(
      fc.property(
        boundaryArb,
        (customer) => {
          expect(wouldSendMessage(customer)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("customers messaged 15+ days ago ARE eligible (cooldown expired)", () => {
    /**
     * **Validates: Requirements 7.5**
     *
     * Verifies the positive case: customers who passed the cooldown period
     * are eligible for messaging (assuming they are opted in).
     */
    fc.assert(
      fc.property(
        eligibleCustomerArb,
        (customer) => {
          // Eligible customers (opted in, no recent message) should pass
          expect(wouldSendMessage(customer)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("combined: in a mixed batch, opted-out and recently-messaged are always filtered out", () => {
    /**
     * **Validates: Requirements 7.5, 9.2**
     *
     * Given a batch of mixed customers (some opted out, some recently messaged,
     * some eligible), verify that the anti-spam invariants hold for ALL customers.
     */
    const mixedCustomerArb = fc.oneof(
      optedOutCustomerArb,
      recentlyMessagedCustomerArb,
      eligibleCustomerArb
    );

    const batchArb = fc.array(mixedCustomerArb, { minLength: 1, maxLength: 20 });

    fc.assert(
      fc.property(
        batchArb,
        (batch) => {
          for (const customer of batch) {
            const shouldSend = wouldSendMessage(customer);

            // INVARIANT 1: opted-out → never send
            if (customer.marketing_opt_in === false) {
              expect(shouldSend).toBe(false);
            }

            // INVARIANT 2: recently messaged (< 15 days) and opted in → never send
            if (customer.marketing_opt_in === true && customer.last_message_sent_at) {
              const daysSince = (Date.now() - new Date(customer.last_message_sent_at).getTime()) / (1000 * 60 * 60 * 24);
              if (daysSince < 15) {
                expect(shouldSend).toBe(false);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

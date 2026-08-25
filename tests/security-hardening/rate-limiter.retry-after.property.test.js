/**
 * Property-based test for rate limiter Retry-After header.
 * Feature: security-hardening, Property 10: Rate limit response includes Retry-After header
 *
 * **Validates: Requirements 7.4**
 *
 * For any rate-limited response (when allowed === false), the response SHALL include
 * a retryAfter value that is a positive integer representing seconds until the next
 * allowed request.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { checkRateLimit } from "../../netlify/functions/_rate-limiter.js";

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

// Generate a rate limit between 1 and 100 (realistic endpoint limits)
const limitArb = fc.integer({ min: 1, max: 100 });

// Generate a time window between 1000ms (1s) and 300000ms (5min)
const windowMsArb = fc.integer({ min: 1000, max: 300000 });

// Generate unique key strings (simulating ip:endpoint format)
const keyArb = fc.tuple(
  fc.ipV4(),
  fc.constantFrom("payments-webhook", "validate-coupon", "list-orders")
).map(([ip, endpoint]) => `${ip}:${endpoint}`);

// Generate a number of excess requests (how many over the limit)
const excessArb = fc.integer({ min: 1, max: 50 });

describe("Feature: security-hardening, Property 10: Rate limit response includes Retry-After header", () => {
  it("for any rate-limited response, retryAfter is a positive integer", () => {
    /**
     * Validates: Requirements 7.4
     *
     * Property: Given any valid key, limit, and window configuration,
     * when requests exceed the limit within the window, the returned
     * retryAfter value MUST be:
     * 1. A number (not undefined)
     * 2. A positive integer (> 0)
     * 3. Less than or equal to the window size in seconds (cannot exceed window)
     */
    fc.assert(
      fc.property(
        keyArb,
        limitArb,
        windowMsArb,
        excessArb,
        (key, limit, windowMs, excess) => {
          // Make enough requests to exhaust the limit
          for (let i = 0; i < limit; i++) {
            const result = checkRateLimit(key, limit, windowMs);
            expect(result.allowed).toBe(true);
          }

          // Now make excess requests — all should be rate-limited
          for (let i = 0; i < excess; i++) {
            const result = checkRateLimit(key, limit, windowMs);

            // Must be blocked
            expect(result.allowed).toBe(false);

            // retryAfter MUST exist
            expect(result.retryAfter).toBeDefined();

            // retryAfter MUST be a number
            expect(typeof result.retryAfter).toBe("number");

            // retryAfter MUST be a positive integer (> 0)
            expect(result.retryAfter).toBeGreaterThan(0);
            expect(Number.isInteger(result.retryAfter)).toBe(true);

            // retryAfter MUST NOT exceed the window duration in seconds
            const maxRetryAfter = Math.ceil(windowMs / 1000);
            expect(result.retryAfter).toBeLessThanOrEqual(maxRetryAfter);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

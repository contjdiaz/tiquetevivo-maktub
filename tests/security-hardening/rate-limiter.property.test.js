/**
 * Property-based tests for the rate limiter module.
 * Feature: security-hardening, Property 9: Rate limiter enforcement.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.5**
 *
 * Property 9: Rate limiter enforces per-IP limits
 * - For any rate-limited endpoint, when a single IP sends more requests than
 *   the configured limit within a 60-second window, the system SHALL return
 *   blocked for all excess requests.
 * - Requests from different IPs SHALL be tracked independently.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { checkRateLimit } from "../../netlify/functions/_rate-limiter.js";

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Reset the rate limiter's internal store between tests.
 * Since the store is module-level, we need to exhaust/expire windows
 * or use unique keys per test run.
 */
function uniqueKey(base) {
  return `${base}:${Date.now()}:${Math.random()}`;
}

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Generate an IP address */
const ipArb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 255 })
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

/** Generate a rate limit value (realistic range for our endpoints) */
const limitArb = fc.integer({ min: 1, max: 100 });

/** Generate endpoint names matching the configured endpoints */
const endpointArb = fc.constantFrom(
  "payments-webhook",
  "validate-coupon",
  "list-orders"
);

/** Generate a number of requests that exceeds a given limit */
function excessRequestCountArb(limit) {
  return fc.integer({ min: limit + 1, max: limit + 50 });
}

/** Generate a burst size (number of requests from same IP) */
const burstSizeArb = fc.integer({ min: 2, max: 80 });

/** Generate multiple distinct IPs */
const distinctIpsArb = fc.uniqueArray(ipArb, { minLength: 2, maxLength: 10 });

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 9: Rate limiter enforces per-IP limits", () => {
  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * For any rate-limited endpoint with a configured limit, when a single IP
   * sends more requests than the limit within the window, ALL excess requests
   * must be blocked (allowed: false).
   */
  it("all requests within limit are allowed, all excess requests are blocked", () => {
    fc.assert(
      fc.property(
        ipArb,
        endpointArb,
        limitArb,
        (ip, endpoint, limit) => {
          // Use a unique key to avoid interference between test iterations
          const baseKey = uniqueKey(`${ip}:${endpoint}`);
          const totalRequests = limit + 10; // send 10 excess

          const results = [];
          for (let i = 0; i < totalRequests; i++) {
            results.push(checkRateLimit(baseKey, limit));
          }

          // First `limit` requests should all be allowed
          for (let i = 0; i < limit; i++) {
            expect(results[i].allowed).toBe(true);
          }

          // All excess requests (limit+1 through total) should be blocked
          for (let i = limit; i < totalRequests; i++) {
            expect(results[i].allowed).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * Requests from different IPs are tracked independently. One IP exceeding
   * the limit does NOT affect another IP's allowance.
   */
  it("different IPs are tracked independently — one IP being rate-limited does not block another", () => {
    fc.assert(
      fc.property(
        distinctIpsArb,
        endpointArb,
        limitArb,
        (ips, endpoint, limit) => {
          // Each IP gets its own unique key for this test run
          const keyPrefix = uniqueKey(endpoint);

          for (const ip of ips) {
            const key = `${ip}:${keyPrefix}`;

            // Send exactly `limit` requests from each IP — all should be allowed
            for (let i = 0; i < limit; i++) {
              const result = checkRateLimit(key, limit);
              expect(result.allowed).toBe(true);
            }
          }

          // Now exhaust one IP (first IP sends one more request)
          const exhaustedKey = `${ips[0]}:${keyPrefix}`;
          const exhaustedResult = checkRateLimit(exhaustedKey, limit);
          expect(exhaustedResult.allowed).toBe(false);

          // Other IPs should still have their own counters unaffected
          // They already used all `limit` requests, so the next should fail independently
          for (let i = 1; i < ips.length; i++) {
            const otherKey = `${ips[i]}:${keyPrefix}`;
            const otherResult = checkRateLimit(otherKey, limit);
            // This should also be false because they used their limit too
            expect(otherResult.allowed).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * The exact count of allowed requests equals the configured limit.
   * No more, no less.
   */
  it("exactly `limit` requests are allowed per window — not one more", () => {
    fc.assert(
      fc.property(
        ipArb,
        burstSizeArb,
        (ip, burstSize) => {
          const limit = Math.max(1, Math.floor(burstSize / 2)); // limit is always less than burst
          const key = uniqueKey(`${ip}:exactcount`);

          let allowedCount = 0;
          let blockedCount = 0;

          for (let i = 0; i < burstSize; i++) {
            const result = checkRateLimit(key, limit);
            if (result.allowed) {
              allowedCount++;
            } else {
              blockedCount++;
            }
          }

          // Exactly `limit` requests should be allowed
          expect(allowedCount).toBe(limit);
          // The rest should be blocked
          expect(blockedCount).toBe(burstSize - limit);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.5**
   *
   * Independent tracking: filling up one key does not affect an unrelated key.
   * Even with the same IP but different endpoints, limits are independent.
   */
  it("same IP on different endpoints has independent limits", () => {
    fc.assert(
      fc.property(
        ipArb,
        limitArb,
        (ip, limit) => {
          const endpoint1Key = uniqueKey(`${ip}:payments-webhook`);
          const endpoint2Key = uniqueKey(`${ip}:validate-coupon`);

          // Exhaust limit on endpoint 1
          for (let i = 0; i < limit; i++) {
            checkRateLimit(endpoint1Key, limit);
          }
          // Endpoint 1 should now be blocked
          expect(checkRateLimit(endpoint1Key, limit).allowed).toBe(false);

          // Endpoint 2 should still be fully available
          for (let i = 0; i < limit; i++) {
            const result = checkRateLimit(endpoint2Key, limit);
            expect(result.allowed).toBe(true);
          }
          // And now endpoint 2 should also be blocked at limit+1
          expect(checkRateLimit(endpoint2Key, limit).allowed).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * Once blocked, the rate limiter returns retryAfter as a positive number
   * indicating seconds remaining in the current window.
   */
  it("blocked requests have a positive retryAfter value", () => {
    fc.assert(
      fc.property(
        ipArb,
        endpointArb,
        limitArb,
        (ip, endpoint, limit) => {
          const key = uniqueKey(`${ip}:${endpoint}`);

          // Exhaust the limit
          for (let i = 0; i < limit; i++) {
            checkRateLimit(key, limit);
          }

          // Next request should be blocked with a positive retryAfter
          const result = checkRateLimit(key, limit);
          expect(result.allowed).toBe(false);
          expect(result.retryAfter).toBeGreaterThan(0);
          expect(Number.isInteger(result.retryAfter)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property-based tests for Delivery Token logic.
 *
 * Property 9: expires_at = created_at + 2h exactly
 * Property 10: used tokens always return already_delivered
 *
 * Validates: Requirements 7.1, 7.6, 9.4, 9.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Token logic helpers (extracted from expected delivery-confirm behavior) ---

const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 7200000 ms

// Valid timestamp range as epoch ms (2020-01-01 to 2030-12-31)
const MIN_TS = new Date('2020-01-01T00:00:00Z').getTime();
const MAX_TS = new Date('2030-12-31T23:59:59Z').getTime();

// Arbitrary that generates valid timestamps as epoch milliseconds
const timestampMsArb = fc.integer({ min: MIN_TS, max: MAX_TS });

/**
 * Computes expires_at from a created_at timestamp.
 * This is the logic the delivery-confirm generate-token action uses.
 */
function computeExpiresAt(createdAtMs) {
  return createdAtMs + TWO_HOURS_MS;
}

/**
 * Validates a delivery token record and returns the response shape.
 * Simulates the GET /api/delivery-confirm token validation logic.
 *
 * @param {object} tokenRecord - The delivery token row from Supabase
 * @param {string} tokenRecord.token - The UUID token
 * @param {string} tokenRecord.order_id - The associated order ID
 * @param {string} tokenRecord.expires_at - ISO timestamp of expiry
 * @param {string|null} tokenRecord.used_at - ISO timestamp if used, null otherwise
 * @param {string|null} tokenRecord.invalidated_at - ISO timestamp if invalidated
 * @param {number} nowMs - Current time in epoch ms
 * @returns {object} Validation result
 */
function validateDeliveryToken(tokenRecord, nowMs) {
  // If token has been used, always return already_delivered
  if (tokenRecord.used_at) {
    return { already_delivered: true };
  }

  // If token is expired
  if (new Date(tokenRecord.expires_at).getTime() < nowMs) {
    return { error: 'token_expired', status: 403 };
  }

  // Token is valid
  return { valid: true };
}

// --- Property Tests ---

describe('Feature: core-flows-phase1, Property 9: expires_at = created_at + 2h exactly', () => {
  it('for any created_at timestamp, expires_at is always created_at + 7200000 ms', () => {
    /**
     * Validates: Requirements 7.1, 7.6
     *
     * For any valid created_at timestamp, the computed expires_at must be
     * exactly 2 hours (7200000 milliseconds) after created_at.
     * This guarantees delivery tokens have a consistent 2-hour lifespan.
     */
    fc.assert(
      fc.property(timestampMsArb, (createdAtMs) => {
        const expiresAtMs = computeExpiresAt(createdAtMs);
        const diffMs = expiresAtMs - createdAtMs;

        // Must be exactly 2 hours difference
        expect(diffMs).toBe(TWO_HOURS_MS);
      }),
      { numRuns: 200 }
    );
  });

  it('tokens created at any time are expired exactly after 2 hours pass', () => {
    /**
     * Validates: Requirements 7.1, 7.6
     *
     * For any created_at, if the current time is 1ms past expires_at,
     * the token should be considered expired.
     * If the current time is exactly at expires_at - 1ms, it should still be valid.
     */
    fc.assert(
      fc.property(timestampMsArb, (createdAtMs) => {
        const expiresAtMs = computeExpiresAt(createdAtMs);
        const expiresAtIso = new Date(expiresAtMs).toISOString();
        const tokenRecord = {
          token: 'test-token',
          order_id: 'test-order',
          expires_at: expiresAtIso,
          used_at: null,
          invalidated_at: null
        };

        // 1ms past expiry → expired
        const expiredResult = validateDeliveryToken(tokenRecord, expiresAtMs + 1);
        expect(expiredResult.error).toBe('token_expired');
        expect(expiredResult.status).toBe(403);

        // 1ms before expiry → still valid
        const validResult = validateDeliveryToken(tokenRecord, expiresAtMs - 1);
        expect(validResult.valid).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});

describe('Feature: core-flows-phase1, Property 10: used tokens always return already_delivered', () => {
  it('any token with used_at set (non-null) returns { already_delivered: true }', () => {
    /**
     * Validates: Requirements 9.4, 9.5
     *
     * For any delivery token where used_at is non-null (meaning the delivery
     * was already confirmed), the validation must always return
     * { already_delivered: true }, regardless of expiry or other fields.
     */
    const usedTokenArb = fc.record({
      token: fc.uuid(),
      order_id: fc.uuid(),
      expires_at: timestampMsArb.map(ms => new Date(ms).toISOString()),
      used_at: timestampMsArb.map(ms => new Date(ms).toISOString()),
      invalidated_at: fc.oneof(
        fc.constant(null),
        timestampMsArb.map(ms => new Date(ms).toISOString())
      )
    });

    // Current time can be anything — used tokens are always already_delivered
    fc.assert(
      fc.property(usedTokenArb, timestampMsArb, (tokenRecord, nowMs) => {
        const result = validateDeliveryToken(tokenRecord, nowMs);
        expect(result.already_delivered).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('used tokens return already_delivered even if token is also expired', () => {
    /**
     * Validates: Requirements 9.4, 9.5
     *
     * The used_at check takes precedence over expiration.
     * Even if a token has expired AND has been used, the response should
     * still be { already_delivered: true }, not { error: "token_expired" }.
     */
    const expiredUsedTokenArb = timestampMsArb.chain((createdAtMs) => {
      const expiresAtMs = createdAtMs + TWO_HOURS_MS;
      // used_at is some time between created_at and expires_at
      return fc.integer({ min: createdAtMs, max: expiresAtMs }).chain((usedAtMs) =>
        fc.record({
          token: fc.uuid(),
          order_id: fc.uuid(),
          expires_at: fc.constant(new Date(expiresAtMs).toISOString()),
          used_at: fc.constant(new Date(usedAtMs).toISOString()),
          invalidated_at: fc.constant(null)
        })
      );
    });

    fc.assert(
      fc.property(expiredUsedTokenArb, (tokenRecord) => {
        // Set "now" to well past the expiry (token is both used AND expired)
        const expiresAtTime = new Date(tokenRecord.expires_at).getTime();
        const nowMs = expiresAtTime + 60000; // 1 minute past expiry

        const result = validateDeliveryToken(tokenRecord, nowMs);
        // used_at takes precedence — should return already_delivered, not token_expired
        expect(result.already_delivered).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});

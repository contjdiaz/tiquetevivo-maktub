/**
 * Property-based tests for OTP verification, rate limiting, and invalidation.
 * Feature: core-flows-phase1
 *
 * **Validates: Requirements 2.4, 2.5, 2.6, 2.7, 2.8**
 *
 * Properties tested:
 * - Property 3: Expired OTPs are never accepted
 * - Property 4: OTP locks after 3 failed attempts
 * - Property 5: New OTP invalidates previous unexpired OTP for same phone+business
 * - Property 15: OTP rate limit prevents brute-force (3 per 15 minutes per phone)
 */

import { describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { verifyOTP, storeOTP, checkOTPRateLimit } from "../../netlify/functions/_otp.js";

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Generate a valid 6-digit OTP code (string, preserving leading zeros) */
const otpCodeArb = fc
  .integer({ min: 0, max: 999999 })
  .map((n) => String(n).padStart(6, "0"));

/** Generate a phone number (7-15 digits) */
const phoneArb = fc.stringMatching(/^[0-9]{7,15}$/);

/** Generate a UUID-like business ID */
const businessIdArb = fc.uuid();

/** Generate a past timestamp (1 second to 30 days ago) */
const pastTimestampArb = fc
  .integer({ min: 1000, max: 30 * 24 * 60 * 60 * 1000 })
  .map((msAgo) => new Date(Date.now() - msAgo).toISOString());

/** Generate attempts count >= 3 (locked state) */
const lockedAttemptsArb = fc.integer({ min: 3, max: 100 });

/** Generate attempts count < 3 (not locked) */
const validAttemptsArb = fc.integer({ min: 0, max: 2 });

/** Generate a future expiry timestamp */
const futureTimestampArb = fc
  .integer({ min: 1000, max: 5 * 60 * 1000 })
  .map((msAhead) => new Date(Date.now() + msAhead).toISOString());

/** Generate a rate limit count >= 3 (exceeded) */
const exceededCountArb = fc.integer({ min: 3, max: 100 });

/** Generate a TTL in minutes */
const ttlArb = fc.integer({ min: 1, max: 60 });

// ──────────────────────────────────────────────────────────────────
// Mock Helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Creates a mock Supabase client for verifyOTP.
 * The actual code does:
 *   supabase.from("otp_codes").select("*").eq(..).eq(..).is(..).is(..).order(..).limit(..).single()
 *   supabase.from("otp_codes").update({..}).eq("id", ...)
 */
function createVerifyMockSupabase(otpRecord) {
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: otpRecord,
      error: otpRecord ? null : { message: "not found" }
    })
  };

  const updateChain = {
    eq: vi.fn().mockResolvedValue({ error: null })
  };

  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain),
      update: vi.fn().mockReturnValue(updateChain)
    })
  };
}

/**
 * Creates a mock Supabase client for storeOTP.
 * The actual code calls from() twice:
 *   1st: supabase.from("otp_codes").update({invalidated_at:...}).eq(..).eq(..).is(..).is(..)
 *   2nd: supabase.from("otp_codes").insert({...})
 */
function createStoreMockSupabase() {
  const updateCalls = [];
  const insertCalls = [];
  const callOrder = [];

  // Build the update chain: .update(data).eq(..).eq(..).is(..).is(..)
  // Each method in the chain returns an object with the next methods
  function makeUpdateChain(data) {
    callOrder.push("update");
    updateCalls.push(data);
    const chain = {
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      then: undefined // make it thenable as resolved promise
    };
    // Make the final .is() call return a resolved promise (awaitable)
    // Actually storeOTP awaits the whole chain, so we need it to be thenable
    // The supabase client returns a PromiseLike at the end of the chain
    const thenable = Promise.resolve({ error: null });
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.is = vi.fn().mockReturnValue(chain);
    chain.then = thenable.then.bind(thenable);
    chain.catch = thenable.catch.bind(thenable);
    return chain;
  }

  // Build insert mock
  function makeInsertResult(data) {
    callOrder.push("insert");
    insertCalls.push(data);
    return { error: null };
  }

  const fromMock = vi.fn().mockReturnValue({
    update: vi.fn((data) => makeUpdateChain(data)),
    insert: vi.fn((data) => makeInsertResult(data))
  });

  return {
    from: fromMock,
    _updateCalls: updateCalls,
    _insertCalls: insertCalls,
    _callOrder: callOrder
  };
}

/**
 * Creates a mock Supabase client for checkOTPRateLimit.
 * The actual code does:
 *   supabase.from("otp_codes").select("*", { count: "exact", head: true }).eq(..).eq(..).gte(..)
 */
function createRateLimitMockSupabase(count) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockResolvedValue({ count, error: null })
          })
        })
      })
    })
  };
}

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 3: Expired OTPs are never accepted", () => {
  /**
   * **Validates: Requirements 2.6**
   *
   * For any OTP code where expires_at is in the past, verification always
   * returns { valid: false, expired: true } regardless of whether the
   * submitted code matches the stored code.
   */
  it("expired OTPs always return { valid: false, expired: true } even with correct code", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        otpCodeArb,
        pastTimestampArb,
        validAttemptsArb,
        async (phone, businessId, code, pastExpiry, attempts) => {
          const otpRecord = {
            id: "otp-expired-test",
            code,
            attempts,
            max_attempts: 3,
            expires_at: pastExpiry
          };

          const supabase = createVerifyMockSupabase(otpRecord);
          const result = await verifyOTP(supabase, { phone, businessId, code });

          expect(result.valid).toBe(false);
          expect(result.expired).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.6**
   *
   * Expired check takes priority over code comparison — expired OTPs are
   * rejected even with wrong codes (no attempt increment).
   */
  it("expired OTPs rejected before checking code correctness", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        otpCodeArb,
        otpCodeArb,
        pastTimestampArb,
        async (phone, businessId, storedCode, submittedCode, pastExpiry) => {
          const otpRecord = {
            id: "otp-expired-wrong",
            code: storedCode,
            attempts: 0,
            max_attempts: 3,
            expires_at: pastExpiry
          };

          const supabase = createVerifyMockSupabase(otpRecord);
          const result = await verifyOTP(supabase, { phone, businessId, code: submittedCode });

          expect(result.valid).toBe(false);
          expect(result.expired).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 4: OTP locks after 3 failed attempts", () => {
  /**
   * **Validates: Requirements 2.4, 2.5**
   *
   * For any OTP instance where attempts >= max_attempts (3), all subsequent
   * verification attempts are rejected with { valid: false, locked: true },
   * including the correct code.
   */
  it("OTPs with attempts >= 3 always return { valid: false, locked: true }", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        otpCodeArb,
        lockedAttemptsArb,
        futureTimestampArb,
        async (phone, businessId, code, attempts, futureExpiry) => {
          const otpRecord = {
            id: "otp-locked-test",
            code,
            attempts,
            max_attempts: 3,
            expires_at: futureExpiry
          };

          const supabase = createVerifyMockSupabase(otpRecord);
          // Submit the CORRECT code — should still be rejected as locked
          const result = await verifyOTP(supabase, { phone, businessId, code });

          expect(result.valid).toBe(false);
          expect(result.locked).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.4, 2.5**
   *
   * Locked status check occurs before code comparison — even wrong codes
   * get the locked response (not remainingAttempts).
   */
  it("locked OTPs reject incorrect codes with locked status, not remainingAttempts", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        otpCodeArb,
        otpCodeArb,
        lockedAttemptsArb,
        futureTimestampArb,
        async (phone, businessId, storedCode, submittedCode, attempts, futureExpiry) => {
          const otpRecord = {
            id: "otp-locked-wrong",
            code: storedCode,
            attempts,
            max_attempts: 3,
            expires_at: futureExpiry
          };

          const supabase = createVerifyMockSupabase(otpRecord);
          const result = await verifyOTP(supabase, { phone, businessId, code: submittedCode });

          expect(result.valid).toBe(false);
          expect(result.locked).toBe(true);
          expect(result.remainingAttempts).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 5: New OTP invalidates previous unexpired OTP", () => {
  /**
   * **Validates: Requirements 2.8**
   *
   * For any phone+businessId combination, calling storeOTP triggers an
   * invalidation update (setting invalidated_at) on existing records
   * before inserting the new OTP.
   */
  it("storeOTP always issues an invalidation update before inserting new code", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        otpCodeArb,
        ttlArb,
        async (phone, businessId, code, ttlMinutes) => {
          const mockSupabase = createStoreMockSupabase();

          const result = await storeOTP(mockSupabase, { phone, businessId, code, ttlMinutes });

          expect(result.success).toBe(true);

          // An invalidation update must have been issued
          expect(mockSupabase._updateCalls.length).toBeGreaterThanOrEqual(1);
          // The update sets invalidated_at to a valid ISO string
          expect(mockSupabase._updateCalls[0]).toHaveProperty("invalidated_at");
          expect(typeof mockSupabase._updateCalls[0].invalidated_at).toBe("string");

          // A new OTP must have been inserted
          expect(mockSupabase._insertCalls.length).toBe(1);
          expect(mockSupabase._insertCalls[0].code).toBe(code);
          expect(mockSupabase._insertCalls[0].phone).toBe(phone);
          expect(mockSupabase._insertCalls[0].business_id).toBe(businessId);

          // Update (invalidation) must happen before insert
          expect(mockSupabase._callOrder[0]).toBe("update");
          expect(mockSupabase._callOrder[1]).toBe("insert");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.8**
   *
   * The newly inserted OTP has a valid expires_at in the future
   * (approximately now + ttlMinutes).
   */
  it("new OTP always has expires_at set to approximately now + ttlMinutes", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        otpCodeArb,
        ttlArb,
        async (phone, businessId, code, ttlMinutes) => {
          const mockSupabase = createStoreMockSupabase();
          const beforeCall = Date.now();

          const result = await storeOTP(mockSupabase, { phone, businessId, code, ttlMinutes });

          expect(result.success).toBe(true);
          expect(mockSupabase._insertCalls.length).toBe(1);

          const expiresAt = new Date(mockSupabase._insertCalls[0].expires_at).getTime();
          const expectedMin = beforeCall + ttlMinutes * 60 * 1000 - 2000; // 2s tolerance
          const expectedMax = beforeCall + ttlMinutes * 60 * 1000 + 2000;

          expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
          expect(expiresAt).toBeLessThanOrEqual(expectedMax);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Property 15: OTP rate limit prevents brute-force (3 per 15 minutes)", () => {
  /**
   * **Validates: Requirements 2.7**
   *
   * For any phone+businessId when the count of OTPs created in the last 15
   * minutes is >= 3, checkOTPRateLimit returns { allowed: false }.
   */
  it("rate limit exceeded (count >= 3) always returns { allowed: false }", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        exceededCountArb,
        async (phone, businessId, count) => {
          const supabase = createRateLimitMockSupabase(count);
          const result = await checkOTPRateLimit(supabase, phone, businessId);

          expect(result.allowed).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * For any phone+businessId when the count of OTPs created in the last 15
   * minutes is < 3, checkOTPRateLimit returns { allowed: true }.
   */
  it("rate limit not exceeded (count < 3) always returns { allowed: true }", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        fc.integer({ min: 0, max: 2 }),
        async (phone, businessId, count) => {
          const supabase = createRateLimitMockSupabase(count);
          const result = await checkOTPRateLimit(supabase, phone, businessId);

          expect(result.allowed).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.7**
   *
   * The boundary case: exactly 3 requests means the limit is exceeded.
   */
  it("exactly 3 OTPs in window means rate limit is exceeded", async () => {
    await fc.assert(
      fc.asyncProperty(
        phoneArb,
        businessIdArb,
        async (phone, businessId) => {
          const supabase = createRateLimitMockSupabase(3);
          const result = await checkOTPRateLimit(supabase, phone, businessId);

          expect(result.allowed).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});

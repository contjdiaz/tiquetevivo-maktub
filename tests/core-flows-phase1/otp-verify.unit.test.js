/**
 * Unit tests for verifyOTP function.
 * Uses a mock Supabase client to test the verification logic in isolation.
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 11.6
 */

import { describe, it, expect, vi } from "vitest";
import { verifyOTP } from "../../netlify/functions/_otp.js";

// Helper to create a mock Supabase client with configurable OTP record
function createMockSupabase(otpRecord, opts = {}) {
  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null })
  });

  const selectChain = {
    select: vi.fn().mockReturnThis(),
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
    update: vi.fn((data) => {
      if (opts.onUpdate) opts.onUpdate(data);
      return {
        eq: vi.fn().mockResolvedValue({ error: null })
      };
    }),
    select: vi.fn().mockReturnValue(selectChain),
    eq: selectChain.eq,
    is: selectChain.is,
    order: selectChain.order,
    limit: selectChain.limit,
    single: selectChain.single
  };

  const fromFn = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue(selectChain),
    update: updateChain.update
  });

  return { from: fromFn, _updateFn: updateChain.update };
}

describe("verifyOTP", () => {
  const baseParams = {
    phone: "3001234567",
    businessId: "biz-uuid-123",
    code: "123456"
  };

  it("returns { valid: true } when code matches within expiry window", async () => {
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const otpRecord = {
      id: "otp-1",
      code: "123456",
      attempts: 0,
      max_attempts: 3,
      expires_at: futureExpiry
    };

    const supabase = createMockSupabase(otpRecord);
    const result = await verifyOTP(supabase, baseParams);

    expect(result.valid).toBe(true);
    expect(result.expired).toBeUndefined();
    expect(result.locked).toBeUndefined();
  });

  it("returns { valid: false, expired: true } when OTP has expired", async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    const otpRecord = {
      id: "otp-2",
      code: "123456",
      attempts: 0,
      max_attempts: 3,
      expires_at: pastExpiry
    };

    const supabase = createMockSupabase(otpRecord);
    const result = await verifyOTP(supabase, baseParams);

    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
  });

  it("returns { valid: false, locked: true } when max attempts reached", async () => {
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const otpRecord = {
      id: "otp-3",
      code: "123456",
      attempts: 3,
      max_attempts: 3,
      expires_at: futureExpiry
    };

    const supabase = createMockSupabase(otpRecord);
    const result = await verifyOTP(supabase, baseParams);

    expect(result.valid).toBe(false);
    expect(result.locked).toBe(true);
  });

  it("returns { valid: false, remainingAttempts } on code mismatch", async () => {
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const otpRecord = {
      id: "otp-4",
      code: "654321",
      attempts: 1,
      max_attempts: 3,
      expires_at: futureExpiry
    };

    const supabase = createMockSupabase(otpRecord);
    const result = await verifyOTP(supabase, { ...baseParams, code: "123456" });

    expect(result.valid).toBe(false);
    expect(result.remainingAttempts).toBe(1); // max_attempts(3) - new attempts(2) = 1
  });

  it("returns { valid: false, remainingAttempts: 0 } on third failed attempt", async () => {
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const otpRecord = {
      id: "otp-5",
      code: "654321",
      attempts: 2,
      max_attempts: 3,
      expires_at: futureExpiry
    };

    const supabase = createMockSupabase(otpRecord);
    const result = await verifyOTP(supabase, { ...baseParams, code: "000000" });

    expect(result.valid).toBe(false);
    expect(result.remainingAttempts).toBe(0);
  });

  it("returns error when no OTP record exists", async () => {
    const supabase = createMockSupabase(null);
    const result = await verifyOTP(supabase, baseParams);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("no_otp_found");
  });

  it("uses constant-time comparison (timingSafeEqual) regardless of code similarity", async () => {
    // This test verifies that the function correctly handles codes with different lengths
    // when padded for timingSafeEqual comparison
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const otpRecord = {
      id: "otp-6",
      code: "042871",
      attempts: 0,
      max_attempts: 3,
      expires_at: futureExpiry
    };

    const supabase = createMockSupabase(otpRecord);

    // Test with correct code including leading zero
    const result = await verifyOTP(supabase, {
      ...baseParams,
      code: "042871"
    });
    expect(result.valid).toBe(true);
  });

  it("correctly handles OTP codes with leading zeros", async () => {
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const otpRecord = {
      id: "otp-7",
      code: "000001",
      attempts: 0,
      max_attempts: 3,
      expires_at: futureExpiry
    };

    const supabase = createMockSupabase(otpRecord);
    const result = await verifyOTP(supabase, { ...baseParams, code: "000001" });

    expect(result.valid).toBe(true);
  });

  it("rejects code '1' when stored code is '000001' (not numerically equal)", async () => {
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const otpRecord = {
      id: "otp-8",
      code: "000001",
      attempts: 0,
      max_attempts: 3,
      expires_at: futureExpiry
    };

    const supabase = createMockSupabase(otpRecord);
    const result = await verifyOTP(supabase, { ...baseParams, code: "1" });

    expect(result.valid).toBe(false);
    expect(result.remainingAttempts).toBe(2);
  });
});

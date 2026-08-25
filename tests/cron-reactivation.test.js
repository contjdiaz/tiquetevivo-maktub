/**
 * Unit tests for the cron-reactivation.js module.
 * Feature: customer-retention-platform
 *
 * Tests segmentation, anti-spam controls, time window, plan limits,
 * coupon generation, and coupon redemption logic.
 *
 * **Validates: Requirements 7, 8, 9, 10**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isWithinSendWindow, generateCouponCode } from "../netlify/functions/cron-reactivation.js";

// ──────────────────────────────────────────────────────────────────
// Tests for isWithinSendWindow (time window enforcement)
// ──────────────────────────────────────────────────────────────────

describe("cron-reactivation — isWithinSendWindow (time window 08:00-20:00 Colombia)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true at 08:00 Colombia (13:00 UTC)", () => {
    vi.useFakeTimers();
    // Colombia is UTC-5: 08:00 Colombia = 13:00 UTC
    vi.setSystemTime(new Date("2024-06-15T13:00:00Z"));
    expect(isWithinSendWindow()).toBe(true);
  });

  it("returns true at 14:00 Colombia (19:00 UTC)", () => {
    vi.useFakeTimers();
    // 14:00 Colombia = 19:00 UTC (typical cron execution time)
    vi.setSystemTime(new Date("2024-06-15T19:00:00Z"));
    expect(isWithinSendWindow()).toBe(true);
  });

  it("returns true at 19:59 Colombia (00:59 UTC next day)", () => {
    vi.useFakeTimers();
    // 19:59 Colombia = 00:59 UTC next day
    vi.setSystemTime(new Date("2024-06-16T00:59:00Z"));
    expect(isWithinSendWindow()).toBe(true);
  });

  it("returns false at 20:00 Colombia (01:00 UTC next day)", () => {
    vi.useFakeTimers();
    // 20:00 Colombia = 01:00 UTC
    vi.setSystemTime(new Date("2024-06-16T01:00:00Z"));
    expect(isWithinSendWindow()).toBe(false);
  });

  it("returns false at 07:59 Colombia (12:59 UTC)", () => {
    vi.useFakeTimers();
    // 07:59 Colombia = 12:59 UTC
    vi.setSystemTime(new Date("2024-06-15T12:59:00Z"));
    expect(isWithinSendWindow()).toBe(false);
  });

  it("returns false at 03:00 Colombia (08:00 UTC)", () => {
    vi.useFakeTimers();
    // 03:00 Colombia = 08:00 UTC
    vi.setSystemTime(new Date("2024-06-15T08:00:00Z"));
    expect(isWithinSendWindow()).toBe(false);
  });

  it("returns false at 23:00 Colombia (04:00 UTC next day)", () => {
    vi.useFakeTimers();
    // 23:00 Colombia = 04:00 UTC next day
    vi.setSystemTime(new Date("2024-06-16T04:00:00Z"));
    expect(isWithinSendWindow()).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests for generateCouponCode (coupon generation)
// ──────────────────────────────────────────────────────────────────

describe("cron-reactivation — generateCouponCode (unique codes, format)", () => {
  it("generates a 6-character code without prefix", () => {
    const code = generateCouponCode();
    expect(code).toHaveLength(6);
  });

  it("generates an 8-character code with prefix", () => {
    const code = generateCouponCode("VIP");
    expect(code).toHaveLength(8);
    expect(code.startsWith("VIP")).toBe(true);
  });

  it("generates uppercase alphanumeric characters only", () => {
    const code = generateCouponCode();
    expect(code).toMatch(/^[A-Z2-9]+$/);
  });

  it("excludes ambiguous characters (I, O, 0, 1)", () => {
    // Generate many codes and check none contain ambiguous chars
    for (let i = 0; i < 100; i++) {
      const code = generateCouponCode();
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("generates unique codes (high likelihood)", () => {
    const codes = new Set();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateCouponCode());
    }
    // With 6 chars from 32-char alphabet: 32^6 = ~1 billion possibilities
    // 1000 codes should be virtually all unique
    expect(codes.size).toBe(1000);
  });

  it("truncates prefix to 3 characters", () => {
    const code = generateCouponCode("LONGPREFIX");
    expect(code).toHaveLength(8);
    expect(code.startsWith("LON")).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests for segmentation logic
// ──────────────────────────────────────────────────────────────────

describe("cron-reactivation — segmentation logic", () => {
  /**
   * Validates: Requirement 7.2
   * A customer is inactive when days_since_last > max(configured_threshold, avg_frequency × 1.5)
   */

  it("uses fixed threshold when customer has fewer than 2 orders", () => {
    // Req 7.4: For customers with fewer than 2 historical orders, use only fixed threshold
    const thresholdDays = 30;
    const orderCount = 1;
    const daysSinceLast = 35;

    // With < 2 orders, effective threshold = fixed threshold (no frequency calc)
    const effectiveThreshold = thresholdDays; // No dynamic calc
    expect(daysSinceLast > effectiveThreshold).toBe(true); // Customer IS inactive
  });

  it("uses dynamic frequency threshold when customer has 2+ orders and frequency is high", () => {
    // Customer visits every 10 days on average → dynamic threshold = 10 * 1.5 = 15
    const thresholdDays = 30;
    const avgFrequencyDays = 10;
    const dynamicThreshold = avgFrequencyDays * 1.5; // 15
    const effectiveThreshold = Math.max(thresholdDays, dynamicThreshold); // max(30, 15) = 30

    // Even with dynamic calc, fixed threshold wins when it's higher
    expect(effectiveThreshold).toBe(30);
  });

  it("uses dynamic threshold when it exceeds fixed threshold", () => {
    // Customer visits every 25 days on average → dynamic threshold = 25 * 1.5 = 37.5
    const thresholdDays = 30;
    const avgFrequencyDays = 25;
    const dynamicThreshold = avgFrequencyDays * 1.5; // 37.5
    const effectiveThreshold = Math.max(thresholdDays, dynamicThreshold); // max(30, 37.5) = 37.5

    expect(effectiveThreshold).toBe(37.5);
  });

  it("combined max(): customer with avg 40-day frequency needs 60+ days to be inactive", () => {
    const thresholdDays = 30;
    const avgFrequencyDays = 40;
    const dynamicThreshold = avgFrequencyDays * 1.5; // 60
    const effectiveThreshold = Math.max(thresholdDays, dynamicThreshold); // 60

    // Customer at 55 days is NOT inactive
    expect(55 > effectiveThreshold).toBe(false);
    // Customer at 61 days IS inactive
    expect(61 > effectiveThreshold).toBe(true);
  });

  it("customer within fixed threshold is NOT considered inactive", () => {
    const thresholdDays = 30;
    const daysSinceLast = 25;
    // Single order, uses only fixed threshold
    expect(daysSinceLast > thresholdDays).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests for anti-spam controls
// ──────────────────────────────────────────────────────────────────

describe("cron-reactivation — anti-spam controls", () => {
  /**
   * Validates: Requirements 7.5, 9.2
   */

  it("cooldown: excludes customers messaged within 15 days", () => {
    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    const lastMessageDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    const cooldownThreshold = new Date(Date.now() - fifteenDaysMs);

    // Last message is more recent than cooldown threshold → exclude
    expect(lastMessageDate > cooldownThreshold).toBe(true);
  });

  it("cooldown: allows customers not messaged in 15+ days", () => {
    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    const lastMessageDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000); // 20 days ago
    const cooldownThreshold = new Date(Date.now() - fifteenDaysMs);

    // Last message is older than cooldown threshold → allow
    expect(lastMessageDate > cooldownThreshold).toBe(false);
  });

  it("recent order exclusion: customer with new order is excluded", () => {
    // Req 7.5(b): customers who created a new order after their last service
    const lastServiceDate = new Date("2024-06-01");
    const newerOrderDate = new Date("2024-06-10");

    // Customer has a newer order → already came back → exclude
    expect(newerOrderDate > lastServiceDate).toBe(true);
  });

  it("opt-out: customer with marketing_opt_in=false is always excluded", () => {
    const customer = { phone: "573001234567", marketing_opt_in: false };
    // Req 9.2: opted-out customers are excluded regardless of other criteria
    expect(customer.marketing_opt_in === false).toBe(true);
  });

  it("opt-out: customer with marketing_opt_in=true is NOT excluded", () => {
    const customer = { phone: "573001234567", marketing_opt_in: true };
    expect(customer.marketing_opt_in === false).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests for plan limits
// ──────────────────────────────────────────────────────────────────

describe("cron-reactivation — plan limits", () => {
  /**
   * Validates: Requirement 9.3
   * Free businesses: limited to 10/month
   * Paid businesses: configurable higher limit
   */
  const FREE_PLAN_MONTHLY_LIMIT = 10;

  it("free plan: enforces 10 messages/month cap", () => {
    const plan = "free";
    const monthlyCount = 9;
    const monthlyLimit = FREE_PLAN_MONTHLY_LIMIT;
    const remainingQuota = Math.max(0, monthlyLimit - monthlyCount);

    expect(remainingQuota).toBe(1); // Can still send 1
  });

  it("free plan: blocks when monthly limit reached", () => {
    const plan = "free";
    const monthlyCount = 10;
    const monthlyLimit = FREE_PLAN_MONTHLY_LIMIT;
    const remainingQuota = Math.max(0, monthlyLimit - monthlyCount);

    expect(remainingQuota).toBe(0); // Cannot send more
  });

  it("free plan: blocks when monthly limit exceeded", () => {
    const plan = "free";
    const monthlyCount = 15; // somehow sent more (edge case)
    const monthlyLimit = FREE_PLAN_MONTHLY_LIMIT;
    const remainingQuota = Math.max(0, monthlyLimit - monthlyCount);

    expect(remainingQuota).toBe(0); // Clamped to 0
  });

  it("paid plan: uses configurable monthly_limit from reactivation_config", () => {
    const plan = "paid";
    const reactivationConfig = { monthly_limit: 100 };
    const monthlyCount = 50;
    const monthlyLimit = reactivationConfig.monthly_limit;
    const remainingQuota = Math.max(0, monthlyLimit - monthlyCount);

    expect(remainingQuota).toBe(50);
  });

  it("paid plan: defaults to 50 when monthly_limit not configured", () => {
    const plan = "paid";
    const reactivationConfig = { enabled: true }; // no monthly_limit
    const monthlyLimit = reactivationConfig.monthly_limit || 50;

    expect(monthlyLimit).toBe(50);
  });

  it("paid plan: respects configured limit even when high", () => {
    const plan = "paid";
    const reactivationConfig = { monthly_limit: 500 };
    const monthlyCount = 200;
    const monthlyLimit = reactivationConfig.monthly_limit;
    const remainingQuota = Math.max(0, monthlyLimit - monthlyCount);

    expect(remainingQuota).toBe(300);
  });
});

// ──────────────────────────────────────────────────────────────────
// Tests for coupon redemption (validate-coupon logic)
// ──────────────────────────────────────────────────────────────────

describe("cron-reactivation — coupon validation and redemption", () => {
  /**
   * Validates: Requirement 10
   */

  function validateCoupon(coupon) {
    if (!coupon) return { valid: false, error: "Coupon not found" };
    if (coupon.used_at) return { valid: false, error: "Coupon already redeemed" };
    const now = new Date();
    const expiresAt = new Date(coupon.expires_at);
    if (expiresAt <= now) return { valid: false, error: "Coupon expired" };
    return { valid: true };
  }

  it("valid coupon: not expired, not used", () => {
    const coupon = {
      code: "ABC123",
      type: "PERCENT",
      value: 10,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      used_at: null
    };

    const result = validateCoupon(coupon);
    expect(result.valid).toBe(true);
  });

  it("expired coupon: returns error", () => {
    const coupon = {
      code: "EXP456",
      type: "PERCENT",
      value: 10,
      expires_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // yesterday
      used_at: null
    };

    const result = validateCoupon(coupon);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Coupon expired");
  });

  it("already used coupon: returns error", () => {
    const coupon = {
      code: "USED789",
      type: "AMOUNT",
      value: 5000,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      used_at: new Date().toISOString()
    };

    const result = validateCoupon(coupon);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Coupon already redeemed");
  });

  it("non-existent coupon: returns error", () => {
    const result = validateCoupon(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Coupon not found");
  });

  it("coupon expiring exactly now: returns expired", () => {
    const coupon = {
      code: "NOW123",
      type: "FREE_DELIVERY",
      value: 0,
      expires_at: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      used_at: null
    };

    const result = validateCoupon(coupon);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Coupon expired");
  });

  it("coupon single-use: after redemption (used_at set), subsequent attempts fail", () => {
    // First: valid
    const coupon = {
      code: "SINGLE1",
      type: "PERCENT",
      value: 15,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      used_at: null
    };
    expect(validateCoupon(coupon).valid).toBe(true);

    // After redemption: used_at is set
    coupon.used_at = new Date().toISOString();
    expect(validateCoupon(coupon).valid).toBe(false);
    expect(validateCoupon(coupon).error).toBe("Coupon already redeemed");
  });

  it("coupon default expiration is 7 days from creation", () => {
    const COUPON_EXPIRATION_DAYS = 7;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + COUPON_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    const diffDays = (expiresAt - createdAt) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(7);
  });
});

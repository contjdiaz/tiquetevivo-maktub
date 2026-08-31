/**
 * Property-based tests for OTP generation.
 *
 * Feature: core-flows-phase1, Property 1: Generated OTPs are always exactly 6 digits (0-9)
 * Validates: Requirements 2.1
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateOTP } from '../../netlify/functions/_otp.js';

describe('Feature: core-flows-phase1, Property 1: OTP generation produces valid 6-digit codes', () => {
  it('100+ generated OTPs are all exactly 6 characters long and contain only digits 0-9', () => {
    /**
     * Validates: Requirements 2.1
     *
     * For every invocation of generateOTP(), the result must be:
     * - Exactly 6 characters in length
     * - Composed entirely of digit characters (0-9)
     * - A string type (preserving leading zeros like "042871")
     */
    fc.assert(
      fc.property(fc.constant(null), () => {
        const otp = generateOTP();

        // Must be a string
        expect(typeof otp).toBe('string');

        // Must be exactly 6 characters long
        expect(otp).toHaveLength(6);

        // Every character must be a digit 0-9
        expect(otp).toMatch(/^[0-9]{6}$/);
      }),
      { numRuns: 150 }
    );
  });

  it('leading zeros are preserved in generated OTPs', () => {
    /**
     * Validates: Requirements 2.1
     *
     * The OTP generation uses padStart(6, "0"), so codes from small numbers
     * (e.g., 42871 → "042871") must retain their leading zeros.
     * We verify this indirectly: all OTPs are length 6 regardless of numeric value.
     */
    fc.assert(
      fc.property(fc.constant(null), () => {
        const otp = generateOTP();

        // Even if the numeric value is small, the string length must be 6
        const numericValue = parseInt(otp, 10);
        expect(numericValue).toBeGreaterThanOrEqual(0);
        expect(numericValue).toBeLessThan(1000000);

        // String representation preserves leading zeros
        expect(otp.length).toBe(6);
        expect(String(numericValue).padStart(6, '0')).toBe(otp);
      }),
      { numRuns: 150 }
    );
  });
});

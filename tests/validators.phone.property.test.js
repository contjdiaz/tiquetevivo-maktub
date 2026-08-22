/**
 * Property-based tests for validatePhone function.
 *
 * Feature: whatsapp-auto-send, Property 3: Phone validation accepts only valid international formats
 * Validates: Requirements 8.1, 8.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePhone } from '../netlify/functions/_validators.js';

describe('Feature: whatsapp-auto-send, Property 3: Phone validation accepts only valid international formats', () => {
  it('accepts any string of 10-15 digits optionally with +, spaces, dashes mixed in', () => {
    /**
     * Validates: Requirements 8.1, 8.4
     *
     * For any string that, after stripping +/spaces/dashes, is composed entirely
     * of digits with length between 10 and 15, validatePhone should return valid=true.
     */
    // Generator: produce a digit string of length 10-15, then randomly insert +, spaces, dashes
    const validPhoneArb = fc.integer({ min: 10, max: 15 }).chain((digitCount) =>
      fc.tuple(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: digitCount, maxLength: digitCount }),
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: digitCount }), // position to insert
            fc.constantFrom('+', ' ', '-')           // character to insert
          ),
          { minLength: 0, maxLength: 5 }
        )
      ).map(([digits, insertions]) => {
        let phone = digits.join('');
        // Insert decorations at various positions (from end to start to preserve indices)
        const sorted = [...insertions].sort((a, b) => b[0] - a[0]);
        for (const [pos, ch] of sorted) {
          phone = phone.slice(0, pos) + ch + phone.slice(pos);
        }
        return phone;
      })
    );

    fc.assert(
      fc.property(validPhoneArb, (phone) => {
        const result = validatePhone(phone);
        expect(result.valid).toBe(true);
        expect(result.value).toBeDefined();
        // Normalized value should be digits-only
        expect(result.value).toMatch(/^\d+$/);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects any string with fewer than 10 digits (after stripping +/spaces/dashes)', () => {
    /**
     * Validates: Requirements 8.1, 8.4
     *
     * For any string that, after stripping +/spaces/dashes, has fewer than 10 digits,
     * validatePhone should return valid=false with an error.
     */
    const shortPhoneArb = fc.integer({ min: 1, max: 9 }).chain((digitCount) =>
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: digitCount, maxLength: digitCount })
        .map((digits) => digits.join(''))
    );

    fc.assert(
      fc.property(shortPhoneArb, (phone) => {
        const result = validatePhone(phone);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects any string with more than 15 digits (after stripping +/spaces/dashes)', () => {
    /**
     * Validates: Requirements 8.1, 8.4
     *
     * For any string that, after stripping +/spaces/dashes, has more than 15 digits,
     * validatePhone should return valid=false with an error.
     */
    const longPhoneArb = fc.integer({ min: 16, max: 25 }).chain((digitCount) =>
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: digitCount, maxLength: digitCount })
        .map((digits) => digits.join(''))
    );

    fc.assert(
      fc.property(longPhoneArb, (phone) => {
        const result = validatePhone(phone);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects any string containing non-digit characters after stripping +/spaces/dashes', () => {
    /**
     * Validates: Requirements 8.1, 8.4
     *
     * For any string that, after stripping +/spaces/dashes, contains non-digit characters,
     * validatePhone should return valid=false with an error.
     */
    // Generate a string with at least one non-digit, non-strippable character
    const invalidCharPhoneArb = fc.tuple(
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 5, maxLength: 10 }),
      fc.constantFrom('a', 'b', 'Z', '#', '@', '!', '/', '.', '(', ')', '*', '&'),
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 5, maxLength: 10 })
    ).map(([prefix, invalidChar, suffix]) => {
      return prefix.join('') + invalidChar + suffix.join('');
    });

    fc.assert(
      fc.property(invalidCharPhoneArb, (phone) => {
        const result = validatePhone(phone);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }),
      { numRuns: 100 }
    );
  });

  it('normalized output is always digits-only with length 10-15 for valid inputs', () => {
    /**
     * Validates: Requirements 8.1, 8.4
     *
     * For any valid phone input, the normalized (value) output is always
     * a string composed exclusively of digits with a length between 10 and 15.
     */
    const validPhoneArb = fc.integer({ min: 10, max: 15 }).chain((digitCount) =>
      fc.tuple(
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: digitCount, maxLength: digitCount }),
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: digitCount }),
            fc.constantFrom('+', ' ', '-')
          ),
          { minLength: 0, maxLength: 4 }
        )
      ).map(([digits, insertions]) => {
        let phone = digits.join('');
        const sorted = [...insertions].sort((a, b) => b[0] - a[0]);
        for (const [pos, ch] of sorted) {
          phone = phone.slice(0, pos) + ch + phone.slice(pos);
        }
        return phone;
      })
    );

    fc.assert(
      fc.property(validPhoneArb, (phone) => {
        const result = validatePhone(phone);
        expect(result.valid).toBe(true);
        // Normalized value must be digits-only
        expect(result.value).toMatch(/^\d+$/);
        // Normalized value must have length 10-15
        expect(result.value.length).toBeGreaterThanOrEqual(10);
        expect(result.value.length).toBeLessThanOrEqual(15);
      }),
      { numRuns: 100 }
    );
  });
});

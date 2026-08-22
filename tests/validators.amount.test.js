/**
 * Property-Based Test: Amount Validation
 * Feature: whatsapp-auto-send, Property 4: Amount validation accepts only non-negative numbers within range
 * Validates: Requirements 8.2
 *
 * For any input value, validateAmount returns valid=true only if the value is a finite number >= 0
 * and <= 99999999.99. All other inputs (negative, NaN, Infinity, strings, exceeding max) return valid=false.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateAmount } from '../netlify/functions/_validators.js';

const MAX_AMOUNT = 99999999.99;

describe('Feature: whatsapp-auto-send, Property 4: Amount validation accepts only non-negative numbers within range', () => {
  /**
   * **Validates: Requirements 8.2**
   * Any non-negative finite number <= 99999999.99 is accepted
   */
  it('accepts any non-negative finite number <= 99999999.99', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: MAX_AMOUNT, noNaN: true, noDefaultInfinity: true }),
        (amount) => {
          const result = validateAmount(amount, 'total');
          expect(result.valid).toBe(true);
          expect(result.value).toBe(amount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.2**
   * Any negative number is rejected
   */
  it('rejects any negative number', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -Number.MAX_VALUE, max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
        (amount) => {
          const result = validateAmount(amount, 'total');
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.2**
   * NaN and Infinity are rejected
   */
  it('rejects NaN and Infinity', () => {
    const invalidValues = [NaN, Infinity, -Infinity];
    for (const val of invalidValues) {
      const result = validateAmount(val, 'total');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    }
  });

  /**
   * **Validates: Requirements 8.2**
   * Numbers > 99999999.99 are rejected
   */
  it('rejects numbers exceeding 99999999.99', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 100000000, max: Number.MAX_VALUE, noNaN: true, noDefaultInfinity: true }),
        (amount) => {
          const result = validateAmount(amount, 'total');
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 8.2**
   * Null/undefined values are rejected
   */
  it('rejects null and undefined values', () => {
    const result1 = validateAmount(null, 'total');
    expect(result1.valid).toBe(false);
    expect(result1.error).toBeDefined();

    const result2 = validateAmount(undefined, 'total');
    expect(result2.valid).toBe(false);
    expect(result2.error).toBeDefined();
  });

  /**
   * **Validates: Requirements 8.2**
   * When accepted, the returned value is always a number
   */
  it('always returns a number type when validation passes', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: MAX_AMOUNT, noNaN: true, noDefaultInfinity: true }),
        (amount) => {
          const result = validateAmount(amount, 'total');
          if (result.valid) {
            expect(typeof result.value).toBe('number');
            expect(Number.isFinite(result.value)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

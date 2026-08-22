/**
 * Property-based tests for validateStatus function.
 *
 * Feature: whatsapp-auto-send, Property 9: Status value validation accepts only allowed enum values
 * Validates: Requirements 8.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateStatus } from '../netlify/functions/_validators.js';

const ALLOWED_STATUSES = ['RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED'];

describe('Feature: whatsapp-auto-send, Property 9: Status value validation accepts only allowed enum values', () => {
  it('accepts any string from the allowed enum values (case-insensitive)', () => {
    /**
     * Validates: Requirements 8.5
     *
     * For any allowed status value in any casing combination,
     * validateStatus should return valid=true.
     */
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_STATUSES).chain((status) =>
          // Generate random case variations of the status
          fc.tuple(fc.constant(status), fc.array(fc.boolean(), { minLength: status.length, maxLength: status.length }))
            .map(([s, caseFlags]) =>
              s.split('').map((ch, i) => caseFlags[i] ? ch.toLowerCase() : ch.toUpperCase()).join('')
            )
        ),
        (statusVariant) => {
          const result = validateStatus(statusVariant);
          expect(result.valid).toBe(true);
          expect(result.value).toBe(statusVariant.toUpperCase());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any arbitrary string NOT in the allowed enum list', () => {
    /**
     * Validates: Requirements 8.5
     *
     * For any arbitrary string that is not one of the allowed statuses
     * (case-insensitive), validateStatus should return valid=false with an error.
     */
    fc.assert(
      fc.property(
        fc.string().filter((s) => !ALLOWED_STATUSES.includes(s.toUpperCase())),
        (arbitraryString) => {
          const result = validateStatus(arbitraryString);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(typeof result.error).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects null, undefined, and non-string values', () => {
    /**
     * Validates: Requirements 8.5
     *
     * For any value that is not a string (null, undefined, numbers, booleans, objects, arrays),
     * validateStatus should return valid=false with an error.
     */
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.double(),
          fc.boolean(),
          fc.object(),
          fc.array(fc.anything())
        ),
        (nonStringValue) => {
          const result = validateStatus(nonStringValue);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
          expect(typeof result.error).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('always returns the uppercase version of a valid input', () => {
    /**
     * Validates: Requirements 8.5
     *
     * For any valid status input (case-insensitive match),
     * the returned value property is always the uppercase canonical form.
     */
    fc.assert(
      fc.property(
        fc.constantFrom(...ALLOWED_STATUSES).chain((status) =>
          fc.tuple(fc.constant(status), fc.array(fc.boolean(), { minLength: status.length, maxLength: status.length }))
            .map(([s, caseFlags]) =>
              s.split('').map((ch, i) => caseFlags[i] ? ch.toLowerCase() : ch.toUpperCase()).join('')
            )
        ),
        (statusVariant) => {
          const result = validateStatus(statusVariant);
          expect(result.valid).toBe(true);
          expect(result.value).toBe(statusVariant.toUpperCase());
          // Verify it's exactly one of the allowed values
          expect(ALLOWED_STATUSES).toContain(result.value);
        }
      ),
      { numRuns: 100 }
    );
  });
});

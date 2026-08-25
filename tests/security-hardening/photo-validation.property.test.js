/**
 * Property-based tests for validatePhoto (photo storage module).
 *
 * Feature: security-hardening, Property 7: Photo validation rejects invalid inputs
 * Validates: Requirements 5.3, 5.4
 *
 * Property 7: For any photo input, the validator SHALL accept only files with
 * MIME type in {jpeg, png, gif, webp} AND decoded binary size <= 5 MB. All other
 * inputs (wrong format, oversized, malformed data URLs) SHALL be rejected with an
 * appropriate error.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validatePhoto } from '../../netlify/functions/_photo-storage.js';

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Builds a base64 data URL from a mime type and a byte length.
 * The decoded binary will be exactly `sizeBytes` bytes.
 */
function buildDataUrl(mimeType, sizeBytes) {
  const base64 = Buffer.alloc(sizeBytes, 0).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

describe('Feature: security-hardening, Property 7: Photo validation rejects invalid inputs', () => {
  it('accepts only allowed MIME types with valid size', () => {
    /**
     * Validates: Requirements 5.4
     *
     * For any data URL with an allowed MIME type and a non-empty size <= 5MB,
     * validatePhoto returns valid=true and reports the (lowercased) mimeType.
     */
    const arb = fc.tuple(
      fc.constantFrom(...ALLOWED_MIME_TYPES),
      fc.integer({ min: 1, max: 4096 }) // small, well within the 5MB limit
    );

    fc.assert(
      fc.property(arb, ([mimeType, sizeBytes]) => {
        const result = validatePhoto(buildDataUrl(mimeType, sizeBytes));
        expect(result.valid).toBe(true);
        expect(result.mimeType).toBe(mimeType);
        expect(result.sizeBytes).toBe(sizeBytes);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('rejects MIME types not in the allowed set', () => {
    /**
     * Validates: Requirements 5.4
     *
     * For any data URL whose MIME type (lowercased) is not one of the allowed
     * image formats, validatePhoto returns valid=false with an "Unsupported image
     * format" error, regardless of a valid size.
     */
    // Generate arbitrary mime-like tokens, then exclude any that normalize to an allowed type.
    const disallowedMimeArb = fc
      .tuple(
        fc.constantFrom('image', 'application', 'text', 'video', 'audio', 'font'),
        fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/)
      )
      .map(([type, subtype]) => `${type}/${subtype}`)
      .filter((mime) => !ALLOWED_MIME_TYPES.includes(mime.toLowerCase()));

    fc.assert(
      fc.property(disallowedMimeArb, fc.integer({ min: 1, max: 2048 }), (mimeType, sizeBytes) => {
        const result = validatePhoto(buildDataUrl(mimeType, sizeBytes));
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unsupported image format');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects photos exceeding the 5MB decoded size limit', () => {
    /**
     * Validates: Requirements 5.3
     *
     * For any allowed MIME type where the decoded binary size exceeds 5MB,
     * validatePhoto returns valid=false with a "5MB" limit error.
     */
    const arb = fc.tuple(
      fc.constantFrom(...ALLOWED_MIME_TYPES),
      // 1 byte to ~1MB over the limit; keep upper bound modest to avoid huge allocations
      fc.integer({ min: MAX_SIZE_BYTES + 1, max: MAX_SIZE_BYTES + 1024 * 1024 })
    );

    fc.assert(
      fc.property(arb, ([mimeType, sizeBytes]) => {
        const result = validatePhoto(buildDataUrl(mimeType, sizeBytes));
        expect(result.valid).toBe(false);
        expect(result.error).toContain('5MB');
      }),
      { numRuns: 25 } // fewer runs: each allocates multi-MB buffers
    );
  });

  it('accepts allowed photos at exactly the 5MB boundary', () => {
    /**
     * Validates: Requirements 5.3
     *
     * For any allowed MIME type where the decoded binary size is exactly 5MB,
     * validatePhoto accepts the input (boundary is inclusive).
     */
    fc.assert(
      fc.property(fc.constantFrom(...ALLOWED_MIME_TYPES), (mimeType) => {
        const result = validatePhoto(buildDataUrl(mimeType, MAX_SIZE_BYTES));
        expect(result.valid).toBe(true);
        expect(result.sizeBytes).toBe(MAX_SIZE_BYTES);
      }),
      { numRuns: 4 } // only 4 allowed mime types; each allocates 5MB
    );
  });

  it('rejects malformed data URLs (not matching the data:<mime>;base64,<data> format)', () => {
    /**
     * Validates: Requirements 5.3, 5.4
     *
     * For any string that does not conform to the expected base64 data URL format,
     * validatePhoto returns valid=false with an "Invalid photo format" error.
     */
    // Arbitrary strings that do NOT match the strict data URL pattern.
    // We also filter out empty/falsy strings which hit the "required" check instead.
    const dataUrlPattern = /^data:([^;]+);base64,(.+)$/;
    const malformedArb = fc
      .oneof(
        // Completely arbitrary text (non-empty)
        fc.string({ minLength: 1 }),
        // Missing the ;base64, marker
        fc.string().map((s) => `data:image/png,${s}`),
        // Missing the data: scheme
        fc.string().map((s) => `image/png;base64,${s}`),
        // Empty data section (regex requires at least one char after comma)
        fc.constant('data:image/png;base64,'),
        // Wrong scheme
        fc.string().map((s) => `blob:image/png;base64,${s}`)
      )
      .filter((s) => s.length > 0 && !dataUrlPattern.test(s));

    fc.assert(
      fc.property(malformedArb, (input) => {
        const result = validatePhoto(input);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid photo format');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects null, undefined, and non-string inputs', () => {
    /**
     * Validates: Requirements 5.3
     *
     * For any input that is null, undefined, or not a string, validatePhoto returns
     * valid=false with a "required" error.
     */
    const nonStringArb = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.boolean(),
      fc.object(),
      fc.array(fc.anything())
    );

    fc.assert(
      fc.property(nonStringArb, (input) => {
        const result = validatePhoto(input);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('required');
      }),
      { numRuns: 100 }
    );
  });

  it('validity is fully determined by allowed MIME type AND size <= 5MB', () => {
    /**
     * Validates: Requirements 5.3, 5.4
     *
     * For any well-formed data URL, validatePhoto returns valid=true if and only if
     * the MIME type is allowed AND the decoded size is within 1..5MB. This ties the
     * two rules together as a single invariant.
     */
    const arb = fc.tuple(
      fc.constantFrom('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf', 'text/plain'),
      fc.integer({ min: 1, max: MAX_SIZE_BYTES + 512 })
    );

    fc.assert(
      fc.property(arb, ([mimeType, sizeBytes]) => {
        const result = validatePhoto(buildDataUrl(mimeType, sizeBytes));
        const expectedValid =
          ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase()) && sizeBytes <= MAX_SIZE_BYTES;
        expect(result.valid).toBe(expectedValid);
        if (!expectedValid) {
          expect(result.error).toBeDefined();
        }
      }),
      { numRuns: 50 }
    );
  });
});

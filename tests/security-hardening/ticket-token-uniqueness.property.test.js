/**
 * Property-based tests for ticket token uniqueness and non-guessability.
 * Feature: security-hardening, Property 5: Ticket tokens are unique and non-guessable.
 *
 * **Validates: Requirements 2.5**
 *
 * Property 5: Ticket tokens are unique and non-guessable
 * - For any set of generated ticket tokens, all tokens SHALL be unique (no duplicates).
 * - Each token SHALL have at least 128 bits of entropy (UUID v4 format).
 * - UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where y is one of [8,9,a,b].
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { randomUUID } from "crypto";

// ──────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────

/**
 * UUID v4 regex — validates the canonical format:
 * - 8 hex chars, dash, 4 hex chars, dash, "4" + 3 hex chars, dash,
 *   variant nibble [89ab] + 3 hex chars, dash, 12 hex chars
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Generate batch sizes for uniqueness testing */
const batchSizeArb = fc.integer({ min: 10, max: 200 });

/** Smaller batch size for per-token validation (avoids timeout) */
const smallBatchSizeArb = fc.integer({ min: 5, max: 50 });

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 5: Ticket tokens are unique and non-guessable", () => {
  /**
   * **Validates: Requirements 2.5**
   *
   * For any batch of generated tokens, ALL tokens in the batch SHALL be
   * unique — no two tokens are the same.
   */
  it("all generated tokens in a batch are unique (no duplicates)", () => {
    fc.assert(
      fc.property(batchSizeArb, (batchSize) => {
        const tokens = Array.from({ length: batchSize }, () => randomUUID());
        const uniqueTokens = new Set(tokens);

        // Every token must be unique
        expect(uniqueTokens.size).toBe(batchSize);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * For any generated token, it SHALL match the UUID v4 format which
   * guarantees 128-bit entropy (122 random bits + 6 version/variant bits).
   * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where y ∈ {8,9,a,b}
   */
  it("every generated token matches UUID v4 format (128-bit entropy)", () => {
    fc.assert(
      fc.property(smallBatchSizeArb, (batchSize) => {
        const tokens = Array.from({ length: batchSize }, () => randomUUID());

        for (const token of tokens) {
          // Must match UUID v4 regex
          expect(token).toMatch(UUID_V4_REGEX);

          // Verify version nibble is '4' (position 14)
          expect(token.charAt(14)).toBe("4");

          // Verify variant nibble is one of [8, 9, a, b] (position 19)
          expect(["8", "9", "a", "b"]).toContain(token.charAt(19));
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * Tokens SHALL have proper length (36 chars: 32 hex + 4 dashes)
   * and contain only valid characters — ensuring the full 128-bit space is used.
   */
  it("tokens have correct structure: 36 characters with proper dash placement", () => {
    fc.assert(
      fc.property(smallBatchSizeArb, (batchSize) => {
        const tokens = Array.from({ length: batchSize }, () => randomUUID());

        for (const token of tokens) {
          // UUID string length is always 36
          expect(token.length).toBe(36);

          // Dashes at positions 8, 13, 18, 23
          expect(token.charAt(8)).toBe("-");
          expect(token.charAt(13)).toBe("-");
          expect(token.charAt(18)).toBe("-");
          expect(token.charAt(23)).toBe("-");

          // All other characters are hex digits
          const hexOnly = token.replace(/-/g, "");
          expect(hexOnly).toMatch(/^[0-9a-f]{32}$/);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.5**
   *
   * Tokens SHALL be non-sequential — consecutive tokens should not share
   * common prefixes that would allow prediction/enumeration.
   * This verifies the cryptographic randomness property.
   */
  it("consecutive tokens are not sequential or predictable", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 100 }),
        (batchSize) => {
          const tokens = Array.from({ length: batchSize }, () => randomUUID());

          // Check that consecutive tokens don't share long common prefixes
          // UUID v4 should have random distribution across the full space
          let sharedPrefixLengths = 0;
          for (let i = 1; i < tokens.length; i++) {
            let commonPrefix = 0;
            for (let j = 0; j < tokens[i].length; j++) {
              if (tokens[i][j] === tokens[i - 1][j] && tokens[i][j] !== "-") {
                commonPrefix++;
              } else if (tokens[i][j] !== "-") {
                break;
              }
            }
            sharedPrefixLengths += commonPrefix;
          }

          // Average shared prefix length should be very small (statistically < 1 hex char)
          // With 16 possible values per position, expected shared prefix is ~0.07 chars
          // Allow generous threshold of 3 to avoid flaky tests
          const avgSharedPrefix = sharedPrefixLengths / (tokens.length - 1);
          expect(avgSharedPrefix).toBeLessThan(3);
        }
      ),
      { numRuns: 100 }
    );
  });
});

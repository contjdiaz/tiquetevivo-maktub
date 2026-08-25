/**
 * Property-based tests for admin credential hygiene.
 * Feature: security-hardening, Property 8: Empty admin credentials prevent authentication.
 *
 * **Validates: Requirements 6.3**
 *
 * Property 8: Empty admin credentials prevent authentication
 * - For any admin login attempt when the ADMIN_PASSWORD environment variable
 *   is empty or unset, the system SHALL reject the authentication with an
 *   error (not a false positive success).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fc from "fast-check";

// Mock the _utils.js module
vi.mock("../../netlify/functions/_utils.js", () => ({
  json: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  parseBody: (event) => {
    if (!event.body) return {};
    return JSON.parse(event.body);
  },
}));

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Generate a random non-empty username */
const usernameArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Generate a random non-empty password */
const passwordArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0);

/** Generate the ADMIN_PASSWORD env value — either empty string or undefined (deleted) */
const emptyPasswordEnvArb = fc.constantFrom("", undefined);

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 8: Empty admin credentials prevent authentication", () => {
  let originalAdminPassword;
  let originalAdminUsername;

  beforeEach(() => {
    originalAdminPassword = process.env.ADMIN_PASSWORD;
    originalAdminUsername = process.env.ADMIN_USERNAME;
  });

  afterEach(() => {
    // Restore original env values
    if (originalAdminPassword !== undefined) {
      process.env.ADMIN_PASSWORD = originalAdminPassword;
    } else {
      delete process.env.ADMIN_PASSWORD;
    }
    if (originalAdminUsername !== undefined) {
      process.env.ADMIN_USERNAME = originalAdminUsername;
    } else {
      delete process.env.ADMIN_USERNAME;
    }
    vi.resetModules();
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * For any random username/password combination, when ADMIN_PASSWORD env is
   * empty string, the system must reject with 500 "Admin not configured".
   */
  it("rejects all login attempts when ADMIN_PASSWORD is empty string", async () => {
    await fc.assert(
      fc.asyncProperty(
        usernameArb,
        passwordArb,
        async (username, password) => {
          // Set ADMIN_PASSWORD to empty string
          process.env.ADMIN_PASSWORD = "";

          // Re-import to get fresh module with mocked dependencies
          vi.resetModules();
          const { handler } = await import("../../netlify/functions/admin-login.js");

          const event = {
            httpMethod: "POST",
            body: JSON.stringify({ username, password }),
            headers: {},
          };

          const response = await handler(event);
          const body = JSON.parse(response.body);

          expect(response.statusCode).toBe(500);
          expect(body.error).toBe("Admin not configured");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * For any random username/password combination, when ADMIN_PASSWORD env is
   * unset (deleted), the system must reject with 500 "Admin not configured".
   */
  it("rejects all login attempts when ADMIN_PASSWORD is unset (undefined)", async () => {
    await fc.assert(
      fc.asyncProperty(
        usernameArb,
        passwordArb,
        async (username, password) => {
          // Delete ADMIN_PASSWORD from environment
          delete process.env.ADMIN_PASSWORD;

          // Re-import to get fresh module with mocked dependencies
          vi.resetModules();
          const { handler } = await import("../../netlify/functions/admin-login.js");

          const event = {
            httpMethod: "POST",
            body: JSON.stringify({ username, password }),
            headers: {},
          };

          const response = await handler(event);
          const body = JSON.parse(response.body);

          expect(response.statusCode).toBe(500);
          expect(body.error).toBe("Admin not configured");
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.3**
   *
   * Combined property: for any empty/unset ADMIN_PASSWORD variant and any
   * login credentials, authentication is always rejected — never a false positive.
   */
  it("never returns a success response regardless of credentials when ADMIN_PASSWORD is empty/unset", async () => {
    await fc.assert(
      fc.asyncProperty(
        usernameArb,
        passwordArb,
        emptyPasswordEnvArb,
        async (username, password, envValue) => {
          // Set or delete ADMIN_PASSWORD
          if (envValue === undefined) {
            delete process.env.ADMIN_PASSWORD;
          } else {
            process.env.ADMIN_PASSWORD = envValue;
          }

          // Re-import to get fresh module with mocked dependencies
          vi.resetModules();
          const { handler } = await import("../../netlify/functions/admin-login.js");

          const event = {
            httpMethod: "POST",
            body: JSON.stringify({ username, password }),
            headers: {},
          };

          const response = await handler(event);

          // Must NEVER return 200 (success) — that would be a false positive
          expect(response.statusCode).not.toBe(200);

          // Must specifically be 500 with "Admin not configured"
          const body = JSON.parse(response.body);
          expect(response.statusCode).toBe(500);
          expect(body.error).toBe("Admin not configured");
        }
      ),
      { numRuns: 100 }
    );
  });
});

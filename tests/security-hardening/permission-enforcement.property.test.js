/**
 * Property-based tests for permission enforcement on manage-business endpoint.
 * Feature: security-hardening, Property 2: Unauthorized users cannot access resources.
 *
 * **Validates: Requirements 1.2, 3.2, 3.4**
 *
 * Property 2: Unauthorized users cannot access resources they lack permission for
 * - For any authenticated user whose role does NOT grant `manage_business` permission,
 *   the system SHALL return HTTP 403 with "Insufficient permissions".
 * - Only `owner` and `superadmin` roles have `manage_business` permission.
 * - All other roles (operator, viewer, arbitrary strings, etc.) must be denied.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { hasPermission } from "../../netlify/functions/_utils.js";

// ──────────────────────────────────────────────────────────────────
// Generators
// ──────────────────────────────────────────────────────────────────

/** Roles that SHOULD have manage_business permission */
const authorizedRolesArb = fc.constantFrom("owner", "superadmin");

/** Known roles that should NOT have manage_business permission */
const knownUnauthorizedRolesArb = fc.constantFrom("operator", "viewer", "staff", "cashier");

/** Arbitrary string roles (excluding the two authorized ones) */
const arbitraryUnauthorizedRolesArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s !== "owner" && s !== "superadmin");

/** Combined unauthorized roles: known + arbitrary */
const unauthorizedRolesArb = fc.oneof(
  knownUnauthorizedRolesArb,
  arbitraryUnauthorizedRolesArb
);

/** All known permissions in the system */
const allPermissionsArb = fc.constantFrom(
  "read",
  "create_order",
  "update_order",
  "delete_order",
  "manage_business"
);

/** Permissions that operator role has */
const operatorPermissionsArb = fc.constantFrom("read", "create_order", "update_order");

/** Permissions that operator should NOT have */
const operatorDeniedPermissionsArb = fc.constantFrom("delete_order", "manage_business");

/** Arbitrary permission strings (to test unknown permissions) */
const arbitraryPermissionArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !["read", "create_order", "update_order", "delete_order", "manage_business"].includes(s));

// ──────────────────────────────────────────────────────────────────
// Property Tests
// ──────────────────────────────────────────────────────────────────

describe("Property 2: Unauthorized users cannot access resources they lack permission for", () => {
  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * For any role that is NOT owner or superadmin, the hasPermission function
   * must return false for the manage_business action.
   */
  it("unauthorized roles are denied manage_business permission", () => {
    fc.assert(
      fc.property(
        unauthorizedRolesArb,
        (role) => {
          const result = hasPermission(role, "manage_business");
          expect(result).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Only owner and superadmin roles are granted manage_business permission.
   * This confirms the positive case to ensure the system correctly authorizes
   * the right roles.
   */
  it("authorized roles (owner, superadmin) are granted manage_business permission", () => {
    fc.assert(
      fc.property(
        authorizedRolesArb,
        (role) => {
          const result = hasPermission(role, "manage_business");
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 3.2**
   *
   * The operator role should be denied any permissions beyond read, create_order,
   * and update_order. Specifically, manage_business and delete_order must be denied.
   */
  it("operator role is denied elevated permissions (manage_business, delete_order)", () => {
    fc.assert(
      fc.property(
        operatorDeniedPermissionsArb,
        (permission) => {
          const result = hasPermission("operator", permission);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 3.2**
   *
   * Any role that is not superadmin, owner, or operator should have NO permissions
   * at all — including read, create_order, etc.
   */
  it("unknown roles have no permissions for any action", () => {
    fc.assert(
      fc.property(
        arbitraryUnauthorizedRolesArb.filter(
          (s) => s !== "operator"
        ),
        allPermissionsArb,
        (role, permission) => {
          const result = hasPermission(role, permission);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 3.2, 3.4**
   *
   * For any arbitrary/unknown permission string, only superadmin grants access.
   * Owner and operator should NOT grant access to unknown permission actions.
   */
  it("unknown permissions are denied for non-superadmin roles", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("owner", "operator"),
        arbitraryPermissionArb,
        (role, permission) => {
          const result = hasPermission(role, permission);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Superadmin has access to ALL permissions (including arbitrary ones).
   * This verifies the superadmin bypass behavior.
   */
  it("superadmin has access to all permissions including arbitrary ones", () => {
    fc.assert(
      fc.property(
        fc.oneof(allPermissionsArb, arbitraryPermissionArb),
        (permission) => {
          const result = hasPermission("superadmin", permission);
          expect(result).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 3.2**
   *
   * Null, undefined, or empty roles should always be denied any permission.
   * This ensures the system fails closed.
   */
  it("null/undefined/empty roles are denied all permissions", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, undefined, ""),
        allPermissionsArb,
        (role, permission) => {
          const result = hasPermission(role, permission);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

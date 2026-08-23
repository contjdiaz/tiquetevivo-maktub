/**
 * Unit Test: Operator authentication
 * Feature: auth
 *
 * Validates that /api/auth-login returns a Supabase session token and memberships.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignIn = vi.fn();
const mockFromSelect = vi.fn();

const mockSupabase = {
  auth: {
    signInWithPassword: mockSignIn
  },
  from: vi.fn(() => ({
    select: mockFromSelect
  }))
};

vi.mock("../netlify/functions/_utils.js", () => ({
  supabaseAdmin: () => mockSupabase,
  json: (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }),
  parseBody: (event) => {
    if (!event.body) return {};
    return JSON.parse(event.body);
  }
}));

import { handler } from "../netlify/functions/auth-login.js";

describe("Feature: operator authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a token and memberships on valid credentials", async () => {
    mockSignIn.mockResolvedValue({
      data: {
        session: { access_token: "jwt-token-123" },
        user: { id: "auth-user-1", email: "op@majesty.com" }
      },
      error: null
    });

    mockFromSelect.mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          data: [
            { business_id: "biz-1", role: "operator", active: true, businesses: { slug: "majesty", name: "Majesty" } }
          ],
          error: null
        }))
      }))
    });

    const event = {
      httpMethod: "POST",
      body: JSON.stringify({ email: "op@majesty.com", password: "secret" })
    };

    const response = await handler(event);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.token).toBe("jwt-token-123");
    expect(body.user.email).toBe("op@majesty.com");
    expect(body.user.memberships).toHaveLength(1);
    expect(body.user.memberships[0].role).toBe("operator");
  });

  it("rejects missing email or password", async () => {
    const event = {
      httpMethod: "POST",
      body: JSON.stringify({ email: "op@majesty.com" })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid credentials", async () => {
    mockSignIn.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" }
    });

    const event = {
      httpMethod: "POST",
      body: JSON.stringify({ email: "op@majesty.com", password: "wrong" })
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });
});

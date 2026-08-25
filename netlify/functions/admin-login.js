import { json, parseBody } from "./_utils.js";
import { createHash, randomBytes } from "crypto";

/**
 * POST /api/admin-login
 * 
 * Simple admin authentication using environment variables.
 * Returns a session token on successful login.
 * 
 * Credentials are stored in environment variables:
 *   ADMIN_USERNAME (default: "admin")
 *   ADMIN_PASSWORD (required, no default for security)
 */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const { username, password } = body;

    if (!username || !password) {
      return json(400, { error: "Username and password are required" });
    }

    const expectedUser = process.env.ADMIN_USERNAME || "admin";
    const expectedPass = process.env.ADMIN_PASSWORD;

    if (!expectedPass) {
      return json(500, { error: "Admin not configured" });
    }

    // Timing-safe comparison
    const inputHash = createHash("sha256").update(`${username}:${password}`).digest("hex");
    const expectedHash = createHash("sha256").update(`${expectedUser}:${expectedPass}`).digest("hex");

    if (inputHash !== expectedHash) {
      return json(401, { error: "Credenciales inválidas" });
    }

    // Generate a simple session token (valid until page reload / session end)
    const token = randomBytes(32).toString("hex");

    // In a production setup, you'd store this in a database/cache with expiry.
    // For the free tier / simple approach, we use a signed token approach.
    const secret = process.env.ADMIN_PASSWORD;
    const expiry = Date.now() + (8 * 60 * 60 * 1000); // 8 hours
    const payload = `${expiry}`;
    const signature = createHash("sha256").update(`${payload}:${secret}`).digest("hex");
    const sessionToken = `${payload}.${signature}`;

    return json(200, { token: sessionToken, user: expectedUser });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

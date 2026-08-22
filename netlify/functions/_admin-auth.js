import { createHash } from "crypto";
import { json } from "./_utils.js";

/**
 * Validates the admin session token from the Authorization header.
 * Token format: "{expiry_timestamp}.{sha256_signature}"
 * 
 * @param {object} event - Netlify function event
 * @returns {{ valid: boolean, error?: object }} Validation result
 */
export function validateAdminToken(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return { valid: false, error: json(401, { error: "Authorization token required" }) };
  }

  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) {
    return { valid: false, error: json(500, { error: "Admin not configured" }) };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: json(401, { error: "Invalid token format" }) };
  }

  const [payload, signature] = parts;
  const expectedSignature = createHash("sha256").update(`${payload}:${secret}`).digest("hex");

  if (signature !== expectedSignature) {
    return { valid: false, error: json(401, { error: "Invalid token" }) };
  }

  const expiry = Number(payload);
  if (Date.now() > expiry) {
    return { valid: false, error: json(401, { error: "Token expired" }) };
  }

  return { valid: true };
}

import { createHash } from "crypto";
import { json, supabaseAdmin } from "./_utils.js";

/**
 * Validates the admin session token from the Authorization header.
 * Supports both the legacy admin token and Supabase Auth JWTs.
 * For Supabase tokens, verifies the user has an active superadmin membership.
 *
 * @param {object} event - Netlify function event
 * @returns {{ valid: boolean, error?: object }} Validation result
 */
export async function validateAdminToken(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return { valid: false, error: json(401, { error: "Authorization token required" }) };
  }

  // Legacy admin token format: "{expiry_timestamp}.{sha256_signature}"
  const legacyParts = token.split(".");
  if (legacyParts.length === 2 && /^\d+$/.test(legacyParts[0])) {
    const secret = process.env.ADMIN_PASSWORD;
    if (!secret) {
      return { valid: false, error: json(500, { error: "Admin not configured" }) };
    }
    const [payload, signature] = legacyParts;
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

  // Supabase Auth JWT: verify user and superadmin role
  try {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return { valid: false, error: json(401, { error: "Invalid or expired token" }) };
    }

    const { data: membership, error: membershipError } = await supabase
      .from("business_users")
      .select("role")
      .eq("auth_user_id", data.user.id)
      .eq("role", "superadmin")
      .eq("active", true)
      .single();

    if (membershipError || !membership) {
      return { valid: false, error: json(403, { error: "Superadmin access required" }) };
    }

    return { valid: true, user: data.user };
  } catch (err) {
    return { valid: false, error: json(500, { error: err.message }) };
  }
}

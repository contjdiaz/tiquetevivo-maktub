import { createClient } from "@supabase/supabase-js";

export function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

export function parseBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch (err) {
    throw new Error(`Invalid JSON body: ${err.message}`);
  }
}

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL and SUPABASE_SECRET_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Extracts the client IP from a Netlify Function event.
 * Tries common headers used by Netlify and proxies.
 */
export function getClientIp(event) {
  const headers = event.headers || {};
  return (
    headers["x-nf-client-connection-ip"] ||
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    headers["client-ip"] ||
    headers["x-real-ip"] ||
    "unknown"
  );
}

export async function getBusinessBySlug(supabase, slug) {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data;
}

/**
 * Extracts the Bearer token from the Authorization header.
 */
export function getBearerToken(event) {
  const authHeader = event.headers?.["authorization"] || event.headers?.["Authorization"];
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Verifies a Supabase Auth JWT and returns the authenticated user.
 * Returns null if the token is missing or invalid.
 */
export async function getAuthUser(supabase, token) {
  if (!token) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
}

/**
 * Returns the business_users row for a given auth user and business.
 */
export async function getUserBusinessRole(supabase, authUserId, businessId) {
  if (!authUserId || !businessId) return null;
  const { data, error } = await supabase
    .from("business_users")
    .select("role, active")
    .eq("auth_user_id", authUserId)
    .eq("business_id", businessId)
    .single();
  if (error || !data || !data.active) return null;
  return data.role;
}

/**
 * Checks if a role has permission for a given action.
 * - superadmin: all actions
 * - owner: all actions on their business
 * - operator: read/write orders, cannot delete business or manage users
 */
export function hasPermission(role, action) {
  if (role === "superadmin") return true;
  if (role === "owner") {
    return ["read", "create_order", "update_order", "delete_order", "manage_business"].includes(action);
  }
  if (role === "operator") {
    return ["read", "create_order", "update_order"].includes(action);
  }
  return false;
}

/**
 * Requires authentication and optionally a permission for the requested business.
 * Returns an object with { user, role } on success, or a json response on failure.
 */
export async function requireAuth(supabase, event, options = {}) {
  const token = getBearerToken(event);
  const user = await getAuthUser(supabase, token);
  if (!user) {
    return { error: json(401, { error: true, message: "Authentication required" }) };
  }

  if (options.permission) {
    const businessId = options.businessId;
    if (!businessId) {
      return { error: json(400, { error: true, message: "businessId is required for permission check" }) };
    }
    const role = await getUserBusinessRole(supabase, user.id, businessId);
    if (!role || !hasPermission(role, options.permission)) {
      return { error: json(403, { error: true, message: "Insufficient permissions" }) };
    }
    return { user, role };
  }

  return { user };
}

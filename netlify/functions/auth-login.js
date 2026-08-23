import { json, parseBody, supabaseAdmin } from "./_utils.js";

/**
 * POST /api/auth-login
 *
 * Authenticates an operator/owner/superadmin using Supabase Auth.
 * Expects { email, password } and returns the Supabase session.
 *
 * The access_token must be sent in the Authorization header for protected endpoints.
 */
export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const { email, password } = body;

    if (!email || !password) {
      return json(400, { error: true, message: "Email and password are required" });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.session) {
      return json(401, { error: true, message: error?.message || "Invalid credentials" });
    }

    // Fetch business membership and roles
    const { data: memberships, error: membershipError } = await supabase
      .from("business_users")
      .select("business_id, role, active, businesses:business_id (slug, name)")
      .eq("auth_user_id", data.user.id)
      .eq("active", true);

    if (membershipError) throw membershipError;

    return json(200, {
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        memberships: memberships || []
      }
    });
  } catch (error) {
    return json(500, { error: true, message: error.message });
  }
};

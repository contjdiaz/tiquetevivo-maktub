/**
 * OTP (One-Time Password) shared module for TiqueteVivo.
 * Handles generation, storage, verification, and rate limiting of OTP codes.
 * Uses Supabase-backed storage and crypto.timingSafeEqual for secure comparison.
 */

import crypto from "crypto";

/**
 * Generates a cryptographically random 6-digit OTP code.
 * Uses crypto.randomInt for uniform distribution across 000000-999999.
 * Leading zeros are preserved (string return type).
 *
 * @returns {string} 6-digit OTP code (e.g., "042871")
 */
export function generateOTP() {
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(6, "0");
}

/**
 * Stores an OTP code in the otp_codes table.
 * Invalidates any existing unexpired OTP for the same phone+business_id.
 *
 * @param {object} supabase - Supabase admin client
 * @param {object} params
 * @param {string} params.phone - Normalized phone number (digits only)
 * @param {string} params.businessId - Business UUID
 * @param {string} params.code - The 6-digit OTP code
 * @param {number} [params.ttlMinutes=5] - Time-to-live in minutes
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function storeOTP(supabase, { phone, businessId, code, ttlMinutes = 5 }) {
  try {
    // Invalidate any existing unexpired OTP for this phone+business_id
    await supabase
      .from("otp_codes")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("phone", phone)
      .eq("business_id", businessId)
      .is("used_at", null)
      .is("invalidated_at", null);

    // Calculate expiration
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

    // Insert new OTP
    const { error } = await supabase.from("otp_codes").insert({
      phone,
      business_id: businessId,
      code,
      attempts: 0,
      max_attempts: 3,
      expires_at: expiresAt
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Verifies an OTP code using constant-time comparison.
 * Enforces max 3 attempts per OTP instance.
 * Returns the verification result and remaining attempts.
 *
 * @param {object} supabase - Supabase admin client
 * @param {object} params
 * @param {string} params.phone - Normalized phone number (digits only)
 * @param {string} params.businessId - Business UUID
 * @param {string} params.code - The submitted OTP code
 * @returns {Promise<{ valid: boolean, expired?: boolean, locked?: boolean, remainingAttempts?: number, error?: string }>}
 */
export async function verifyOTP(supabase, { phone, businessId, code }) {
  try {
    // Fetch the latest non-invalidated OTP for this phone+business_id
    const { data: otpRecord, error: fetchError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("phone", phone)
      .eq("business_id", businessId)
      .is("invalidated_at", null)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !otpRecord) {
      return { valid: false, error: "no_otp_found" };
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(otpRecord.expires_at);
    if (expiresAt < now) {
      return { valid: false, expired: true };
    }

    // Check if locked (max attempts reached)
    if (otpRecord.attempts >= otpRecord.max_attempts) {
      return { valid: false, locked: true };
    }

    // Constant-time comparison using crypto.timingSafeEqual on UTF-8 buffers
    const submittedBuffer = Buffer.from(String(code), "utf8");
    const storedBuffer = Buffer.from(String(otpRecord.code), "utf8");

    // Ensure both buffers are the same length for timingSafeEqual
    // Pad the shorter one to match the longer one's length
    const maxLen = Math.max(submittedBuffer.length, storedBuffer.length);
    const paddedSubmitted = Buffer.alloc(maxLen, 0);
    const paddedStored = Buffer.alloc(maxLen, 0);
    submittedBuffer.copy(paddedSubmitted);
    storedBuffer.copy(paddedStored);

    const isMatch = crypto.timingSafeEqual(paddedSubmitted, paddedStored);

    if (isMatch) {
      // Code matches — mark as used
      await supabase
        .from("otp_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", otpRecord.id);

      return { valid: true };
    }

    // Mismatch — increment attempts
    const newAttempts = otpRecord.attempts + 1;
    await supabase
      .from("otp_codes")
      .update({ attempts: newAttempts })
      .eq("id", otpRecord.id);

    const remainingAttempts = otpRecord.max_attempts - newAttempts;
    return { valid: false, remainingAttempts };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Checks if the rate limit for OTP requests has been exceeded.
 * Limit: 3 OTP requests per phone per 15-minute window.
 *
 * @param {object} supabase - Supabase admin client
 * @param {string} phone - Normalized phone number
 * @param {string} businessId - Business UUID
 * @returns {Promise<{ allowed: boolean, error?: string }>}
 */
export async function checkOTPRateLimit(supabase, phone, businessId) {
  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("phone", phone)
      .eq("business_id", businessId)
      .gte("created_at", fifteenMinutesAgo);

    if (error) {
      return { allowed: false, error: error.message };
    }

    if (count >= 3) {
      return { allowed: false };
    }

    return { allowed: true };
  } catch (err) {
    return { allowed: false, error: err.message };
  }
}

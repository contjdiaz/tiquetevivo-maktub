/**
 * Shared PIN validation and hashing module for TiqueteVivo.
 * Used by registration (registro) and login (auth-pin-login) endpoints.
 */

import bcrypt from "bcryptjs";

const BCRYPT_COST_FACTOR = 10;

/**
 * Validates that a PIN is a 4-6 digit numeric string.
 * @param {*} pin - The value to validate
 * @returns {boolean} true if pin is a string of 4-6 digits only
 */
export function isValidPIN(pin) {
  if (typeof pin !== "string") return false;
  if (pin.length < 4 || pin.length > 6) return false;
  return /^\d+$/.test(pin);
}

/**
 * Hashes a PIN using bcrypt with cost factor 10.
 * @param {string} pin - A valid 4-6 digit PIN
 * @returns {Promise<string>} The bcrypt hash
 */
export async function hashPIN(pin) {
  const salt = await bcrypt.genSalt(BCRYPT_COST_FACTOR);
  return bcrypt.hash(pin, salt);
}

/**
 * Verifies a PIN against a bcrypt hash (constant-time comparison).
 * @param {string} pin - The PIN to verify
 * @param {string} hash - The stored bcrypt hash
 * @returns {Promise<boolean>} true if the PIN matches the hash
 */
export async function verifyPIN(pin, hash) {
  return bcrypt.compare(pin, hash);
}

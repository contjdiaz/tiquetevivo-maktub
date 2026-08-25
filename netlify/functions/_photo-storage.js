/**
 * Photo storage module for Supabase Storage.
 * Handles photo validation, upload, and signed URL generation.
 * Bucket: order-photos (private, service-role only access)
 */

const BUCKET_NAME = "order-photos";
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const DEFAULT_EXPIRY_SECONDS = 3600; // 1 hour

/**
 * Validates a photo input: checks MIME type and decoded binary size.
 * @param {string} base64DataUrl - The data URL (data:image/jpeg;base64,...)
 * @returns {{ valid: boolean, error?: string, mimeType?: string, sizeBytes?: number }}
 */
export function validatePhoto(base64DataUrl) {
  if (!base64DataUrl || typeof base64DataUrl !== "string") {
    return { valid: false, error: "Photo data is required and must be a string" };
  }

  // Parse the data URL format: data:<mime>;base64,<data>
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return { valid: false, error: "Invalid photo format. Expected a base64 data URL" };
  }

  const mimeType = match[1].toLowerCase();
  const base64Data = match[2];

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: "Unsupported image format. Accepted: JPEG, PNG, GIF, WebP"
    };
  }

  // Decode and check size
  const buffer = Buffer.from(base64Data, "base64");
  const sizeBytes = buffer.length;

  if (sizeBytes > MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: "Photo exceeds 5MB limit"
    };
  }

  return { valid: true, mimeType, sizeBytes };
}

/**
 * Uploads a photo to Supabase Storage after validation.
 * @param {object} supabase - Already-initialized Supabase client
 * @param {string} base64DataUrl - The data URL (data:image/jpeg;base64,...)
 * @param {string} path - Storage path (e.g., "{business_id}/{order_id}/intake.jpg")
 * @returns {Promise<{ path: string }>} The storage path for signed URL generation
 * @throws {Error} If validation fails or upload fails
 */
export async function uploadPhoto(supabase, base64DataUrl, path) {
  // Validate first
  const validation = validatePhoto(base64DataUrl);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Decode the base64 data
  const match = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = match[1].toLowerCase();
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, "base64");

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    throw new Error("Photo upload failed");
  }

  return { path: data.path || path };
}

/**
 * Generates a signed URL for a stored photo with configurable expiry.
 * @param {object} supabase - Already-initialized Supabase client
 * @param {string} path - Storage path
 * @param {number} expiresIn - Seconds until expiry (default 3600 = 1 hour)
 * @returns {Promise<string>} Signed URL
 * @throws {Error} If signed URL generation fails
 */
export async function getSignedPhotoUrl(supabase, path, expiresIn = DEFAULT_EXPIRY_SECONDS) {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new Error("Failed to generate signed photo URL");
  }

  return data.signedUrl;
}

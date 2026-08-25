import { describe, it, expect } from "vitest";
import { validatePhoto, uploadPhoto, getSignedPhotoUrl } from "../netlify/functions/_photo-storage.js";

// Helper: create a valid base64 data URL with a small 1x1 pixel PNG
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const validDataUrl = (mime = "image/png", data = TINY_PNG_BASE64) =>
  `data:${mime};base64,${data}`;

describe("_photo-storage: validatePhoto", () => {
  it("accepts valid JPEG data URL", () => {
    const result = validatePhoto(validDataUrl("image/jpeg"));
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("accepts valid PNG data URL", () => {
    const result = validatePhoto(validDataUrl("image/png"));
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe("image/png");
  });

  it("accepts valid GIF data URL", () => {
    const result = validatePhoto(validDataUrl("image/gif"));
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe("image/gif");
  });

  it("accepts valid WebP data URL", () => {
    const result = validatePhoto(validDataUrl("image/webp"));
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe("image/webp");
  });

  it("rejects unsupported MIME type (image/bmp)", () => {
    const result = validatePhoto(validDataUrl("image/bmp"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unsupported image format");
  });

  it("rejects unsupported MIME type (application/pdf)", () => {
    const result = validatePhoto(validDataUrl("application/pdf"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unsupported image format");
  });

  it("rejects photos exceeding 5MB", () => {
    // Create a base64 string that decodes to > 5MB
    // Base64 encodes 3 bytes into 4 chars, so ~7MB of zeros in base64
    const largeBinary = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    const largeBase64 = largeBinary.toString("base64");
    const result = validatePhoto(`data:image/png;base64,${largeBase64}`);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("5MB");
  });

  it("accepts photos exactly at 5MB", () => {
    const exactBinary = Buffer.alloc(5 * 1024 * 1024, 0);
    const exactBase64 = exactBinary.toString("base64");
    const result = validatePhoto(`data:image/png;base64,${exactBase64}`);
    expect(result.valid).toBe(true);
    expect(result.sizeBytes).toBe(5 * 1024 * 1024);
  });

  it("rejects null input", () => {
    const result = validatePhoto(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("rejects empty string", () => {
    const result = validatePhoto("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("rejects non-data-url string", () => {
    const result = validatePhoto("just-some-random-text");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid photo format");
  });

  it("rejects malformed data URL without base64 prefix", () => {
    const result = validatePhoto("data:image/png,notbase64data");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid photo format");
  });

  it("handles case-insensitive MIME types", () => {
    const result = validatePhoto(validDataUrl("image/JPEG"));
    // MIME comparison is lowercased
    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe("image/jpeg");
  });
});

describe("_photo-storage: uploadPhoto", () => {
  it("uploads valid photo and returns path", async () => {
    const mockSupabase = {
      storage: {
        from: () => ({
          upload: async () => ({ data: { path: "biz/order/intake.png" }, error: null })
        })
      }
    };

    const result = await uploadPhoto(mockSupabase, validDataUrl("image/png"), "biz/order/intake.png");
    expect(result.path).toBe("biz/order/intake.png");
  });

  it("throws on invalid photo", async () => {
    const mockSupabase = { storage: { from: () => ({}) } };
    await expect(
      uploadPhoto(mockSupabase, "invalid-data", "path/file.png")
    ).rejects.toThrow("Invalid photo format");
  });

  it("throws on upload failure", async () => {
    const mockSupabase = {
      storage: {
        from: () => ({
          upload: async () => ({ data: null, error: new Error("Storage error") })
        })
      }
    };

    await expect(
      uploadPhoto(mockSupabase, validDataUrl("image/png"), "biz/order/intake.png")
    ).rejects.toThrow("Photo upload failed");
  });

  it("throws on oversized photo without calling upload", async () => {
    let uploadCalled = false;
    const mockSupabase = {
      storage: {
        from: () => ({
          upload: async () => { uploadCalled = true; return { data: {}, error: null }; }
        })
      }
    };

    const largeBinary = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    const largeBase64 = largeBinary.toString("base64");

    await expect(
      uploadPhoto(mockSupabase, `data:image/png;base64,${largeBase64}`, "path/file.png")
    ).rejects.toThrow("5MB");
    expect(uploadCalled).toBe(false);
  });
});

describe("_photo-storage: getSignedPhotoUrl", () => {
  it("returns signed URL with default expiry (1 hour)", async () => {
    let receivedExpiry;
    const mockSupabase = {
      storage: {
        from: () => ({
          createSignedUrl: async (path, expiresIn) => {
            receivedExpiry = expiresIn;
            return { data: { signedUrl: `https://storage.example.com/signed/${path}` }, error: null };
          }
        })
      }
    };

    const url = await getSignedPhotoUrl(mockSupabase, "biz/order/intake.png");
    expect(url).toContain("https://storage.example.com/signed/");
    expect(receivedExpiry).toBe(3600);
  });

  it("respects custom expiry", async () => {
    let receivedExpiry;
    const mockSupabase = {
      storage: {
        from: () => ({
          createSignedUrl: async (path, expiresIn) => {
            receivedExpiry = expiresIn;
            return { data: { signedUrl: "https://example.com/signed" }, error: null };
          }
        })
      }
    };

    await getSignedPhotoUrl(mockSupabase, "path/file.png", 7200);
    expect(receivedExpiry).toBe(7200);
  });

  it("throws on signed URL generation failure", async () => {
    const mockSupabase = {
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: null, error: new Error("Auth error") })
        })
      }
    };

    await expect(
      getSignedPhotoUrl(mockSupabase, "biz/order/intake.png")
    ).rejects.toThrow("Failed to generate signed photo URL");
  });
});

/**
 * Integration Tests: Photo upload flow in create-order and update-order
 * Feature: security-hardening, Task 8.5
 *
 * Validates:
 * - Happy path: valid photo → upload succeeds → URL stored in DB (mocked Supabase Storage)
 * - Failure path: upload fails → order not created/updated
 *
 * Requirements: 5.1, 5.2, 5.5, 5.6
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks for create-order dependencies ---

const mockInsertSingle = vi.fn();
const mockInsert = vi.fn(() => ({ select: () => ({ single: mockInsertSingle }) }));
const mockUpdateSingle = vi.fn();
const mockUpdateEq = vi.fn(() => ({ select: () => ({ single: mockUpdateSingle }) }));
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
const mockDeleteEq = vi.fn().mockResolvedValue({ error: null });
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));
const mockSelectSingle = vi.fn();
const mockSelectEq = vi.fn(() => ({ single: mockSelectSingle }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));

const mockStorageUpload = vi.fn();
const mockStorageCreateSignedUrl = vi.fn();
const mockStorageFrom = vi.fn(() => ({
  upload: mockStorageUpload,
  createSignedUrl: mockStorageCreateSignedUrl
}));

const mockSupabase = {
  from: vi.fn((table) => {
    if (table === "orders") {
      return { insert: mockInsert, select: mockSelect, update: mockUpdate, delete: mockDelete };
    }
    if (table === "businesses") {
      return { select: mockSelect };
    }
    if (table === "order_items") {
      return { insert: vi.fn().mockResolvedValue({ error: null }), delete: mockDelete };
    }
    return { select: mockSelect, insert: mockInsert, update: mockUpdate };
  }),
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null })
  },
  storage: {
    from: mockStorageFrom
  }
};

let mockRequireAuthResult = { user: { id: "user-1" }, role: "owner" };
let mockUploadPhotoResult = { path: "biz-1/order-id/intake.jpg" };
let mockUploadPhotoShouldThrow = false;
let mockUploadPhotoError = "Photo upload failed";

vi.mock("../../netlify/functions/_utils.js", () => ({
  supabaseAdmin: () => mockSupabase,
  json: (statusCode, body) => ({
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }),
  parseBody: (event) => JSON.parse(event.body || "{}"),
  getClientIp: (event) => event.headers?.["x-nf-client-connection-ip"] || "127.0.0.1",
  getBusinessBySlug: vi.fn().mockResolvedValue({
    id: "biz-1",
    name: "Test Biz",
    slug: "test-biz",
    plan: "paid",
    active: true,
    loyalty_config: { enabled: false }
  }),
  requireAuth: vi.fn(async () => mockRequireAuthResult),
  getBearerToken: vi.fn(() => "valid-token")
}));

vi.mock("../../netlify/functions/_sheets.js", () => ({
  mirrorOrderToSheets: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../netlify/functions/_validators.js", () => ({
  validatePhone: vi.fn((phone) => ({ valid: true, value: phone })),
  validateAmount: vi.fn((amount, field) => ({ valid: true, value: Number(amount) })),
  validateRequired: vi.fn(() => ({ valid: true })),
  validateCustomFields: vi.fn(() => ({ valid: true })),
  validateStatusInFlow: vi.fn((status, flow) => ({ valid: true, value: status })),
  validateStatus: vi.fn((status) => ({ valid: true, value: status })),
  validateStatusTransition: vi.fn(() => ({ valid: true }))
}));

vi.mock("../../netlify/functions/_whatsapp.js", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: false, dryRun: true, fallbackLink: "" }),
  buildFallbackLink: vi.fn(() => ""),
  logWhatsAppMessage: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../netlify/functions/_vertical-config.js", () => ({
  getBusinessConfig: vi.fn().mockResolvedValue({
    status_flow_config: [{ status_key: "RECEIVED", display_label: "Recibido" }],
    custom_fields_config: [],
    whatsapp_templates_config: null,
    vertical: null
  })
}));

vi.mock("../../netlify/functions/_template-engine.js", () => ({
  selectTemplate: vi.fn(() => "Order {{order_number}} created"),
  renderTemplate: vi.fn(() => "Order 123 created")
}));

vi.mock("../../netlify/functions/_loyalty.js", () => ({
  getOrCreateLoyaltyProfile: vi.fn().mockResolvedValue({ success: false }),
  addStamp: vi.fn().mockResolvedValue({ success: true }),
  revertStamp: vi.fn().mockResolvedValue({ success: true }),
  getLoyaltySummary: vi.fn().mockResolvedValue({ success: false })
}));

vi.mock("../../netlify/functions/_photo-storage.js", () => ({
  validatePhoto: vi.fn((dataUrl) => {
    if (!dataUrl || typeof dataUrl !== "string") {
      return { valid: false, error: "Photo data is required and must be a string" };
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return { valid: false, error: "Invalid photo format. Expected a base64 data URL" };
    }
    const mime = match[1].toLowerCase();
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime)) {
      return { valid: false, error: "Unsupported image format. Accepted: JPEG, PNG, GIF, WebP" };
    }
    return { valid: true, mimeType: mime, sizeBytes: 1024 };
  }),
  uploadPhoto: vi.fn(async () => {
    if (mockUploadPhotoShouldThrow) {
      throw new Error(mockUploadPhotoError);
    }
    return mockUploadPhotoResult;
  }),
  getSignedPhotoUrl: vi.fn().mockResolvedValue("https://storage.example.com/signed-url?token=abc")
}));

vi.mock("../../netlify/functions/_rate-limiter.js", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true }))
}));

// A valid small 1x1 PNG as base64 data URL (for tests)
const VALID_PHOTO_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("Feature: security-hardening — Photo upload integration (create-order)", () => {
  let createOrderHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireAuthResult = { user: { id: "user-1" }, role: "owner" };
    mockUploadPhotoShouldThrow = false;
    mockUploadPhotoResult = { path: "biz-1/some-uuid/intake.jpg" };

    // Re-import to get fresh handler with mocks
    const mod = await import("../../netlify/functions/create-order.js");
    createOrderHandler = mod.handler;
  });

  describe("Happy path: valid photo → upload succeeds → URL stored in DB", () => {
    it("uploads intake photo and stores storage path in insert payload", async () => {
      const { uploadPhoto } = await import("../../netlify/functions/_photo-storage.js");

      const createdOrder = {
        id: "new-order-1",
        business_id: "biz-1",
        customer_name: "Carlos",
        customer_phone: "+573001234567",
        items_text: "2x Camisas",
        status: "RECEIVED",
        ticket_token: "uuid-ticket-token",
        intake_photo_url: "biz-1/some-uuid/intake.png",
        intake_photo_taken_at: expect.any(String)
      };

      mockInsertSingle.mockResolvedValue({ data: createdOrder, error: null });

      const event = {
        httpMethod: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          businessSlug: "test-biz",
          customerName: "Carlos",
          customerPhone: "+573001234567",
          itemsText: "2x Camisas",
          total: 15000,
          intakePhoto: VALID_PHOTO_BASE64
        })
      };

      const response = await createOrderHandler(event);
      expect(response.statusCode).toBe(201);

      // Verify uploadPhoto was called with supabase client, the base64 data, and a path
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
      expect(uploadPhoto).toHaveBeenCalledWith(
        mockSupabase,
        VALID_PHOTO_BASE64,
        expect.stringMatching(/^biz-1\/[a-f0-9-]+\/intake\.png$/)
      );

      // Verify the insert was called with intake_photo_url in payload
      expect(mockInsert).toHaveBeenCalled();
      const insertCall = mockInsert.mock.calls[0][0];
      expect(insertCall.intake_photo_url).toBe("biz-1/some-uuid/intake.jpg");
      expect(insertCall.intake_photo_taken_at).toBeDefined();
    });

    it("includes ticket_token (UUID) in the order insert payload", async () => {
      const createdOrder = {
        id: "new-order-2",
        business_id: "biz-1",
        ticket_token: "generated-uuid"
      };

      mockInsertSingle.mockResolvedValue({ data: createdOrder, error: null });

      const event = {
        httpMethod: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          businessSlug: "test-biz",
          customerName: "Ana",
          customerPhone: "+573009876543",
          itemsText: "1x Pantalón"
        })
      };

      await createOrderHandler(event);

      const insertCall = mockInsert.mock.calls[0][0];
      // ticket_token should be a UUID string
      expect(insertCall.ticket_token).toBeDefined();
      expect(insertCall.ticket_token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("creates order without photo when intakePhoto is not provided", async () => {
      const { uploadPhoto } = await import("../../netlify/functions/_photo-storage.js");

      const createdOrder = {
        id: "new-order-3",
        business_id: "biz-1",
        customer_name: "Luis"
      };

      mockInsertSingle.mockResolvedValue({ data: createdOrder, error: null });

      const event = {
        httpMethod: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          businessSlug: "test-biz",
          customerName: "Luis",
          customerPhone: "+573002222222",
          itemsText: "3x Sábanas"
        })
      };

      const response = await createOrderHandler(event);
      expect(response.statusCode).toBe(201);

      // uploadPhoto should NOT be called when no photo is provided
      expect(uploadPhoto).not.toHaveBeenCalled();

      // insert should NOT include intake_photo_url
      const insertCall = mockInsert.mock.calls[0][0];
      expect(insertCall.intake_photo_url).toBeUndefined();
    });
  });

  describe("Failure path: upload fails → order NOT created", () => {
    it("returns 500 and does NOT insert order when photo upload throws", async () => {
      mockUploadPhotoShouldThrow = true;
      mockUploadPhotoError = "Photo upload failed";

      const event = {
        httpMethod: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          businessSlug: "test-biz",
          customerName: "Maria",
          customerPhone: "+573003333333",
          itemsText: "1x Edredón",
          intakePhoto: VALID_PHOTO_BASE64
        })
      };

      const response = await createOrderHandler(event);

      // Should return 500 for upload failure
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.message).toBe("Photo upload failed");

      // Order insert should NOT have been called
      expect(mockInsertSingle).not.toHaveBeenCalled();
    });

    it("returns 400 when photo validation fails (invalid format)", async () => {
      const event = {
        httpMethod: "POST",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          businessSlug: "test-biz",
          customerName: "Pedro",
          customerPhone: "+573004444444",
          itemsText: "1x Cobija",
          intakePhoto: "data:application/pdf;base64,JVBERi0xLjQ="
        })
      };

      const response = await createOrderHandler(event);

      // Should return 400 for invalid photo format
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain("Unsupported image format");
    });
  });
});

describe("Feature: security-hardening — Photo upload integration (update-order)", () => {
  let updateOrderHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRequireAuthResult = { user: { id: "user-1" }, role: "owner" };
    mockUploadPhotoShouldThrow = false;
    mockUploadPhotoResult = { path: "biz-1/order-1/delivery.jpg" };

    // Mock order lookup for update-order (existing order)
    mockSelectSingle.mockResolvedValue({
      data: {
        id: "order-1",
        business_id: "biz-1",
        customer_name: "Carlos",
        customer_phone: "+573001234567",
        status: "RECEIVED",
        custom_fields: {}
      },
      error: null
    });

    // Mock successful update
    mockUpdateSingle.mockResolvedValue({
      data: {
        id: "order-1",
        business_id: "biz-1",
        status: "RECEIVED",
        delivery_photo_url: "biz-1/order-1/delivery.jpg",
        delivery_photo_taken_at: new Date().toISOString()
      },
      error: null
    });

    const mod = await import("../../netlify/functions/update-order.js");
    updateOrderHandler = mod.handler;
  });

  describe("Happy path: valid delivery photo → upload succeeds → URL stored in update payload", () => {
    it("stores delivery_photo_url in update payload when deliveryPhoto is valid", async () => {
      const event = {
        httpMethod: "PUT",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          id: "order-1",
          businessSlug: "test-biz",
          deliveryPhoto: VALID_PHOTO_BASE64
        })
      };

      const response = await updateOrderHandler(event);
      expect(response.statusCode).toBe(200);

      // Verify the update was called with delivery_photo_url
      expect(mockUpdate).toHaveBeenCalled();
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.delivery_photo_url).toBeDefined();
      expect(updateCall.delivery_photo_taken_at).toBeDefined();
    });
  });

  describe("Failure path: upload fails → order NOT updated", () => {
    it("returns 400 when deliveryPhoto is not a valid base64 data URL", async () => {
      const event = {
        httpMethod: "PUT",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          id: "order-1",
          businessSlug: "test-biz",
          deliveryPhoto: "not-a-valid-data-url"
        })
      };

      const response = await updateOrderHandler(event);

      // Should return 400 for invalid photo format
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      // The function rejects invalid data URLs with a validation error
      expect(body.error).toBe(true);
      expect(body.message).toBeDefined();
    });

    it("returns 400 when deliveryPhoto has an unsupported MIME type", async () => {
      const event = {
        httpMethod: "PUT",
        headers: {
          authorization: "Bearer valid-token",
          "x-nf-client-connection-ip": "10.0.0.1"
        },
        body: JSON.stringify({
          id: "order-1",
          businessSlug: "test-biz",
          deliveryPhoto: "data:image/bmp;base64,Qk0="
        })
      };

      const response = await updateOrderHandler(event);

      // BMP is not in the accepted formats (jpeg|png|gif|webp)
      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe(true);
      expect(body.message).toBeDefined();
    });
  });
});

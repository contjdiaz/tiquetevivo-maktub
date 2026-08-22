/**
 * Property Test: Every WhatsApp send attempt produces a log record
 * Feature: whatsapp-auto-send, Property 2: Every WhatsApp send attempt produces a log record
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 *
 * For any valid combination of parameters (orderId, businessId, phone, templateName,
 * messageBody, metaMessageId, status, errorMessage), calling logWhatsAppMessage always
 * inserts a record into the whatsapp_messages table.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { logWhatsAppMessage } from "../netlify/functions/_whatsapp.js";

// Arbitrary generators for WhatsApp message parameters
const uuidArb = fc.uuid();
const phoneArb = fc.integer({ min: 1000000000, max: 999999999999999 }).map(String);
const templateNameArb = fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 50 }));
const messageBodyArb = fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 500 }));
const metaMessageIdArb = fc.oneof(fc.constant(null), fc.string({ minLength: 5, maxLength: 40 }));
const statusArb = fc.constantFrom("SENT", "FAILED", "DRY_RUN");
const errorMessageArb = fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 200 }));

/**
 * Creates a mock Supabase client that records insert calls.
 * The mock validates that .from("whatsapp_messages").insert(record).select().single()
 * is called and stores the inserted record for assertions.
 */
function createMockSupabase() {
  const insertedRecords = [];

  const mockSupabase = {
    from(table) {
      return {
        insert(record) {
          insertedRecords.push({ table, record });
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: { id: "mock-id", ...record },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return { mockSupabase, insertedRecords };
}

describe("Feature: whatsapp-auto-send, Property 2: Every WhatsApp send attempt produces a log record", () => {
  it("for any valid combination of parameters, logWhatsAppMessage always inserts a record", async () => {
    await fc.assert(
      fc.asyncProperty(
        uuidArb,
        uuidArb,
        phoneArb,
        templateNameArb,
        messageBodyArb,
        metaMessageIdArb,
        statusArb,
        errorMessageArb,
        async (orderId, businessId, phone, templateName, messageBody, metaMessageId, status, errorMessage) => {
          const { mockSupabase, insertedRecords } = createMockSupabase();

          const result = await logWhatsAppMessage(mockSupabase, {
            orderId,
            businessId,
            phone,
            templateName,
            messageBody,
            metaMessageId,
            status,
            errorMessage,
          });

          // Property: exactly one record is inserted
          expect(insertedRecords.length).toBe(1);

          // Property: the record is inserted into the correct table
          expect(insertedRecords[0].table).toBe("whatsapp_messages");

          // Property: the inserted record contains all provided fields
          const record = insertedRecords[0].record;
          expect(record.order_id).toBe(orderId || null);
          expect(record.business_id).toBe(businessId || null);
          expect(record.phone).toBe(phone);
          expect(record.template_name).toBe(templateName || null);
          expect(record.message_body).toBe(messageBody || null);
          expect(record.meta_message_id).toBe(metaMessageId || null);
          expect(record.status).toBe(status);
          expect(record.error_message).toBe(errorMessage || null);

          // Property: the function returns data (non-error result)
          expect(result.data).not.toBeNull();
          expect(result.error).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

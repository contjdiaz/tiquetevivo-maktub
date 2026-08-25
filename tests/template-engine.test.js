import { describe, it, expect } from "vitest";
import { selectTemplate, renderTemplate } from "../netlify/functions/_template-engine.js";

describe("_template-engine: selectTemplate", () => {
  const GENERIC_FALLBACK = "📋 *{business_name}*\n\nOrden #{order_number}\nEstado: {status_label}";

  it("returns business override when available", () => {
    const businessTemplates = { order_created: "Business: {business_name}" };
    const verticalTemplates = { order_created: "Vertical: {business_name}" };

    const result = selectTemplate("order_created", businessTemplates, verticalTemplates);
    expect(result).toBe("Business: {business_name}");
  });

  it("returns vertical default when no business override exists", () => {
    const businessTemplates = { status_ready: "Ready msg" };
    const verticalTemplates = { order_created: "Vertical: {business_name}" };

    const result = selectTemplate("order_created", businessTemplates, verticalTemplates);
    expect(result).toBe("Vertical: {business_name}");
  });

  it("returns generic fallback when neither business nor vertical have the event", () => {
    const businessTemplates = { status_ready: "Ready" };
    const verticalTemplates = { status_ready: "V Ready" };

    const result = selectTemplate("order_created", businessTemplates, verticalTemplates);
    expect(result).toBe(GENERIC_FALLBACK);
  });

  it("returns generic fallback when businessTemplates is null", () => {
    const result = selectTemplate("order_created", null, null);
    expect(result).toBe(GENERIC_FALLBACK);
  });

  it("returns generic fallback when businessTemplates is undefined", () => {
    const result = selectTemplate("order_created", undefined, undefined);
    expect(result).toBe(GENERIC_FALLBACK);
  });

  it("returns vertical default when businessTemplates is null but vertical has the event", () => {
    const verticalTemplates = { order_created: "Vertical template" };
    const result = selectTemplate("order_created", null, verticalTemplates);
    expect(result).toBe("Vertical template");
  });

  it("generic fallback contains {order_number}, {business_name}, and {status_label}", () => {
    const result = selectTemplate("nonexistent_event", null, null);
    expect(result).toContain("{order_number}");
    expect(result).toContain("{business_name}");
    expect(result).toContain("{status_label}");
  });

  it("returns built-in customer_reactivation template when no overrides exist", () => {
    const result = selectTemplate("customer_reactivation", null, null);
    expect(result).toContain("{customer_name}");
    expect(result).toContain("{last_service}");
    expect(result).toContain("{days_inactive}");
    expect(result).toContain("{coupon_link}");
    expect(result).toContain("{business_name}");
  });

  it("customer_reactivation built-in template includes a CTA", () => {
    const result = selectTemplate("customer_reactivation", null, null);
    expect(result).toContain("Te esperamos");
  });

  it("business override takes priority over built-in customer_reactivation", () => {
    const businessTemplates = { customer_reactivation: "Custom: {customer_name}" };
    const result = selectTemplate("customer_reactivation", businessTemplates, null);
    expect(result).toBe("Custom: {customer_name}");
  });
});

describe("_template-engine: renderTemplate", () => {
  it("interpolates standard placeholders", () => {
    const template = "Hola {customer_name}, tu orden #{order_number} de {business_name}";
    const orderData = { customer_name: "Juan", order_number: "123" };
    const businessData = { name: "Maktub Laundry" };

    const result = renderTemplate(template, orderData, businessData);
    expect(result).toBe("Hola Juan, tu orden #123 de Maktub Laundry");
  });

  it("interpolates {total} and {balance}", () => {
    const template = "Total: {total}, Saldo: {balance}";
    const orderData = { total: 25000, balance: 10000 };

    const result = renderTemplate(template, orderData, {});
    expect(result).toBe("Total: 25000, Saldo: 10000");
  });

  it("interpolates {items_text} and {status_label}", () => {
    const template = "Items: {items_text} | Estado: {status_label}";
    const orderData = { items_text: "2x Lavado", status_label: "Listo" };

    const result = renderTemplate(template, orderData, {});
    expect(result).toBe("Items: 2x Lavado | Estado: Listo");
  });

  it("interpolates {custom.*} placeholders from custom_fields", () => {
    const template = "Placa: {custom.plate_number}, Bahía: {custom.bay_number}";
    const orderData = {
      custom_fields: { plate_number: "ABC123", bay_number: "B5" }
    };

    const result = renderTemplate(template, orderData, {});
    expect(result).toBe("Placa: ABC123, Bahía: B5");
  });

  it("replaces unresolved placeholders with empty string", () => {
    const template = "Hola {customer_name}, ref: {unknown_field}";
    const orderData = { customer_name: "Ana" };

    const result = renderTemplate(template, orderData, {});
    expect(result).toBe("Hola Ana, ref: ");
  });

  it("replaces unresolved {custom.*} with empty string", () => {
    const template = "Pet: {custom.pet_name}";
    const orderData = { custom_fields: {} };

    const result = renderTemplate(template, orderData, {});
    expect(result).toBe("Pet: ");
  });

  it("handles null/undefined orderData and businessData gracefully", () => {
    const template = "{customer_name} - {business_name}";
    const result = renderTemplate(template, null, null);
    expect(result).toBe(" - ");
  });

  it("handles empty template string", () => {
    const result = renderTemplate("", { customer_name: "Test" }, { name: "Biz" });
    expect(result).toBe("");
  });

  it("handles null template", () => {
    const result = renderTemplate(null, {}, {});
    expect(result).toBe("");
  });

  it("supports businessData.business_name as alternative key", () => {
    const template = "Negocio: {business_name}";
    const result = renderTemplate(template, {}, { business_name: "Mi Tienda" });
    expect(result).toBe("Negocio: Mi Tienda");
  });

  it("supports orderData.orderNumber as camelCase alternative", () => {
    const template = "Orden #{order_number}";
    const result = renderTemplate(template, { orderNumber: "456" }, {});
    expect(result).toBe("Orden #456");
  });

  it("custom field value of 0 is rendered correctly (not as empty)", () => {
    const template = "Peso: {custom.weight_kg}";
    const orderData = { custom_fields: { weight_kg: 0 } };
    const result = renderTemplate(template, orderData, {});
    expect(result).toBe("Peso: 0");
  });

  it("custom field boolean false is rendered correctly", () => {
    const template = "Delicado: {custom.is_delicate}";
    const orderData = { custom_fields: { is_delicate: false } };
    const result = renderTemplate(template, orderData, {});
    expect(result).toBe("Delicado: false");
  });

  it("interpolates customer_reactivation placeholders correctly", () => {
    const template = selectTemplate("customer_reactivation", null, null);
    const orderData = {
      customer_name: "María",
      last_service: "Lavado Premium",
      days_inactive: 45,
      coupon_link: "https://tiquete.com/coupon/ABC123"
    };
    const businessData = { name: "Maktub Lavandería" };

    const result = renderTemplate(template, orderData, businessData);
    expect(result).toContain("María");
    expect(result).toContain("Maktub Lavandería");
    expect(result).toContain("Lavado Premium");
    expect(result).toContain("45");
    expect(result).toContain("https://tiquete.com/coupon/ABC123");
    expect(result).not.toContain("{customer_name}");
    expect(result).not.toContain("{last_service}");
    expect(result).not.toContain("{days_inactive}");
    expect(result).not.toContain("{coupon_link}");
    expect(result).not.toContain("{business_name}");
  });

  it("renders days_inactive as string when value is 0", () => {
    const template = "Días: {days_inactive}";
    const result = renderTemplate(template, { days_inactive: 0 }, {});
    expect(result).toBe("Días: 0");
  });
});

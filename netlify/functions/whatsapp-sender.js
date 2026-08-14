import { json, parseBody } from "./_utils.js";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = parseBody(event);
    const to = body.to || body.customerPhone;
    const text = body.text || buildOrderMessage(body);
    if (!to || !text) return json(400, { error: "to and text are required" });

    const token = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) return json(200, { dryRun: true, to, text });

    const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: text }
      })
    });

    const result = await response.json();
    return json(response.ok ? 200 : 502, result);
  } catch (error) {
    return json(500, { error: error.message });
  }
};

export function buildOrderMessage(order) {
  const balance = Number(order.balance ?? Math.max(0, Number(order.total || 0) - Number(order.paid || 0)));
  const money = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  const number = order.order_number || order.orderNumber || "nuevo";
  const name = order.customer_name || order.customerName || "Cliente";
  const address = order.address || order.customerAddress || "en tu dirección";
  const items = order.items_text || order.itemsText || "Prendas varias";
  const kilos = order.kilos || order.weightKg || 0;
  const pricePerKg = order.price_per_kg || order.pricePerKg || 0;
  const total = Number(order.total || 0);
  const paid = Number(order.paid || 0);
  const nextPickup = order.next_pickup || order.nextPickup || "por confirmar";
  const bizName = order.business_name || order.businessName || "Maktub Laundry and Care";
  const ticketUrl = `https://tiquetevivo.netlify.app/tiquete.html?number=${number}`;
  const template = order.templateName || order.template || "default";

  switch (template) {
    case "maktub_recogida":
      return [
        `🐧 *${bizName.toUpperCase()}*`,
        `🚚 *Confirmación de Recogida a Domicilio*`,
        ``,
        `Hola *${name}* 👋`,
        `Estamos programando la recogida de tus prendas.`,
        ``,
        `📍 *Dirección de recogida:*`,
        `${address}`,
        ``,
        `🧺 *Detalle del Servicio:*`,
        `• ${items}`,
        ``,
        `⏱️ *Tiempo estimado:* 3 horas tras la recogida.`,
        ``,
        `🌱 *Sigue tu pedido en vivo:*`,
        `${ticketUrl}`,
        ``,
        `¡En breve nuestro domiciliario estará contigo! 🛵✨`
      ].join("\n");

    case "maktub_en_entrega":
      return [
        `🛵 *¡TU PEDIDO VA EN CAMINO!*`,
        `🐧 ${bizName} · Tiquete #${number}`,
        ``,
        `Hola *${name}* 👋`,
        `Tus prendas ya fueron lavadas, secadas y planchadas con la mejor calidad.`,
        ``,
        `💳 *Saldo a pagar al recibir:*`,
        `*${money.format(balance)}* (Aceptamos Nequi, Daviplata o Efectivo)`,
        ``,
        `🌱 *Ver Recibo Digital Completo:*`,
        `${ticketUrl}`,
        ``,
        `¡Gracias por confiar el cuidado de tus prendas en nosotros! ✨`
      ].join("\n");

    case "maktub_remision_b2b":
      return [
        `🏨 *${bizName.toUpperCase()}*`,
        `📋 *Remisión Comercial B2B #${number}*`,
        ``,
        `Estimado(a) *${name}* 👋`,
        ``,
        `🧺 *Detalle de Kilos Procesados:*`,
        `• Kilos Recibidos: ${kilos > 0 ? kilos + ' Kg' : items}`,
        pricePerKg > 0 ? `• Tarifa por Kilo: ${money.format(pricePerKg)}/kg` : '',
        ``,
        `💳 *Resumen de Cuenta:*`,
        `• Total Servicio: ${money.format(total)}`,
        `• Saldo Pendiente: *${money.format(balance)}*`,
        ``,
        `📅 *Próxima Recogida Programada:* ${nextPickup}`,
        ``,
        `🌱 *Ver Remisión Digital Completa:*`,
        `${ticketUrl}`,
        ``,
        `Agradecemos su confianza en nuestro servicio corporativo 🐧`
      ].filter(line => line !== undefined).join("\n");

    case "maktub_cobro":
      return [
        `💸 *RECORDATORIO DE PAGO*`,
        `🐧 ${bizName} · Tiquete #${number}`,
        ``,
        `Hola *${name}* 👋`,
        `Esperamos que te encuentres muy bien.`,
        ``,
        `💳 *Saldo Pendiente de tu Servicio:*`,
        `*${money.format(balance)}*`,
        ``,
        `🏦 *Medios de Pago Disponibles:*`,
        `• Nequi / Daviplata: 310 268 8991`,
        `• Bancolombia Ahorros: 123-456789-01`,
        ``,
        `🌱 *Ver Tiquete Digital:*`,
        `${ticketUrl}`,
        ``,
        `Envíanos el comprobante por este chat. ¡Muchas gracias! 🐧✨`
      ].join("\n");

    default:
      return [
        `🐧 *${bizName.toUpperCase()}*`,
        `📄 *Recibo Digital #${number}*`,
        ``,
        `Hola *${name}* 👋`,
        `¡Gracias por confiar el cuidado de tus prendas en nosotros!`,
        ``,
        `🧺 *Detalle de Prendas / Servicio:*`,
        `• ${items}`,
        ``,
        `💳 *Resumen del Pedido:*`,
        `• Total Servicio: ${money.format(total)}`,
        `• Abono Realizado: ${money.format(paid)}`,
        `• Saldo Pendiente: *${money.format(balance)}*`,
        ``,
        `🌱 *Consulta tu Tiquete Digital 100% Cero Papel:*`,
        `${ticketUrl}`,
        ``,
        `¡Nos aseguraremos de dejar tus prendas impecables! ✨`
      ].join("\n");
  }
}

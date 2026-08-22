---
inclusion: fileMatch
fileMatchPattern: "**/app.html,**/tiquete.html,**/create-order*"
---

# Flujo de Generación de Códigos QR

## Cómo Funciona Actualmente

El QR se genera tras crear un pedido exitosamente:

1. **app.html** crea el pedido vía `POST /api/create-order`
2. Se construye un enlace `wa.me` con el mensaje prellenado usando `buildWaLink(order, template)`
3. Se genera la imagen QR usando la API externa: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={URL_ENCODED_WA_LINK}`
4. El QR se muestra en dos contextos:
   - **Receipt Box**: tras crear pedido (160x160px)
   - **Modal QR**: desde la tabla de pedidos para mostrar en mostrador (200x200px)

## Contenido del QR

El QR codifica una URL de WhatsApp (`wa.me`) que incluye:
- Número del cliente (solo dígitos, con código de país)
- Mensaje completo del recibo (template seleccionado)

Formato: `https://wa.me/{PHONE}?text={ENCODED_MESSAGE}`

## Plantillas de Mensaje Disponibles

- `default` → Recibo estándar
- `maktub_recogida` → Confirmación de recogida a domicilio
- `maktub_en_entrega` → Pedido en camino
- `maktub_remision_b2b` → Remisión B2B por kilos
- `maktub_cobro` → Recordatorio de cobro

## Puntos de Mejora Identificados

- Dependencia de API externa (qrserver.com) — sin fallback
- El QR codifica wa.me, no la URL del tiquete digital
- No hay QR para que el cliente acceda directamente a `tiquete.html`
- No hay generación offline del QR
- El tamaño del QR es fijo y puede no escanearse bien en ciertos dispositivos

## Archivos Relevantes

- `public/app.html` → Lógica de generación del QR (líneas del script)
- `public/tiquete.html` → Vista del tiquete digital (destino alternativo para QR)
- `netlify/functions/create-order.js` → Creación del pedido en backend

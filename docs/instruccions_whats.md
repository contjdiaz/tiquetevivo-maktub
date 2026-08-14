# Configuracion futura: WhatsApp Cloud API

Esta guia documenta como pasar del flujo actual con `wa.me` al envio automatico de mensajes usando WhatsApp Cloud API de Meta.

## Estado actual

Hoy el panel usa este flujo:

1. El usuario crea un pedido.
2. El pedido se guarda en Supabase.
3. El navegador abre un enlace `wa.me` con el mensaje prellenado.
4. Una persona presiona `Enviar` manualmente en WhatsApp.

Este flujo es ideal para una primera demo porque no requiere aprobaciones de Meta ni plantillas.

Limitacion importante: `wa.me` no envia mensajes automaticamente. Solo abre el chat con el texto listo.

## Objetivo futuro

Con WhatsApp Cloud API el flujo sera:

1. El usuario crea un pedido.
2. El pedido se guarda en Supabase.
3. Una Netlify Function llama a la API de Meta.
4. WhatsApp envia el mensaje automaticamente al cliente.
5. El pedido queda marcado con `whatsapp_sent_at` o con un log de envio.

## Requisitos en Meta

Necesitaras:

- Una cuenta de Meta Business.
- Una app en Meta for Developers.
- Producto `WhatsApp` agregado a la app.
- Un numero de WhatsApp Business conectado.
- `Phone Number ID`.
- `WhatsApp Business Account ID`.
- Un access token.
- Plantillas aprobadas para mensajes fuera de la ventana de 24 horas.

## Variables de entorno

En local `.env` y en Netlify Environment Variables:

```env
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=un_token_creado_por_ti
```

Variables ya existentes:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxxxx
SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
```

No expongas `WHATSAPP_TOKEN` en el frontend.

## Endpoint de envio

El proyecto ya tiene una funcion preparada:

```text
netlify/functions/whatsapp-sender.js
```

Endpoint local:

```text
POST http://localhost:8888/api/whatsapp-sender
```

Endpoint publicado:

```text
POST https://TU-SITIO.netlify.app/api/whatsapp-sender
```

Payload esperado:

```json
{
  "to": "573102688991",
  "text": "Hola, tu pedido #8707 esta listo."
}
```

Respuesta esperada cuando no hay credenciales:

```json
{
  "dryRun": true,
  "to": "573102688991",
  "text": "Hola, tu pedido #8707 esta listo."
}
```

Respuesta esperada con credenciales reales:

```json
{
  "messaging_product": "whatsapp",
  "contacts": [
    {
      "input": "573102688991",
      "wa_id": "573102688991"
    }
  ],
  "messages": [
    {
      "id": "wamid..."
    }
  ]
}
```

## Formato del numero

WhatsApp Cloud API espera el numero en formato internacional sin `+`, espacios ni guiones.

Correcto:

```text
573102688991
```

Incorrecto:

```text
+57 310 268 8991
```

## Mensajes libres vs plantillas

WhatsApp Cloud API tiene una regla clave:

- Si el cliente escribio al negocio en las ultimas 24 horas, puedes responder con mensaje libre.
- Si el negocio inicia la conversacion o ya pasaron mas de 24 horas, normalmente necesitas una plantilla aprobada.

Para TiqueteVivo, probablemente necesitaremos plantillas como:

- `order_created`: recibo inicial del pedido.
- `order_ready`: aviso de pedido listo.
- `payment_reminder`: recordatorio de saldo pendiente.
- `pickup_reminder`: recordatorio de recogida.
- `legal_notice_45_days`: preaviso antes de politica de abandono, si aplica legalmente.

## Ejemplo de envio de texto

La funcion actual usa un request parecido a este:

```js
await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    messaging_product: "whatsapp",
    to: "573102688991",
    type: "text",
    text: {
      preview_url: false,
      body: "Hola, tu pedido #8707 esta listo."
    }
  })
});
```

## Ejemplo de envio con plantilla

Ejemplo conceptual:

```json
{
  "messaging_product": "whatsapp",
  "to": "573102688991",
  "type": "template",
  "template": {
    "name": "order_ready",
    "language": {
      "code": "es_CO"
    },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Richard" },
          { "type": "text", "text": "8707" },
          { "type": "text", "text": "$190.000" }
        ]
      }
    ]
  }
}
```

## Cambio recomendado en create-order

Hoy `public/app.html` abre `wa.me` despues de crear el pedido.

Cuando pasemos a envio automatico, el flujo recomendado sera:

1. `public/app.html` llama a `/api/create-order`.
2. `create-order.js` guarda el pedido en Supabase.
3. `create-order.js` llama internamente a `sendWhatsAppMessage(order)`.
4. Si Meta responde bien, se actualiza `orders.whatsapp_sent_at`.
5. El frontend muestra `Recibo enviado automaticamente`.

Pseudo flujo:

```js
const order = await saveOrder(payload);
const whatsappResult = await sendWhatsAppMessage({
  to: order.customer_phone,
  text: buildOrderMessage(order)
});
await markOrderAsSent(order.id, whatsappResult.messages?.[0]?.id);
return json(201, { order, whatsapp: whatsappResult });
```

## Cambios sugeridos en base de datos

La tabla `orders` ya tiene:

```sql
whatsapp_sent_at timestamptz
```

Para una version mas robusta, agregar una tabla de logs:

```sql
create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  business_id uuid references businesses(id) on delete cascade,
  phone text not null,
  template_name text,
  message_body text,
  meta_message_id text,
  status text not null default 'SENT',
  error_message text,
  created_at timestamptz not null default now()
);
```

Estados sugeridos:

```text
QUEUED
SENT
DELIVERED
READ
FAILED
```

## Webhook de Meta

Para saber si un mensaje fue entregado, leido o fallo, Meta envia eventos a un webhook.

Crear una funcion futura:

```text
netlify/functions/whatsapp-webhook.js
```

Rutas:

```text
GET  /api/whatsapp-webhook  -> verificacion de Meta
POST /api/whatsapp-webhook  -> eventos de mensajes
```

Variables:

```env
WHATSAPP_VERIFY_TOKEN=un_token_creado_por_ti
```

Verificacion GET conceptual:

```js
if (
  event.queryStringParameters["hub.mode"] === "subscribe" &&
  event.queryStringParameters["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN
) {
  return {
    statusCode: 200,
    body: event.queryStringParameters["hub.challenge"]
  };
}
return { statusCode: 403, body: "Forbidden" };
```

## Seguridad

- Nunca poner `WHATSAPP_TOKEN` en `public/app.html`.
- Nunca poner `SUPABASE_SECRET_KEY` en el frontend.
- Guardar secretos solo en `.env` local y Netlify Environment Variables.
- Agregar autenticacion antes de permitir uso real por varios negocios.
- Validar que un negocio solo pueda enviar mensajes de sus propios pedidos.
- Registrar errores de Meta para soporte.

## Costos y aprobaciones

WhatsApp Cloud API puede cobrar por conversacion o mensaje segun las tarifas vigentes de Meta y el pais. Antes de vender planes, validar:

- Costo por conversacion en Colombia.
- Limites del numero.
- Calidad del numero de WhatsApp Business.
- Plantillas necesarias y aprobacion.
- Politicas de consentimiento del cliente.

## Plan de migracion desde wa.me

Fase 1 actual:

```text
Guardar pedido -> abrir wa.me -> envio manual
```

Fase 2 recomendada:

```text
Guardar pedido -> llamar whatsapp-sender -> envio automatico -> guardar whatsapp_sent_at
```

Fase 3 avanzada:

```text
Guardar pedido -> cola de mensajes -> envio automatico -> webhook de estados -> logs y reintentos
```

## Checklist futuro

- [ ] Crear Meta Business y app.
- [ ] Agregar producto WhatsApp.
- [ ] Obtener `WHATSAPP_PHONE_NUMBER_ID`.
- [ ] Crear token permanente o administrado de forma segura.
- [ ] Configurar variables en Netlify.
- [ ] Probar `/api/whatsapp-sender` con un numero permitido.
- [ ] Crear plantillas aprobadas.
- [ ] Modificar `create-order.js` para envio automatico.
- [ ] Agregar logs de mensajes.
- [ ] Agregar webhook de estados.
- [ ] Agregar consentimiento del cliente en el flujo de pedido.
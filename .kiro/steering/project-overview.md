# TiqueteVivo — Visión General del Proyecto

## Descripción

TiqueteVivo es una plataforma SaaS para lavanderías que reemplaza los tiquetes de papel por recibos digitales enviados por WhatsApp. El MVP permite crear pedidos, generar tiquetes digitales con código QR, y enviar recibos por WhatsApp.

## Stack Tecnológico

- **Frontend**: HTML/CSS/JS vanilla (sin frameworks), servido desde `public/`
- **Backend**: Netlify Functions (serverless, Node.js ES Modules)
- **Base de datos**: Supabase (PostgreSQL con RLS)
- **Integraciones**: WhatsApp (wa.me manual + Cloud API preparado), Google Sheets (espejo admin)
- **QR**: API externa `api.qrserver.com`
- **Deploy**: Netlify (publish: public, functions: netlify/functions)

## Estructura del Proyecto

```
public/
  index.html        → Landing page comercial
  app.html          → Panel administrativo de la lavandería
  tiquete.html      → Vista pública del tiquete digital (cliente)
netlify/functions/
  _utils.js         → Helpers compartidos (json, parseBody, supabaseAdmin, slugify, getBusinessBySlug)
  _sheets.js        → Integración Google Sheets
  create-order.js   → POST /api/create-order
  list-orders.js    → GET /api/list-orders?slug=X
  save-business.js  → POST /api/save-business
  update-order.js   → POST|PUT /api/update-order
  whatsapp-sender.js→ POST /api/whatsapp-sender
  save-lead.js      → POST /api/save-lead
supabase/
  schema.sql        → Esquema completo de la BD
docs/               → Documentación de integraciones
```

## Flujo Principal

1. Operador crea pedido en `app.html`
2. Netlify Function guarda en Supabase
3. Se genera QR con enlace wa.me (mensaje prellenado)
4. Cliente escanea QR → abre WhatsApp → operador envía manualmente
5. Cliente consulta su tiquete digital en `tiquete.html?number=XXXX`

## Convenciones

- ES Modules (`import`/`export`, `"type": "module"`)
- Variables de entorno en `.env` (nunca en frontend)
- Formato monetario: COP con `Intl.NumberFormat("es-CO")`
- Slug del negocio como identificador principal (default: "majesty")
- Estados de pedido: RECEIVED → IN_PROGRESS → READY → DELIVERED | CANCELLED

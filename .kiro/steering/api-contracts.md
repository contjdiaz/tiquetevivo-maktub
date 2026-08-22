---
inclusion: fileMatch
fileMatchPattern: "**/netlify/functions/**"
---

# Contratos API — TiqueteVivo

## Endpoints

### POST /api/create-order
Crea un nuevo pedido.

**Body:**
```json
{
  "slug": "majesty",
  "customerName": "string (required)",
  "customerPhone": "string (required, formato +57...)",
  "itemsText": "string (required)",
  "total": 25000,
  "paid": 10000,
  "status": "RECEIVED",
  "dueDate": "2024-12-01",
  "rackLocation": "Estante B-04",
  "isDelicate": false,
  "orderNumber": "opcional, se autogenera"
}
```

**Response 201:** Objeto order completo con `id`, `balance`, `created_at`

### GET /api/list-orders
Lista pedidos de un negocio.

**Query params:**
- `slug` (default: "majesty")
- `status` (opcional, filtrar por estado)
- `limit` (default: 100)

**Response 200:** Array de orders

### POST/PUT /api/update-order
Actualiza campos de un pedido existente.

**Body:**
```json
{
  "id": "uuid (required)",
  "slug": "majesty",
  "status": "READY",
  "paid": 25000,
  "rackLocation": "Perchero 5"
}
```

### POST /api/save-business
Crea o actualiza un negocio (upsert por slug).

**Body:**
```json
{
  "name": "string (required)",
  "slug": "auto-generado desde name",
  "phone": "+573001234567",
  "address": "Calle 50 #21-15",
  "city": "Medellin",
  "color": "#18a058",
  "logoUrl": "https://..."
}
```

### POST /api/save-lead
Guarda un lead (prospecto) del formulario de la landing.

**Body:**
```json
{
  "business": "Nombre Lavandería (required)",
  "name": "Contacto (required)",
  "phone": "+57... (required)",
  "city": "Medellin"
}
```

### POST /api/whatsapp-sender
Envía mensaje por WhatsApp Cloud API.

**Body:**
```json
{
  "to": "573102688991",
  "text": "Mensaje a enviar"
}
```

**Sin credenciales:** `{ "dryRun": true, "to": "...", "text": "..." }`

## Headers Comunes

Todas las respuestas incluyen:
- `Access-Control-Allow-Origin: *`
- `Content-Type: application/json`

## Manejo de Errores

- 400: Campos requeridos faltantes
- 405: Método HTTP no permitido
- 500: Error interno (body incluye `{ "error": "mensaje" }`)

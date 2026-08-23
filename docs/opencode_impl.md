# Implementación: Evidencia fotográfica y confirmación digital

## Resumen

Se agregó la capacidad de capturar, comprimir y mostrar evidencia fotográfica y confirmaciones digitales en el ciclo de vida de una orden:

- **Foto al recibir** (`intake`): se toma al crear el tiquete.
- **Foto al entregar** (`delivery`): se toma opcionalmente al marcar la orden como entregada.
- **Confirmación digital al recibir**: el operador puede marcar que el cliente aceptó la recepción con timestamp e IP.
- **Confirmación digital al entregar**: el cliente confirma en el tiquete digital que recibió su pedido con timestamp e IP.
- Fotos y confirmaciones se muestran en el tiquete digital del cliente y en el panel del operador.

## Archivos modificados / creados

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/005_add_photo_evidence.sql` | Nueva migración con 4 columnas de fotos en `orders` |
| `supabase/migrations/006_add_digital_confirmation.sql` | Nueva migración con 4 columnas de confirmación en `orders` |
| `supabase/schema.sql` | DDL inicial actualizado con columnas de fotos y confirmaciones |
| `netlify/functions/create-order.js` | Recibe y guarda `intakePhoto` y `intakeConfirmed` |
| `netlify/functions/update-order.js` | Recibe y guarda `deliveryPhoto` y `deliveryConfirmed` |
| `netlify/functions/_utils.js` | Helper `getClientIp` para capturar IP del cliente |
| `public/app.html` | Campo de foto de recepción, checkbox de confirmación + modal de foto de entrega |
| `public/app.js` | Compresión de imágenes, envío de fotos/confirmaciones, modal de entrega |
| `public/tiquete.html` | Muestra fotos y botones de confirmación digital del cliente |
| `tests/create-order.photo-evidence.test.js` | Tests de foto de recepción |
| `tests/update-order.photo-evidence.test.js` | Tests de foto de entrega |
| `tests/create-order.digital-confirmation.test.js` | Tests de confirmación de recepción |
| `tests/update-order.digital-confirmation.test.js` | Tests de confirmación de entrega |

## Script SQL a ejecutar en Supabase

Ejecutar en el SQL Editor de Supabase (o en `psql`):

```sql
-- Migration: Add photo evidence columns to orders
-- Requirements: photo evidence of intake and delivery

-- Photo taken when the item is received (intake)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_photo_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_photo_taken_at timestamptz;

-- Photo taken when the order is delivered
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_photo_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_photo_taken_at timestamptz;

-- Digital confirmation when the item is received (intake)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_confirmed_ip text;

-- Digital confirmation when the order is delivered
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_confirmed_ip text;
```

> Alternativamente, si tienes configurado un proyecto de Supabase con CLI/migraciones, puedes ejecutar los archivos `supabase/migrations/005_add_photo_evidence.sql` y `supabase/migrations/006_add_digital_confirmation.sql`.

## Cómo comprobar los cambios en local

### 1. Requisitos previos

- Node.js instalado.
- Variables de entorno configuradas (ver `.env.example`):
  - `SUPABASE_URL`
  - `SUPABASE_SECRET_KEY`
  - `WHATSAPP_TOKEN` (opcional para pruebas locales)
  - `WHATSAPP_PHONE_NUMBER_ID` (opcional)

### 2. Instalar dependencias

```bash
npm install
```

### 3. Ejecutar tests

```bash
npm test
```

Deben pasar todos los tests (incluidos los nuevos de evidencia fotográfica).

### 4. Verificar sintaxis de funciones Netlify

```bash
npm run check
```

### 5. Levantar servidor local

```bash
npm run dev
# o
netlify dev
```

Por defecto se levanta en `http://localhost:8888`.

## Cómo probar la funcionalidad manualmente

### Panel del operador (`/app.html`)

1. Abre `http://localhost:8888/app.html?slug=majesty`.
2. En el formulario de nuevo tiquete:
   - Usa el campo **"Evidencia fotográfica al recibir"** para tomar una foto.
   - Marca **"✅ Cliente confirma recepción conforme"** si aplica.
3. Crea el tiquete.
4. Cambia el estado de la orden **siguiendo el flujo secuencial**:
   - **Recibido** → **En proceso** → **Listo** → **Entregado**
5. Solo cuando llegues a **"Entregado"** aparecerá el modal pidiendo una **foto de entrega**:
   - Puedes tomarla y confirmar, u omitir el paso.
6. El estado se actualiza en la nube.

> ⚠️ **Importante**: el backend valida transiciones de estado secuenciales. Si intentas cambiar directamente de un estado intermedio (por ejemplo, "En proceso") a "Entregado", la petición será rechazada con error 400 y la foto no se guardará.

### Tiquete digital del cliente (`/tiquete.html`)

1. Abre el tiquete generado, por ejemplo:
   ```
   http://localhost:8888/tiquete.html?number=<NUMERO_TIQUETE>&slug=majesty
   ```
2. Si la orden tiene fotos, aparece la sección **"📸 Evidencia fotográfica"** con:
   - **Al recibir** (intake)
   - **Al entregar** (delivery)
3. Si la orden aún no tiene confirmación de recepción, aparece el botón **"Confirmar recepción conforme"**.
4. Si la orden está entregada, aparece el botón **"Confirmar entrega conforme"**.
5. Al confirmar, se guarda el timestamp y la IP del cliente.

### Verificación en Supabase

Después de crear/entregar una orden con foto, consulta la fila en la tabla `orders`:

```sql
SELECT
  order_number,
  intake_photo_url,
  intake_photo_taken_at,
  delivery_photo_url,
  delivery_photo_taken_at,
  intake_confirmed_at,
  intake_confirmed_ip,
  delivery_confirmed_at,
  delivery_confirmed_ip
FROM orders
WHERE order_number = '<NUMERO_TIQUETE>';
```

Las columnas `*_photo_url` deben contener un data URL de imagen JPEG, las columnas `*_photo_taken_at` deben tener una fecha/hora, y las columnas `*_confirmed_at`/`*_confirmed_ip` registran las confirmaciones digitales.

## Notas técnicas

- Las imágenes se comprimen en el navegador a **JPEG de máximo 800 px** de ancho/alto, calidad 0.8.
- Esto mantiene el tamaño manejable para almacenar en la base de datos como `text` (data URL base64).
- Si no se envía foto o confirmación, las columnas permanecen `NULL` (retrocompatible).
- El modal de entrega es **no bloqueante**: el operador puede omitir la foto y el estado igual se actualiza.
- El backend valida que los cambios de estado sean **secuenciales** según el `status_flow_config` del negocio. Saltar estados produce un error 400.
- La confirmación digital captura **timestamp e IP** del cliente mediante headers como `x-nf-client-connection-ip` o `x-forwarded-for`.
- Las confirmaciones son evidencia operativa; no constituyen firma legal manuscrita.

## Rama de trabajo

Estos cambios están en la rama:

```bash
git branch
# ft/impact-changes
```

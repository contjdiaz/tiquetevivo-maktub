# Estándares de Código — TiqueteVivo

## JavaScript

- ES Modules: usar `import`/`export` (no `require`/`module.exports`)
- Netlify Functions: exportar `handler` como función async
- Manejar siempre OPTIONS para CORS
- Validar HTTP method al inicio de cada función
- Usar `json()` helper de `_utils.js` para respuestas
- Usar `parseBody()` para parsear body de requests
- Errores: retornar `json(statusCode, { error: message })`

## Netlify Functions

- Ubicación: `netlify/functions/`
- Archivos compartidos con prefijo `_` (ej: `_utils.js`, `_sheets.js`)
- Cada función debe manejar:
  1. CORS (OPTIONS → 200)
  2. Method check (405 si no aplica)
  3. Validación de inputs (400 si faltan campos)
  4. Try/catch con json(500) en errores

## Frontend

- HTML/CSS/JS vanilla (sin frameworks ni bundlers)
- Responsive con CSS Grid y media queries
- Variables CSS en `:root` para theming
- Font: Inter (Google Fonts)
- Funciones async/await para API calls
- localStorage como fallback cuando Supabase no responde
- Modo "demo" si no hay conexión a la nube

## Base de Datos (Supabase)

- Tablas en snake_case
- UUIDs como primary keys
- `created_at` y `updated_at` con triggers automáticos
- RLS habilitado (MVP: policies permisivas)
- `balance` como columna generada (`total - paid`)
- Relaciones con `ON DELETE CASCADE` o `SET NULL`

## Variables de Entorno

- `SUPABASE_URL` y `SUPABASE_SECRET_KEY` obligatorias para backend
- `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` opcionales (dry-run sin ellas)
- `GOOGLE_SHEETS_WEBHOOK_URL` y `GOOGLE_SHEETS_WEBHOOK_TOKEN` opcionales
- Nunca exponer secrets en archivos del directorio `public/`

## Nombres y Convenciones

- API endpoints: `/api/verb-noun` (ej: `/api/create-order`, `/api/list-orders`)
- Campos DB: `snake_case`
- Campos JS frontend: `camelCase`
- Las funciones normalizan entre ambos formatos
- Moneda: siempre COP, sin decimales, formateada con `Intl.NumberFormat`

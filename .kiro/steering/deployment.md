---
inclusion: manual
---

# Guía de Despliegue y Desarrollo Local

## Desarrollo Local

```powershell
cd C:\Proyectos_Prueba\PersonalBusiness\Lavanderias\Tiquete-netlify
npm install
npm run dev
```

URLs:
- Landing: http://localhost:8888
- Panel: http://localhost:8888/app.html
- Tiquete: http://localhost:8888/tiquete.html?number=8707

## Verificar Sintaxis

```powershell
npm run check
```

## Variables de Entorno Requeridas

Archivo `.env` en la raíz:
```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxx
```

Opcionales:
```env
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
GOOGLE_SHEETS_WEBHOOK_URL=
GOOGLE_SHEETS_WEBHOOK_TOKEN=
```

## Deploy a Netlify

1. Push a GitHub
2. Conectar repo en Netlify
3. Configurar:
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Agregar variables de entorno en Netlify dashboard
5. Deploy automático en cada push

## Configurar Supabase

1. Crear proyecto en supabase.com
2. SQL Editor → ejecutar `supabase/schema.sql`
3. Verificar tablas: `businesses`, `orders`, `whatsapp_messages`
4. Verificar negocio seed: `slug = 'majesty'`

## Pruebas Manuales

```powershell
# Listar pedidos
Invoke-RestMethod "http://localhost:8888/api/list-orders?slug=majesty"

# Crear pedido
Invoke-RestMethod -Method Post "http://localhost:8888/api/create-order" -ContentType "application/json" -Body '{"slug":"majesty","customerName":"Test","customerPhone":"+573102688991","itemsText":"1 camisa","total":25000,"paid":10000}'
```

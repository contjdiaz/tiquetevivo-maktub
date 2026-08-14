# TiqueteVivo Netlify + Supabase

Mini app para demostrar TiqueteVivo: una landing comercial y un panel donde una lavanderia crea pedidos, guarda datos en Supabase y abre WhatsApp con el recibo listo para enviar al cliente.

## Que incluye

- `public/index.html`: landing para promocionar el producto.
- `public/app.html`: panel demo para crear tiquetes, ver metricas y abrir WhatsApp.
- `netlify/functions/create-order.js`: guarda pedidos en Supabase.
- `netlify/functions/list-orders.js`: lista pedidos guardados.
- `netlify/functions/save-business.js`: crea o actualiza negocios.
- `netlify/functions/whatsapp-sender.js`: preparado para WhatsApp Cloud API de Meta.
- `supabase/schema.sql`: estructura de base de datos.
- `GUIA_PRUEBA_LOCAL.md`: guia detallada para probar Supabase + WhatsApp en local.

## Flujo actual de la demo

1. El usuario crea un tiquete desde `app.html`.
2. La Netlify Function intenta guardar el pedido en Supabase.
3. Si Supabase esta configurado, el panel muestra `Guardado en la nube`.
4. Se abre WhatsApp con `wa.me` y el mensaje del recibo prellenado.
5. Para esta fase, el envio se confirma manualmente presionando `Enviar` en WhatsApp.

`wa.me` no permite envio automatico sin intervencion del usuario. El envio automatico real se agregara despues con WhatsApp Cloud API de Meta.

## Variables de entorno

Crea un archivo `.env` en la raiz del proyecto:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxxx
SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
```

Notas:

- `SUPABASE_SECRET_KEY` se usa solo en Netlify Functions, nunca en el frontend.
- `SUPABASE_PUBLISHABLE_KEY` queda disponible para una etapa futura con login o consultas desde cliente.
- `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` pueden quedar vacios mientras uses `wa.me`.
- No subas `.env` a GitHub.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre `SQL Editor`.
3. Ejecuta completo el archivo `supabase/schema.sql`.
4. Verifica en `Table Editor` que existan:
   - `businesses`
   - `orders`
5. En `businesses` debe existir una fila con `slug = majesty`.
6. En el boton `Connect`, opcion `Server`, copia:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_PUBLISHABLE_KEY`

## Probar localmente

Instala dependencias:

```powershell
cd C:\Proyectos_Prueba\PersonalBusiness\Lavanderias\Tiquete-netlify
npm install
```

Crea o actualiza `.env` con tus llaves de Supabase.

Levanta Netlify Dev:

```powershell
npm run dev
```

Abre:

```text
http://localhost:8888
http://localhost:8888/app.html
```

## Verificar conexion con Supabase

En otra terminal:

```powershell
Invoke-RestMethod "http://localhost:8888/api/list-orders?slug=majesty"
```

Resultados esperados:

- `[]`: conexion correcta, aun no hay pedidos.
- Lista de objetos: conexion correcta con pedidos existentes.
- Error de variables: revisa `.env` y reinicia `npm run dev`.

## Probar pedido + WhatsApp

1. Abre `http://localhost:8888/app.html`.
2. Crea un pedido con el numero `+573102688991` o el numero del cliente.
3. Presiona `Crear tiquete y abrir WhatsApp`.
4. Confirma que el panel muestra `Guardado en la nube`.
5. En Supabase, abre `Table Editor > orders` y verifica el registro.
6. En WhatsApp, revisa el mensaje prellenado y presiona `Enviar`.

## Publicar en Netlify

1. Sube el proyecto a GitHub.
2. En Netlify crea un nuevo sitio desde ese repositorio.
3. Netlify leera `netlify.toml`.
4. Configuracion esperada:
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
5. Agrega en Netlify las mismas variables de entorno:
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `WHATSAPP_TOKEN` opcional
   - `WHATSAPP_PHONE_NUMBER_ID` opcional
6. Ejecuta deploy.

## WhatsApp Cloud API despues

El archivo `netlify/functions/whatsapp-sender.js` esta preparado para Meta WhatsApp Cloud API.

Cuando tengas credenciales oficiales de Meta, configura:

```env
WHATSAPP_TOKEN=tu_token_de_meta
WHATSAPP_PHONE_NUMBER_ID=tu_phone_number_id
```

Luego cambiaremos el flujo para que, despues de guardar el pedido, el servidor envie el mensaje automaticamente sin abrir WhatsApp Web.

## Migracion futura a AWS

La migracion a AWS no deberia ser compleja si mantenemos el contrato API estable:

- `/api/save-business`
- `/api/list-orders?slug=majesty`
- `/api/create-order`
- `/api/whatsapp-sender`

En AWS, las Netlify Functions se reemplazan por API Gateway + Lambda. Supabase/Postgres puede migrar a RDS Postgres, Aurora Serverless o DynamoDB segun el modelo final del producto.
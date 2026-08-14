# Guia de prueba local: Supabase + WhatsApp

Esta guia te permite demostrar dos cosas frente al cliente:

1. El pedido queda guardado en la base de datos.
2. El recibo queda listo para enviar por WhatsApp usando `wa.me`.

## 1. Crear proyecto en Supabase

1. Entra a https://supabase.com y crea un proyecto.
2. Abre `SQL Editor`.
3. Ejecuta el archivo `supabase/schema.sql` completo.
4. Ve al panel `Table Editor` y confirma que existen las tablas:
   - `businesses`
   - `orders`
5. En `businesses` debe existir el negocio `majesty`.

## 2. Configurar variables locales

En la raiz del proyecto crea o edita `.env`:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
```

Para este MVP usamos `SUPABASE_SERVICE_ROLE_KEY` solo en Netlify Functions, nunca en el navegador.

Supabase indica que las llaves elevadas como `service_role`/secret keys son para componentes backend y pueden saltarse RLS, asi que no deben exponerse en HTML ni JS publico.

## 3. Instalar y correr local

```powershell
cd C:\Proyectos_Prueba\PersonalBusiness\Lavanderias\Tiquete-netlify
npm install
npm run dev
```

Abre:

```text
http://localhost:8888/app.html
```

## 4. Probar almacenamiento

1. En el panel crea un pedido con el numero `+573102688991`.
2. Presiona `Crear tiquete y abrir WhatsApp`.
3. Si Supabase esta bien configurado, el panel lateral debe decir `Guardado en la nube`.
4. En Supabase, abre `Table Editor > orders` y verifica el pedido creado.
5. Tambien puedes probar desde consola:

```powershell
Invoke-RestMethod "http://localhost:8888/api/list-orders?slug=majesty"
```

## 5. Probar WhatsApp con wa.me

El boton genera un enlace con este formato:

```text
https://wa.me/573102688991?text=MENSAJE_CODIFICADO
```

WhatsApp abre el chat con el mensaje prellenado. Para esta primera demo debes presionar `Enviar` manualmente. El envio automatico real se conecta despues con WhatsApp Cloud API de Meta.

Regla importante: el numero debe ir con codigo de pais y solo digitos. Ejemplo correcto para Colombia:

```text
573102688991
```

## 6. Que mostrar al cliente

1. Crear un pedido en vivo.
2. Mostrar que aparece en la tabla.
3. Mostrar que las metricas cambian.
4. Mostrar en Supabase que el registro existe.
5. Abrir WhatsApp y enviar el recibo.
6. Mostrar que el cliente recibe el mensaje.

## 7. Cuando pasemos a Meta Cloud API

Reemplazaremos el flujo manual de `wa.me` por el endpoint `netlify/functions/whatsapp-sender.js`, usando:

```env
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
```

En ese punto el envio si podra salir desde servidor sin abrir WhatsApp Web.
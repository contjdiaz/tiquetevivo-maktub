# TiqueteVivo Netlify + Supabase

Plataforma de retencion de clientes para negocios de servicio. Incluye tiquetes digitales con QR, panel de administracion, envio automatico por WhatsApp, tarjeta de fidelidad digital, conciliacion automatica de pagos y recordatorios inteligentes de reactivacion.

## Funcionalidades

### Tiquetes Digitales + WhatsApp

- Creacion de pedidos desde el panel (`app.html`)
- Tiquete digital con codigo QR para el cliente (`tiquete.html`)
- Envio automatico de recibo por WhatsApp Cloud API de Meta
- Seguimiento de estados con notificaciones al cliente

### Tarjeta de Fidelidad Digital (Loyalty)

- Acumulacion automatica de sellos al entregar un pedido
- Widget visual de progreso en el tiquete digital (accesible con ARIA)
- Recompensa al alcanzar el numero configurado de sellos (default: 5)
- Redencion unica de recompensas con reset automatico del contador
- Configuracion por negocio: habilitado/deshabilitado, numero de sellos objetivo

### Conciliacion Automatica de Pagos

- Boton "Pagar Saldo Pendiente" en el tiquete digital
- Integracion con Wompi (Nequi, PSE, tarjeta) y Bold
- Procesamiento automatico de webhooks con verificacion criptografica
- Pagos parciales y totales con conciliacion contra saldo
- Notificacion WhatsApp de confirmacion de pago
- Idempotencia: webhooks duplicados no generan doble cobro

### Recordatorios Inteligentes de Reactivacion

- Cron diario que identifica clientes inactivos por negocio
- Segmentacion inteligente: umbral fijo + frecuencia dinamica
- Mensajes personalizados con cupones unicos y trackeables
- Anti-spam: ventana horaria (8AM-8PM), cooldown 15 dias, opt-out
- Limites por plan (free: 10/mes, paid: configurable)
- Cupones con expiracion, tipo (porcentaje, monto fijo, envio gratis) y single-use

## Que incluye

```
public/
├── index.html              Landing comercial
├── app.html                Panel de administracion
├── tiquete.html            Tiquete digital del cliente
└── js/
    ├── loyalty-widget.js   Widget visual de sellos
    └── payment-button.js   Boton de pago online

netlify/functions/
├── create-order.js         Crear pedidos
├── list-orders.js          Listar pedidos (incluye loyalty data)
├── update-order.js         Actualizar estado (dispara sellos)
├── save-business.js        Crear/actualizar negocios
├── manage-business.js      Configuracion de negocio (loyalty, reactivation)
├── get-business-config.js  Exponer configuracion publica
├── whatsapp-sender.js      Envio WhatsApp Cloud API
├── _whatsapp.js            Modulo compartido WhatsApp
├── _template-engine.js     Motor de plantillas
├── _loyalty.js             Modulo compartido de fidelidad
├── _payments.js            Modulo compartido de pagos
├── payments-webhook.js     Procesador de webhooks de pago
├── create-payment-intent.js  Generar link/checkout de pago
├── cron-reactivation.js    Cron de reactivacion (scheduled)
├── validate-coupon.js      Validacion y redencion de cupones
└── _validators.js          Validadores compartidos

supabase/migrations/
├── 011_add_customer_loyalty.sql
├── 012_add_payments.sql
└── 013_add_reactivation.sql
```

## Variables de entorno

Crea un archivo `.env` en la raiz del proyecto (ver `.env.example` para referencia):

```env
# ─── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxxx
SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx

# ─── WhatsApp Cloud API ──────────────────────────────────────────────────────
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

# ─── Google Sheets (opcional) ────────────────────────────────────────────────
GOOGLE_SHEETS_WEBHOOK_URL=
GOOGLE_SHEETS_WEBHOOK_TOKEN=

# ─── Admin Panel ─────────────────────────────────────────────────────────────
ADMIN_USERNAME=admin
ADMIN_PASSWORD=TiqueteVivo2024$

# ─── Payment Gateway (Wompi) ────────────────────────────────────────────────
WOMPI_PUBLIC_KEY=               # Llave publica para widget de checkout
WOMPI_PRIVATE_KEY=              # Llave privada para llamadas server-side
WOMPI_INTEGRITY_SECRET=         # Secreto para verificar checksums de integridad
WOMPI_EVENTS_SECRET=            # Secreto para validar firmas de webhooks

# ─── Payment Gateway (Bold) ─────────────────────────────────────────────────
BOLD_API_KEY=                   # API key para generar links de pago Bold
BOLD_SECRET=                    # Secreto para validar webhooks Bold (HMAC-SHA256)

# ─── Feature Flags ──────────────────────────────────────────────────────────
PAYMENTS_GATEWAY=disabled       # WOMPI | BOLD | disabled
REACTIVATION_ENABLED=false      # true | false (kill switch global)
```

Notas:

- `SUPABASE_SECRET_KEY` se usa solo en Netlify Functions (server-side), nunca en el frontend.
- `WOMPI_EVENTS_SECRET` es diferente de `WOMPI_INTEGRITY_SECRET`: events valida webhooks, integrity valida checksums de transacciones.
- Usa `PAYMENTS_GATEWAY=disabled` para desactivar pagos sin quitar las llaves.
- `REACTIVATION_ENABLED=false` detiene el cron de reactivacion globalmente.
- No subas `.env` a GitHub (ya esta en `.gitignore`).

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre `SQL Editor`.
3. Ejecuta `supabase/schema.sql` (estructura base).
4. Ejecuta las migraciones en orden:
   - `supabase/migrations/011_add_customer_loyalty.sql`
   - `supabase/migrations/012_add_payments.sql`
   - `supabase/migrations/013_add_reactivation.sql`
5. Verifica en `Table Editor` que existan todas las tablas:
   - `businesses`, `orders`, `customer_loyalty`, `loyalty_events`, `payments`, `coupons`, `reactivation_log`
6. Copia tus llaves de conexion desde `Settings > API`.

## Probar localmente

```powershell
cd C:\Proyectos_Prueba\PersonalBusiness\Lavanderias\Tiquete-netlify
npm install
npm run dev
```

Abre:

```text
http://localhost:8888              (landing)
http://localhost:8888/app.html    (panel admin)
http://localhost:8888/tiquete.html?slug=majesty&order=ORDER_ID  (tiquete)
```

Para instrucciones detalladas de prueba incluyendo pagos sandbox y fidelidad, ver `GUIA_PRUEBA_LOCAL.md`.

## Registrar Webhooks de Pago

### Wompi

1. Entra al dashboard de Wompi: https://comercios.wompi.co
2. Ve a **Desarrolladores > Webhooks** (o **Eventos** segun la version del dashboard).
3. Agrega un nuevo webhook con:
   - **URL**: `https://TU-SITIO.netlify.app/api/payments-webhook`
   - **Eventos**: `transaction.updated` (o todos los eventos de transaccion)
4. Copia el **Events Secret** que genera Wompi y ponlo en `WOMPI_EVENTS_SECRET`.
5. Para sandbox usa: https://sandbox.wompi.co/dashboard (misma ruta).

### Bold

1. Entra al dashboard de Bold: https://bold.co/dashboard
2. Ve a **Integraciones > Webhooks**.
3. Agrega un nuevo webhook con:
   - **URL**: `https://TU-SITIO.netlify.app/api/payments-webhook`
   - **Eventos**: notificaciones de pago
4. Copia el **Secret** y ponlo en `BOLD_SECRET`.

> **Nota para desarrollo local**: Los webhooks requieren una URL publica. Usa un tunel como `ngrok` o `cloudflared` para exponer tu localhost:8888 y prueba con la URL del tunel.

## Publicar en Netlify

1. Sube el proyecto a GitHub.
2. En Netlify crea un nuevo sitio desde ese repositorio.
3. Netlify leera `netlify.toml`.
4. Configuracion esperada:
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
5. Agrega todas las variables de entorno (ver seccion arriba).
6. Ejecuta deploy.
7. Registra la URL de webhooks en Wompi/Bold con el dominio de produccion.
8. El cron de reactivacion (`cron-reactivation`) se activa automaticamente en deploy.

## Verificar sintaxis de funciones

```powershell
npm run check
```

Este comando valida que todas las Netlify Functions compilen correctamente.

# TiqueteVivo — Diseño Frontend & Mejoras UI

**Fecha:** Agosto 2026  
**Proyecto:** TiqueteVivo Netlify  
**Stack:** HTML/CSS/JS vanilla + Netlify Functions + Supabase

---

## Arquitectura de la UI

El frontend está organizado como una SPA ligera sin framework, usando módulos JS independientes (IIFE pattern) que se cargan como scripts separados. Esto permite:

- Caching individual por módulo en el Service Worker
- Carga incremental sin bundler
- Compatibilidad total con la capa gratuita de Netlify (no hay build step)

### Estructura de archivos frontend

```
public/
├── app.html              → Panel principal de negocios
├── app.js                → Lógica principal (pedidos, config, render)
├── admin.html            → Panel de administración
├── index.html            → Landing page comercial
├── registro.html         → Registro de nuevos negocios
├── tiquete.html          → Recibo digital del cliente
├── manifest.json         → PWA manifest
├── sw.js                 → Service Worker (offline + caching)
├── icons/
│   ├── icon-192.svg      → Icono PWA 192px
│   └── icon-512.svg      → Icono PWA 512px
└── js/
    ├── dark-mode.js      → Toggle modo oscuro
    ├── skeleton-loader.js → Placeholders animados
    ├── animated-counter.js → Animación de números
    ├── confetti.js        → Celebración primera venta
    ├── vertical-theming.js → Colores por vertical
    ├── onboarding.js      → Tour guiado
    ├── mini-chart.js      → Gráficas SVG inline
    ├── qr-payload.js      → Generador de datos QR
    ├── qr-mode-selector.js → Selección inteligente de modo QR
    ├── qr-renderer.js     → Renderizado QR con colores
    ├── scanner.js         → Escáner de cámara QR
    └── status-poller.js   → Polling de estado en tiempo real
```

---

## Diseño Responsive: Desktop vs Mobile

### Desktop — Densidad y eficiencia de escritorio

- **Sidebar fijo** (260px) con gradiente oscuro (#0f172a → #1e293b)
- **Tabla densa** con todas las columnas visibles (tiquete, cliente, detalle, saldo, estado, acciones)
- **Panel lateral de formulario** siempre visible para crear pedidos rápidamente
- **Stats en fila de 4** con hover elevado
- **Selectores de negocio** accesibles sin navegación
- **Dark mode toggle** en el sidebar

### Mobile — Experiencia nativa de app

- **Bottom navigation** con glassmorphism (backdrop-filter blur 12px)
- **FAB (Floating Action Button)** con gradiente verde y sombra glow
- **Form drawer** que sube desde abajo con animación slideUp (border-radius 24px top)
- **Order cards** en vez de tabla — información compacta por card con press animation
- **Safe area** respetada (env(safe-area-inset-bottom))
- **Touch targets** mínimo 44px
- **Haptic feedback** virtual en el escaneo QR

---

## Módulos de Mejora Visual

### 1. 🌙 Dark Mode (`dark-mode.js`)

| Aspecto | Detalle |
|---------|---------|
| Activación | Toggle en sidebar + detección automática del sistema |
| Persistencia | `localStorage` key `tv_dark_mode` |
| Variables | `--ink`, `--muted`, `--line`, `--bg`, `--panel`, `--shadow-*` |
| Overrides | Clase `.dark-mode` en body con selectores para tabla, forms, cards, modals |

**Paleta dark:**
- Background: `#0f172a`
- Panel: `#1e293b`
- Line: `#334155`
- Text: `#f1f5f9`
- Muted: `#94a3b8`

### 2. 💀 Skeleton Loaders (`skeleton-loader.js`)

Muestra placeholders con shimmer animation mientras la data carga:

```css
@keyframes skeletonShimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

- `showTableSkeleton(tbody, rows, cols)` — Para la tabla de pedidos
- `showCardsSkeleton(container, count)` — Para cards móviles
- `showStatsSkeleton(ids)` — Para las métricas

### 3. 🔢 Animated Counters (`animated-counter.js`)

Animación de números con `requestAnimationFrame`:

- **Easing:** Cubic ease-out (`1 - Math.pow(1 - progress, 3)`)
- **Duración:** 600ms
- **Cancelable:** Si el valor cambia durante la animación, se reinicia
- **Formatos:** `animateCount()` para enteros, `animateMoney()` para COP

### 4. 🎉 Confetti (`confetti.js`)

Canvas overlay con partículas físicas:

- **80 partículas** (círculos + rectángulos)
- **7 colores** del brand palette
- **Physics:** gravedad, drag (0.98), rotación, fade de opacidad
- **Trigger:** Primera orden del día (flag `tv_confetti_YYYY-MM-DD` en localStorage)
- **Performance:** Se autodestruye cuando todas las partículas mueren

### 5. 📲 PWA (`manifest.json` + `sw.js`)

**Manifest:**
- Display: `standalone`
- Theme color: `#10b981`
- Background: `#0f172a`
- Iconos: SVG escalables

**Service Worker — Estrategia de caching:**

| Recurso | Estrategia |
|---------|-----------|
| Assets estáticos (`/`, `/app.html`, `/js/*`) | Cache-first |
| API calls (`/api/*`) | Network-first, respuesta 503 offline |
| CDN (fonts, libs) | Network-first con cache fallback |

**Meta tags en `app.html`:**
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#10b981">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

### 6. 🎨 Vertical Theming (`vertical-theming.js`)

Cada vertical tiene su esquema de color:

| Vertical | Accent | Dark | Light |
|----------|--------|------|-------|
| Lavandería | `#10b981` | `#059669` | `#ecfdf5` |
| Parqueadero | `#3b82f6` | `#2563eb` | `#eff6ff` |
| Calzado | `#92400e` | `#78350f` | `#fffbeb` |
| Mecánica | `#6b7280` | `#4b5563` | `#f9fafb` |
| Pastelería | `#f59e0b` | `#d97706` | `#fffbeb` |
| Sastrería | `#8b5cf6` | `#7c3aed` | `#f5f3ff` |
| Mascotas | `#f97316` | `#ea580c` | `#fff7ed` |
| Mensajería | `#06b6d4` | `#0891b2` | `#ecfeff` |
| Impresión | `#64748b` | `#475569` | `#f8fafc` |
| Belleza | `#ec4899` | `#db2777` | `#fdf2f8` |
| Casilleros | `#14b8a6` | `#0d9488` | `#f0fdfa` |
| Vivero | `#22c55e` | `#16a34a` | `#f0fdf4` |

**Elementos afectados:** Variables `--green`, sidebar mark, FAB, bottom nav active, data-status, `.btn.green`

### 7. 📊 Mini Charts (`mini-chart.js`)

Gráficas SVG inline sin dependencias:

- **`sparkline(container, data, options)`** — Línea con gradiente fill
  - Auto-escalado al rango de datos
  - Punto final resaltado (circle)
  - Colores configurables

- **`barChart(container, data, options)`** — Barras verticales
  - Labels debajo de cada barra
  - Tooltips nativos (title attribute)

**Integrado en:** Admin Dashboard (4 sparklines de tendencia)

### 8. 🎓 Onboarding Tour (`onboarding.js`)

Tour guiado de 5 pasos:

1. **Selector de Negocio** — "Aquí puedes cambiar entre negocios"
2. **Formulario** — "Llena datos y envía por WhatsApp"
3. **Métricas** — "Ve pedidos, ventas y saldos en tiempo real"
4. **Escáner QR** — "Encuentra pedidos al instante"
5. **Cierre de Caja** — "Genera reporte diario"

**Features:**
- Highlight con box-shadow (z-index trick, sin overlay real)
- Progress dots
- Posicionamiento inteligente (right/left/bottom/top)
- Viewport bounds checking
- Animación `tooltipIn` con ease-out
- Se muestra una sola vez (flag `tv_onboarding_done`)

---

## Panel de Administración (`/admin.html`)

### Autenticación

- Login simple con usuario/contraseña via env vars (`ADMIN_USERNAME`, `ADMIN_PASSWORD`)
- Token firmado: `{expiry_timestamp}.{sha256(payload:secret)}`
- Expiración: 8 horas
- Almacenado en `sessionStorage` (se pierde al cerrar pestaña)

### Vistas

| Vista | Endpoint | Descripción |
|-------|----------|-------------|
| Dashboard | `/api/admin-stats` | Métricas globales + sparklines + últimos negocios |
| Negocios | `/api/admin-businesses` | Tabla completa, activar/desactivar, link al panel |
| Pedidos | `/api/admin-orders` | Últimos 50 pedidos cross-tenant |
| WhatsApp | `/api/admin-whatsapp-logs` | Historial de mensajes (SENT/FAILED/DRY_RUN) |
| Verticales | `/api/admin-verticals` | Configuración de las 12 verticales |

### Diseño Admin

- Sidebar oscuro con accent indigo (`#6366f1`)
- Badge "Admin" para diferenciar del panel de negocio
- Cards de stats con sparklines
- Tablas con badges de estado (coloreados)
- Responsive: sidebar colapsa en mobile

---

## Variables de Diseño (Design Tokens)

```css
:root {
  --ink: #0f172a;
  --muted: #64748b;
  --line: #e2e8f0;
  --bg: #f8fafc;
  --panel: #ffffff;
  --green: #10b981;
  --green-dark: #059669;
  --blue: #6366f1;
  --amber: #f59e0b;
  --red: #ef4444;
  --soft-green: #ecfdf5;
  --sidebar-w: 260px;
  --bottomnav-h: 68px;
  --radius: 14px;
  --shadow-sm: 0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.06);
  --shadow-md: 0 4px 16px rgba(0,0,0,.06);
  --transition: .2s cubic-bezier(.4,0,.2,1);
}
```

---

## Animaciones

| Nombre | Uso | Duración |
|--------|-----|----------|
| `fadeInUp` | Toast notifications | 300ms ease |
| `scaleIn` | Modals | 200ms cubic-bezier |
| `slideUp` | Form drawer (mobile) | 300ms cubic-bezier |
| `skeletonShimmer` | Skeleton loaders | 1500ms infinite |
| `tooltipIn` | Onboarding tooltips | 300ms cubic-bezier |
| `pulseReady` | Ready banner (tiquete.html) | 2000ms ease infinite |

---

## Micro-interacciones

- **Botones:** `translateY(-1px)` en hover + shadow elevada, `translateY(0)` en active
- **Cards móviles:** `scale(.98)` en `:active` (press feedback)
- **FAB:** `scale(.9)` en press
- **Stats:** `box-shadow` cambia a `--shadow-md` en hover
- **Inputs:** Focus ring indigo (`box-shadow: 0 0 0 3px rgba(99,102,241,.08)`)
- **Counters:** Ease-out cubic durante 600ms
- **Confetti:** Physics con gravedad y fade natural

---

## Compatibilidad con Netlify Free Tier

- ✅ Sin build step (archivos estáticos servidos directamente)
- ✅ Sin bundler (no webpack/vite/rollup)
- ✅ Funciones serverless dentro del límite gratuito (125K invocaciones/mes)
- ✅ Service Worker para reducir requests al CDN
- ✅ SVG icons (no requiere processing de imágenes)
- ✅ CDN externo para QRCode.js y html5-qrcode (reduce tamaño del deploy)

---

## Cómo Probar

```bash
# Instalar dependencias
npm install

# Levantar desarrollo local
npm run dev

# URLs disponibles
http://localhost:8888/              → Landing page
http://localhost:8888/app.html      → Panel de negocio
http://localhost:8888/admin.html    → Panel admin
http://localhost:8888/registro.html → Registro de negocio
http://localhost:8888/tiquete.html  → Recibo digital

# Credenciales admin (dev)
Usuario: admin
Password: tiquetevivo2024
```

---

## Variables de Entorno Requeridas

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SECRET_KEY=tu_service_role_key
WHATSAPP_TOKEN=             # Opcional (dry-run sin él)
WHATSAPP_PHONE_NUMBER_ID=   # Opcional
ADMIN_USERNAME=admin
ADMIN_PASSWORD=tu_contraseña_segura
```

---

## Próximos Pasos Sugeridos

1. **Notificaciones Push** — Web Push API + Service Worker para alertas de nuevos pedidos
2. **Drag & Drop en cards** — Swipe para cambiar estado (gesture detection)
3. **Charts históricos reales** — Guardar datos diarios en Supabase para sparklines reales
4. **Multi-idioma** — i18n básico con un objeto de traducciones
5. **Accessibility audit** — ARIA labels completos, focus management, screen reader testing
6. **Performance budget** — Lighthouse CI en el deploy pipeline

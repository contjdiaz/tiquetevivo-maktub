# Usuarios de prueba para desarrollo local

Ejecuta el seed para crear todos los usuarios de prueba:

```bash
npm run seed:demo
```

Esto crea dos negocios y tres usuarios.

---

## Panel de operador (app.html)

### Negocio con plan gratuito

| Campo | Valor |
|---|---|
| URL | `http://localhost:8888/app.html?slug=majesty` |
| Correo | `operador@majesty.com` |
| Contraseña | `TiqueteVivo2026!` |
| Negocio | `Majesty Lavanderia` |
| Plan | `free` |
| Rol | `owner` |

**Qué probar:**
- Login.
- Crear pedidos.
- Cambiar estados.
- Verificar que **no** aparecen fotos ni confirmaciones digitales.

---

### Negocio con plan de pago

| Campo | Valor |
|---|---|
| URL | `http://localhost:8888/app.html?slug=majestypremium` |
| Correo | `operadorpago@majesty.com` |
| Contraseña | `TiqueteVivo2026!` |
| Negocio | `Majesty Premium` |
| Plan | `paid` |
| Rol | `owner` |

**Qué probar:**
- Login.
- Crear pedidos con foto de recepción.
- Cambiar a `Entregado` y subir foto de entrega.
- En el tiquete del cliente, confirmar recepción/entrega digital.

---

## Panel de administrador (admin.html)

| Campo | Valor |
|---|---|
| URL | `http://localhost:8888/admin.html` |
| Correo | `admin@tiquetevivo.com` |
| Contraseña | `MiClaveSegura123!` |
| Rol | `superadmin` |

**Qué probar:**
- Login.
- Ver dashboard, negocios, pedidos globales, logs de WhatsApp y verticales.

---

## Tiquete del cliente (tiquete.html)

Crea un pedido desde `app.html`, luego abre el enlace del tiquete. Ejemplo:

```text
http://localhost:8888/tiquete.html?slug=majestypremium&number=1234
```

**Qué probar:**
- Estado del pedido.
- Fotos (solo plan `paid`).
- Confirmaciones digitales (solo plan `paid`).

# Plan de Implementación: De Prototipo a Producto

## Resumen Ejecutivo

Este documento resume los hallazgos, recomendaciones y plan de implementación para convertir el prototipo actual de TiqueteVivo en un producto comercializable para lavanderías. Se priorizan los cambios según impacto comercial, esfuerzo técnico y riesgo.

**Estado actual:** El sistema funciona como un prototipo multi-vertical (lavanderías, parqueaderos, zapaterías, etc.) con funcionalidades avanzadas recientemente implementadas en la rama `ft/impact-changes`:
- Evidencia fotográfica de recepción y entrega.
- Confirmación digital con timestamp e IP.
- Flujo de estados configurable por negocio.
- Notificaciones por WhatsApp.

**Objetivo:** Adaptar el producto para que una lavandería individual lo use sin ver funcionalidades de otros negocios, con planes gratuito/pago, roles y formularios dinámicos por servicio.

---

## Hallazgos Actuales

### 1. Arquitectura multi-vertical visible para todos
- El panel `app.html` muestra un selector de negocios que incluye parqueaderos, zapaterías, mecánicas, etc.
- Para un cliente de lavandería, esto genera confusión y reduce la percepción de especialización.
- El backend ya soporta múltiples negocios (`businesses`) y verticales (`verticals`), pero la UI no distingue entre superadmin y cliente final.

### 2. No hay sistema de roles ni autenticación de operadores
- Las Netlify Functions usan `service_role` de Supabase y saltan RLS.
- No hay forma de saber quién hizo cada acción más allá de la IP y timestamp.
- Un dueño de lavandería no puede crear operadores con permisos limitados.

### 3. Formulario dinámico parcialmente implementado
- Ya existen `services_config`, `custom_fields_config` y `status_flow_config` en la tabla `businesses`.
- Sin embargo, el formulario de creación de tiquetes no explota todo el potencial: aún depende de lógica hardcodeada (kilos, tipos de servicio) y no renderiza checklist de prendas.

### 4. Funcionalidades avanzadas sin control de planes
- Fotos y confirmaciones digitales están disponibles para cualquier negocio.
- No hay mecanismo para ofrecer un plan gratuito limitado y cobrar por funciones avanzadas.

### 5. Base técnica sólida pero con deuda de autenticación
- Tests unitarios y de propiedad cubren bien validaciones y flujos core.
- La mayoría de los cambios propuestos son aditivos, excepto el sistema de roles/autenticación que requiere refactor significativo.

---

## Recomendaciones Priorizadas

### Prioridad 1: Vista single-business para clientes de lavandería
**Impacto:** Alto  
**Esfuerzo:** Bajo  
**Riesgo:** Bajo

Ocultar el multi-negocio/multi-vertical para los clientes operativos. Cada lavandería accede directamente a su panel sin ver otros negocios ni verticales.

**Archivos a tocar:**
- `public/app.html`: ocultar selector de negocios.
- `public/app.js`: forzar carga por slug fijo.
- `public/admin.html`: mantener visión global para superadmin.

### Prioridad 2: Formulario de creación dinámico por servicios
**Impacto:** Alto  
**Esfuerzo:** Medio  
**Riesgo:** Medio

Aprovechar `services_config` y `custom_fields_config` para que el formulario de creación de tiquetes se adapte automáticamente a los servicios de cada lavandería.

**Archivos a tocar:**
- `public/app.js`: renderizar campos dinámicos según configuración.
- `netlify/functions/create-order.js`: validar campos dinámicos.
- `netlify/functions/_validators.js`: extender validación de custom fields.

### Prioridad 3: Planes gratuito y de pago (freemium)
**Impacto:** Alto comercial  
**Esfuerzo:** Medio  
**Riesgo:** Medio

Añadir columna `plan` a `businesses` y bloquear funcionalidades avanzadas en el plan gratuito.

**Archivos a tocar:**
- `supabase/schema.sql` y migración: columna `plan`.
- `netlify/functions/create-order.js`: validar plan para fotos y confirmaciones.
- `netlify/functions/update-order.js`: validar plan para fotos y confirmaciones.
- `public/app.html` y `public/app.js`: ocultar/deshabilitar funciones según plan.
- `public/tiquete.html`: ocultar funciones según plan.

### Prioridad 4: Roles y autenticación de operadores
**Impacto:** Alto operativo  
**Esfuerzo:** Alto  
**Riesgo:** Alto

Implementar autenticación real (Supabase Auth recomendado) con roles superadmin, owner y operator.

**Archivos a tocar:**
- `supabase/schema.sql`: tabla `users`, roles, relación con negocios.
- Netlify Functions: validar JWT en lugar de usar service role a ciegas.
- `public/admin.html`, `public/app.html`: login y permisos.
- Tests: actualizar mocks para simular autenticación.

### Prioridad 5: Conteo estructurado de prendas (checklist)
**Impacto:** Medio-Alto  
**Esfuerzo:** Alto  
**Riesgo:** Alto

Reemplazar `items_text` por una tabla `order_items` con cantidad, tipo de prenda, estado y precio.

**Archivos a tocar:**
- `supabase/schema.sql`: nueva tabla `order_items`.
- Backend: create-order, update-order, list-orders.
- Frontend: app.html, app.js, tiquete.html.
- Migración de datos históricos.

### Prioridad 6: Alertas de pedidos abandonados
**Impacto:** Medio  
**Esfuerzo:** Medio  
**Riesgo:** Medio

Recordatorios automáticos para pedidos en estado "listo" por más de X días.

**Archivos a tocar:**
- `supabase/schema.sql`: columnas de recordatorio.
- Nueva Netlify Function o scheduled function para el cron.
- Plantillas WhatsApp para día 3, 7 y 15.
- Infraestructura de scheduling.

---

## Plan de Implementación por Fases

### Fase 1: Producto enfocado en lavandería (2-3 días)

**Objetivo:** Que una lavandería use el producto sin ver otros negocios.

**Tareas:**
1. Ocultar selector de negocios en `app.html` cuando se accede con un slug específico.
2. Hacer que `app.html?slug=majesty` cargue directamente ese negocio sin mostrar el selector.
3. Filtrar `admin.html` para que el superadmin pueda ver todos, pero al hacer clic en un negocio de lavandería, vaya a `app.html?slug=<slug>`.
4. Documentar URLs de acceso directo por negocio.

**Entregable:** Panel de lavandería limpio, sin verticales ajenas.

---

### Fase 2: Formulario dinámico por servicios (3-5 días)

**Objetivo:** Cada lavandería configure sus propios servicios y el formulario se adapte.

**Tareas:**
1. Mejorar `renderServiceOptions()` y `renderCustomFieldInputs()` en `app.js`.
2. Soportar unidades: `per_kg`, `per_item`, `flat_rate`, `per_hour`.
3. Renderizar campos adicionales según `custom_fields_config`.
4. Validar en backend que los campos dinámicos coincidan con la configuración.
5. Guardar precios calculados correctamente.

**Entregable:** Formulario que se adapta a los servicios configurados.

---

### Fase 3: Freemium (2-3 días)

**Objetivo:** Separar funcionalidades gratis de las de pago.

**Tareas:**
1. Añadir columna `plan` a `businesses` con valores `free`, `pro`, `enterprise`.
2. Definir matriz de funcionalidades por plan.
3. Validar plan en backend antes de permitir fotos y confirmaciones digitales.
4. Ocultar/deshabilitar botones de foto y confirmación en plan gratuito.
5. Mostrar mensajes de upsell.

**Entregable:** Plan gratuito limitado y planes de pago con funciones avanzadas.

---

### Fase 4: Roles y autenticación (1-2 semanas)

**Objetivo:** Saber quién hace qué y limitar accesos.

**Tareas:**
1. Implementar Supabase Auth o Netlify Identity.
2. Crear tabla `users` con `role`, `business_id`, `email`.
3. Crear roles: `superadmin`, `owner`, `operator`.
4. Modificar Netlify Functions para validar JWT y aplicar RLS.
5. Actualizar tests para simular usuarios autenticados.
6. Crear pantallas de login y gestión de usuarios en `admin.html`.

**Entregable:** Sistema de login con roles y auditoría real.

---

### Fase 5: Checklist de prendas (1-2 semanas)

**Objetivo:** Reemplazar texto libre por conteo estructurado.

**Tareas:**
1. Crear tabla `order_items`.
2. Migrar datos históricos de `items_text` (parcial o manual).
3. Adaptar backend para crear/actualizar/leer items.
4. Rediseñar frontend con checklist.
5. Ajustar cálculo de totales y mensajes de WhatsApp.

**Entregable:** Tiquetes con lista estructurada de prendas.

---

### Fase 6: Alertas de pedidos abandonados (3-5 días)

**Objetivo:** Recordatorios automáticos para pedidos listos sin recoger.

**Tareas:**
1. Añadir columnas de tracking de recordatorios.
2. Crear función/cron que encuentre pedidos abandonados.
3. Definir plantillas WhatsApp para día 3, 7 y 15.
4. Configurar scheduler (Netlify Scheduled Functions o servicio externo).

**Entregable:** Recordatorios automáticos escalonados.

---

## Matriz de Funcionalidades por Plan (Propuesta)

| Funcionalidad | Free | Pro | Enterprise |
|---------------|------|-----|------------|
| Tiquetes digitales | ✅ | ✅ | ✅ |
| Estados configurables | ✅ (básico) | ✅ | ✅ |
| WhatsApp automático | ✅ | ✅ | ✅ |
| 1 operador | ✅ | ✅ | ✅ |
| Evidencia fotográfica | ❌ | ✅ | ✅ |
| Confirmación digital | ❌ | ✅ | ✅ |
| Múltiples operadores | ❌ | ✅ (hasta 5) | ✅ (ilimitado) |
| Reportes y cierre de caja | ❌ | ✅ | ✅ |
| Checklist de prendas | ❌ | ❌ | ✅ |
| Alertas de abandonados | ❌ | ✅ | ✅ |
| Sucursales múltiples | ❌ | ❌ | ✅ |
| API / Integraciones | ❌ | ❌ | ✅ |

---

## Riesgos y Consideraciones

### Riesgo 1: Cambio a autenticación real
**Impacto:** Alto.  
**Mitigación:** Hacerlo en fase separada, manteniendo compatibilidad con el modo service-role durante la transición.

### Riesgo 2: Migración de `items_text` a checklist
**Impacto:** Alto.  
**Mitigación:** Convivencia: mantener `items_text` como fallback mientras se migra progresivamente.

### Riesgo 3: Costos de WhatsApp
**Impacto:** Medio.  
**Mitigación:** Limitar mensajes en plan gratuito; en planes pagos incluir créditos o cobro por uso.

### Riesgo 4: Scheduler en Netlify
**Impacto:** Medio.  
**Mitigación:** Evaluar Netlify Scheduled Functions vs servicios externos como GitHub Actions o EasyCron.

---

## Próximos Pasos Recomendados

1. **Aprobar el plan** y decidir si se comienza por la Fase 1 (single-business view).
2. **Definir precios y límites** de cada plan antes de implementar freemium.
3. **Decidir proveedor de auth**: Supabase Auth es lo más natural dado que ya se usa Supabase.
4. **Crear una nueva rama** para estas mejoras, separada de `ft/impact-changes`.

---

## Notas sobre la rama actual

Los cambios actuales en `ft/impact-changes` (fotos y confirmaciones digitales) son una buena base para el plan **Pro**. Antes de continuar, se recomienda:

1. Hacer commit de los cambios actuales.
2. Fusionar `ft/impact-changes` a `main` si los tests pasan.
3. Crear una nueva rama (por ejemplo, `ft/single-business-view`) para comenzar la Fase 1.

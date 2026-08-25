-- Migration: Add "Domicilios" vertical (fruits & vegetables home delivery)
-- and seed the "Domicilios Paty" business at the same level as Majesty Lavanderia.
--
-- Idempotent: safe to run multiple times.

-- =============================================================================
-- 1. Vertical definition: domicilios
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'domicilios',
  'Domicilios',
  '🛵',
  '[
    {"name": "Canasta familiar", "description": "Selección semanal de frutas y verduras", "default_price": 50000, "duration": 60, "unit": "flat_rate"},
    {"name": "Frutas por kilo", "description": "Frutas surtidas de temporada", "default_price": 8000, "duration": 30, "unit": "per_kg"},
    {"name": "Verduras por kilo", "description": "Verduras frescas surtidas", "default_price": 6000, "duration": 30, "unit": "per_kg"},
    {"name": "Domicilio", "description": "Costo de envío a domicilio", "default_price": 5000, "duration": 45, "unit": "flat_rate"}
  ]'::jsonb,
  '[
    {"field_key": "orden_entrega", "display_label": "Orden de entrega", "field_type": "text", "required": true, "default_value": null},
    {"field_key": "fecha", "display_label": "Fecha de entrega", "field_type": "date", "required": true, "default_value": null},
    {"field_key": "hora", "display_label": "Hora de entrega", "field_type": "time", "required": true, "default_value": null},
    {"field_key": "productos", "display_label": "Productos", "field_type": "textarea", "required": true, "default_value": null},
    {"field_key": "monto", "display_label": "Monto", "field_type": "number", "required": false, "default_value": null},
    {"field_key": "forma_pago", "display_label": "Forma de pago", "field_type": "select", "required": true, "default_value": "Efectivo", "options": ["Efectivo", "Nequi", "Daviplata", "Transferencia", "Datáfono", "Addí"]}
  ]'::jsonb,
  '[
    {"status_key": "ORDERED", "display_label": "Ordenado"},
    {"status_key": "IN_PREPARATION", "display_label": "En preparación"},
    {"status_key": "ON_THE_WAY", "display_label": "En camino"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "🛵 *{business_name}*\n\nHola {customer_name} 👋\nTu orden de entrega *{custom.orden_entrega}* ha sido registrada.\n\n🛒 Productos:\n{custom.productos}\n\n📅 Entrega: {custom.fecha} a las {custom.hora}\n💰 Monto: {custom.monto}\nTotal: {total}\n💳 Forma de pago: {custom.forma_pago}\n\n¡Gracias por tu compra!",
    "status_ready": "🛵 *{business_name}*\n\nHola {customer_name}, tu orden *{custom.orden_entrega}* VA EN CAMINO.\n\nTotal: {total}\nSaldo pendiente: {balance}\n\n¡Ten lista tu canasta! 🍓🥦",
    "status_delivered": "✅ *{business_name}*\n\nHola {customer_name}, tu orden *{custom.orden_entrega}* fue entregada.\n\n¡Gracias por preferirnos! 🍓🥦"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 2. Business: Domicilios Paty (same level as Majesty Lavanderia)
-- =============================================================================

INSERT INTO businesses (slug, name, phone, address, city, color, plan, active, vertical_id)
SELECT
  'domiciliospaty',
  'Domicilios Paty',
  '+573001234567',
  'Cra 80 #45-23',
  'Medellin',
  '#84cc16',
  'free',
  true,
  v.id
FROM verticals v
WHERE v.slug = 'domicilios'
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    vertical_id = EXCLUDED.vertical_id;

-- =============================================================================
-- 3. Apply vertical defaults to the business (idempotent)
-- =============================================================================

UPDATE businesses b
SET services_config = v.services_default,
    custom_fields_config = v.custom_fields_default,
    status_flow_config = v.status_flow_default,
    whatsapp_templates_config = v.whatsapp_templates_default
FROM verticals v
WHERE v.slug = 'domicilios'
  AND b.slug = 'domiciliospaty';

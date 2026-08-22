-- Migration: Seed data for 12 verticals
-- Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12
-- Inserts default configurations for all 12 target industry verticals

-- =============================================================================
-- 1. Laundry (Lavandería)
-- Requirement 2.1
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'laundry',
  'Lavandería',
  '🧺',
  '[
    {"name": "Lavado estándar", "description": "Lavado con detergente premium", "default_price": 12000, "duration": 180, "unit": "per_kg"},
    {"name": "Planchado", "description": "Planchado profesional de prendas", "default_price": 8000, "duration": 60, "unit": "per_item"},
    {"name": "Tintorería", "description": "Limpieza especializada en seco", "default_price": 25000, "duration": 1440, "unit": "per_item"},
    {"name": "Lavado en seco", "description": "Tratamiento para prendas delicadas", "default_price": 20000, "duration": 1440, "unit": "per_item"}
  ]'::jsonb,
  '[
    {"field_key": "is_delicate", "display_label": "Prenda delicada", "field_type": "boolean", "required": false, "default_value": false},
    {"field_key": "rack_location", "display_label": "Ubicación en estante", "field_type": "text", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "IN_PROGRESS", "display_label": "En proceso"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "🧺 *{business_name}*\n\nHola {customer_name} 👋\nTu orden #{order_number} ha sido recibida.\n\nDetalle: {items_text}\nTotal: {total}\n\n¡Gracias por confiar en nosotros!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu ropa está lista para recoger 👔\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Te esperamos!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, tu orden #{order_number} ha sido entregada.\n\n¡Gracias por tu preferencia!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 2. Parking (Parqueadero)
-- Requirement 2.2
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'parking',
  'Parqueadero',
  '🅿️',
  '[
    {"name": "Hora", "description": "Estacionamiento por hora", "default_price": 3000, "duration": 60, "unit": "per_hour"},
    {"name": "Medio día", "description": "Estacionamiento por medio día (6 horas)", "default_price": 12000, "duration": 360, "unit": "flat_rate"},
    {"name": "Día completo", "description": "Estacionamiento por día completo", "default_price": 20000, "duration": 1440, "unit": "flat_rate"},
    {"name": "Mensualidad", "description": "Estacionamiento mensual", "default_price": 350000, "duration": 43200, "unit": "flat_rate"}
  ]'::jsonb,
  '[
    {"field_key": "plate_number", "display_label": "Número de placa", "field_type": "text", "required": true, "default_value": null},
    {"field_key": "entry_time", "display_label": "Hora de entrada", "field_type": "datetime", "required": true, "default_value": null},
    {"field_key": "exit_time", "display_label": "Hora de salida", "field_type": "datetime", "required": false, "default_value": null},
    {"field_key": "bay_number", "display_label": "Número de bahía", "field_type": "text", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "ENTRY", "display_label": "Ingreso"},
    {"status_key": "ACTIVE", "display_label": "Activo"},
    {"status_key": "EXIT", "display_label": "Salida"}
  ]'::jsonb,
  '{
    "order_created": "🅿️ *{business_name}*\n\nHola {customer_name} 👋\nTu vehículo (placa: {custom.plate_number}) ha ingresado.\nTicket: #{order_number}\n\nHora de ingreso: {custom.entry_time}\n\n¡Buen día!",
    "status_ready": "🅿️ *{business_name}*\n\nHola {customer_name}, tu vehículo (placa: {custom.plate_number}) está listo para salir.\nTicket: #{order_number}\nSaldo: {balance}\n\n¡Gracias!",
    "status_delivered": "✅ *{business_name}*\n\nHola {customer_name}, tu vehículo (placa: {custom.plate_number}) ha salido del parqueadero.\nTicket: #{order_number}\n\n¡Hasta pronto!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 3. Shoe Repair (Reparación de calzado)
-- Requirement 2.3
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'shoe-repair',
  'Reparación de Calzado',
  '👞',
  '[
    {"name": "Media suela", "description": "Cambio de media suela", "default_price": 35000, "duration": 1440, "unit": "per_item"},
    {"name": "Tacón", "description": "Reparación o cambio de tacón", "default_price": 20000, "duration": 1440, "unit": "per_item"},
    {"name": "Tintura", "description": "Tintura de calzado", "default_price": 25000, "duration": 2880, "unit": "per_item"},
    {"name": "Limpieza profunda", "description": "Limpieza profunda y restauración", "default_price": 30000, "duration": 1440, "unit": "per_item"}
  ]'::jsonb,
  '[
    {"field_key": "shoe_type", "display_label": "Tipo de calzado", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "shoe_color", "display_label": "Color del calzado", "field_type": "text", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "DIAGNOSING", "display_label": "Diagnosticando"},
    {"status_key": "REPAIRING", "display_label": "Reparando"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "👞 *{business_name}*\n\nHola {customer_name} 👋\nTu calzado ha sido recibido para reparación.\nOrden: #{order_number}\n\nDetalle: {items_text}\nTotal: {total}\n\n¡Te avisaremos cuando esté listo!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu calzado está listo para recoger 👞\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Te esperamos!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, tu calzado ha sido entregado.\nOrden: #{order_number}\n\n¡Gracias por tu confianza!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 4. Mechanic (Taller mecánico)
-- Requirement 2.4
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'mechanic',
  'Taller Mecánico',
  '🔧',
  '[
    {"name": "Diagnóstico", "description": "Diagnóstico general del vehículo", "default_price": 50000, "duration": 120, "unit": "flat_rate"},
    {"name": "Cambio de aceite", "description": "Cambio de aceite y filtro", "default_price": 80000, "duration": 60, "unit": "flat_rate"},
    {"name": "Frenos", "description": "Revisión y cambio de frenos", "default_price": 150000, "duration": 180, "unit": "flat_rate"},
    {"name": "Motor", "description": "Reparación de motor", "default_price": 500000, "duration": 4320, "unit": "flat_rate"}
  ]'::jsonb,
  '[
    {"field_key": "plate_number", "display_label": "Número de placa", "field_type": "text", "required": true, "default_value": null},
    {"field_key": "vehicle_brand", "display_label": "Marca del vehículo", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "vehicle_model", "display_label": "Modelo del vehículo", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "spare_parts", "display_label": "Repuestos necesarios", "field_type": "text", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "DIAGNOSING", "display_label": "Diagnosticando"},
    {"status_key": "REPAIRING", "display_label": "Reparando"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "🔧 *{business_name}*\n\nHola {customer_name} 👋\nTu vehículo (placa: {custom.plate_number}) ha sido recibido.\nOrden: #{order_number}\n\nDetalle: {items_text}\nTotal estimado: {total}\n\n¡Te mantendremos informado!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu vehículo (placa: {custom.plate_number}) está listo.\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Puedes pasar a recogerlo!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, tu vehículo (placa: {custom.plate_number}) ha sido entregado.\nOrden: #{order_number}\n\n¡Gracias por confiar en nosotros!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 5. Bakery (Pastelería/Panadería por encargo)
-- Requirement 2.5
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'bakery',
  'Pastelería',
  '🎂',
  '[
    {"name": "Torta personalizada", "description": "Torta decorada a pedido", "default_price": 80000, "duration": 2880, "unit": "per_item"},
    {"name": "Catering", "description": "Servicio de catering para eventos", "default_price": 200000, "duration": 4320, "unit": "flat_rate"},
    {"name": "Cupcakes", "description": "Cupcakes decorados por docena", "default_price": 45000, "duration": 1440, "unit": "per_item"},
    {"name": "Galletas por encargo", "description": "Galletas decoradas personalizadas", "default_price": 35000, "duration": 1440, "unit": "per_item"}
  ]'::jsonb,
  '[
    {"field_key": "delivery_date", "display_label": "Fecha de entrega", "field_type": "date", "required": true, "default_value": null},
    {"field_key": "advance_payment", "display_label": "Anticipo", "field_type": "number", "required": false, "default_value": null},
    {"field_key": "special_instructions", "display_label": "Instrucciones especiales", "field_type": "text", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "IN_PREPARATION", "display_label": "En preparación"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "🎂 *{business_name}*\n\nHola {customer_name} 👋\nTu pedido ha sido registrado.\nOrden: #{order_number}\n\nDetalle: {items_text}\nFecha de entrega: {custom.delivery_date}\nTotal: {total}\n\n¡Estamos trabajando en tu pedido!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu pedido está listo 🎂\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Puedes pasar a recogerlo!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, tu pedido #{order_number} ha sido entregado.\n\n¡Esperamos que lo disfrutes! ¡Gracias por tu preferencia!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 6. Tailor (Sastrería/Costura)
-- Requirement 2.6
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'tailor',
  'Sastrería',
  '🧵',
  '[
    {"name": "Arreglo de basta", "description": "Ajuste de largo de pantalón o falda", "default_price": 15000, "duration": 1440, "unit": "per_item"},
    {"name": "Confección", "description": "Confección de prenda a medida", "default_price": 120000, "duration": 10080, "unit": "per_item"},
    {"name": "Ajuste de talla", "description": "Ajuste de talla en prenda existente", "default_price": 25000, "duration": 2880, "unit": "per_item"},
    {"name": "Reparación", "description": "Reparación de roturas o daños", "default_price": 20000, "duration": 1440, "unit": "per_item"}
  ]'::jsonb,
  '[
    {"field_key": "fabric_type", "display_label": "Tipo de tela", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "measurements", "display_label": "Medidas", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "fitting_date", "display_label": "Fecha de prueba", "field_type": "date", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "MEASURING", "display_label": "Tomando medidas"},
    {"status_key": "SEWING", "display_label": "Cosiendo"},
    {"status_key": "FITTING", "display_label": "Prueba"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "🧵 *{business_name}*\n\nHola {customer_name} 👋\nTu prenda ha sido recibida.\nOrden: #{order_number}\n\nDetalle: {items_text}\nTotal: {total}\n\n¡Te avisaremos del avance!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu prenda está lista para recoger 🧵\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Te esperamos!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, tu prenda ha sido entregada.\nOrden: #{order_number}\n\n¡Gracias por confiar en nosotros!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 7. Pet Daycare (Guardería de mascotas)
-- Requirement 2.7
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'pet-daycare',
  'Guardería de Mascotas',
  '🐾',
  '[
    {"name": "Hospedaje", "description": "Hospedaje con alimentación incluida", "default_price": 40000, "duration": 1440, "unit": "per_hour"},
    {"name": "Spa", "description": "Baño y spa para mascotas", "default_price": 35000, "duration": 120, "unit": "per_item"},
    {"name": "Peluquería", "description": "Corte y arreglo de pelo", "default_price": 45000, "duration": 90, "unit": "per_item"},
    {"name": "Paseo", "description": "Paseo recreativo", "default_price": 15000, "duration": 60, "unit": "per_hour"}
  ]'::jsonb,
  '[
    {"field_key": "pet_name", "display_label": "Nombre de la mascota", "field_type": "text", "required": true, "default_value": null},
    {"field_key": "pet_breed", "display_label": "Raza", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "special_instructions", "display_label": "Instrucciones especiales", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "pickup_time", "display_label": "Hora de recogida", "field_type": "datetime", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "CHECK_IN", "display_label": "Check-in"},
    {"status_key": "IN_CARE", "display_label": "En cuidado"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "PICKED_UP", "display_label": "Recogido"}
  ]'::jsonb,
  '{
    "order_created": "🐾 *{business_name}*\n\nHola {customer_name} 👋\n{custom.pet_name} ha sido recibido(a) en nuestra guardería.\nTicket: #{order_number}\n\nServicio: {items_text}\nTotal: {total}\n\n¡Tu mascota está en buenas manos!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, {custom.pet_name} está listo(a) para ser recogido(a) 🐾\nTicket: #{order_number}\nSaldo: {balance}\n\n¡Te esperamos!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, {custom.pet_name} ha sido recogido(a).\nTicket: #{order_number}\n\n¡Hasta la próxima! 🐶"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 8. Courier (Mensajería/Encomiendas)
-- Requirement 2.8
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'courier',
  'Mensajería',
  '📦',
  '[
    {"name": "Envío local", "description": "Envío dentro de la ciudad", "default_price": 8000, "duration": 240, "unit": "flat_rate"},
    {"name": "Envío express", "description": "Envío urgente mismo día", "default_price": 15000, "duration": 120, "unit": "flat_rate"},
    {"name": "Encomienda", "description": "Envío de paquetes entre ciudades", "default_price": 25000, "duration": 2880, "unit": "per_kg"}
  ]'::jsonb,
  '[
    {"field_key": "destination_address", "display_label": "Dirección de destino", "field_type": "text", "required": true, "default_value": null},
    {"field_key": "weight_kg", "display_label": "Peso (kg)", "field_type": "number", "required": false, "default_value": null},
    {"field_key": "recipient_name", "display_label": "Nombre del destinatario", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "recipient_phone", "display_label": "Teléfono del destinatario", "field_type": "text", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "IN_TRANSIT", "display_label": "En tránsito"},
    {"status_key": "ARRIVED", "display_label": "Llegó a destino"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "📦 *{business_name}*\n\nHola {customer_name} 👋\nTu envío ha sido registrado.\nGuía: #{order_number}\n\nDestino: {custom.destination_address}\nDestinatario: {custom.recipient_name}\nTotal: {total}\n\n¡Tu paquete está en camino!",
    "status_ready": "📦 *{business_name}*\n\nHola {customer_name}, tu envío #{order_number} ha llegado a destino.\nSaldo: {balance}\n\n¡Será entregado pronto!",
    "status_delivered": "✅ *{business_name}*\n\nHola {customer_name}, tu envío #{order_number} ha sido entregado exitosamente.\n\n¡Gracias por usar nuestro servicio!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 9. Print Center (Centro de impresión)
-- Requirement 2.9
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'print-center',
  'Centro de Impresión',
  '🖨️',
  '[
    {"name": "Impresión", "description": "Impresión de documentos", "default_price": 500, "duration": 30, "unit": "per_item"},
    {"name": "Ploteo", "description": "Impresión en gran formato", "default_price": 15000, "duration": 60, "unit": "per_item"},
    {"name": "Encuadernado", "description": "Encuadernado de documentos", "default_price": 8000, "duration": 60, "unit": "per_item"},
    {"name": "Laminado", "description": "Laminado de documentos", "default_price": 5000, "duration": 30, "unit": "per_item"}
  ]'::jsonb,
  '[
    {"field_key": "file_name", "display_label": "Nombre del archivo", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "quantity", "display_label": "Cantidad", "field_type": "number", "required": true, "default_value": null},
    {"field_key": "finishing", "display_label": "Acabado", "field_type": "select", "required": false, "default_value": null, "options": ["mate", "brillo", "plastificado"]}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "PRINTING", "display_label": "Imprimiendo"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "🖨️ *{business_name}*\n\nHola {customer_name} 👋\nTu orden de impresión ha sido registrada.\nOrden: #{order_number}\n\nDetalle: {items_text}\nCantidad: {custom.quantity}\nTotal: {total}\n\n¡Te avisaremos cuando esté listo!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu impresión está lista para recoger 🖨️\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Te esperamos!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, tu orden #{order_number} ha sido entregada.\n\n¡Gracias por tu preferencia!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 10. Salon (Peluquería/Salón de belleza)
-- Requirement 2.10
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'salon',
  'Salón de Belleza',
  '💇',
  '[
    {"name": "Corte", "description": "Corte de cabello", "default_price": 25000, "duration": 45, "unit": "per_item"},
    {"name": "Tinte", "description": "Tinte completo", "default_price": 80000, "duration": 120, "unit": "per_item"},
    {"name": "Alisado", "description": "Alisado profesional", "default_price": 150000, "duration": 180, "unit": "per_item"},
    {"name": "Tratamiento", "description": "Tratamiento capilar", "default_price": 60000, "duration": 90, "unit": "per_item"}
  ]'::jsonb,
  '[
    {"field_key": "stylist_name", "display_label": "Estilista", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "appointment_time", "display_label": "Hora de cita", "field_type": "datetime", "required": true, "default_value": null},
    {"field_key": "prepaid_amount", "display_label": "Monto prepagado", "field_type": "number", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "BOOKED", "display_label": "Agendado"},
    {"status_key": "IN_SERVICE", "display_label": "En servicio"},
    {"status_key": "COMPLETED", "display_label": "Completado"}
  ]'::jsonb,
  '{
    "order_created": "💇 *{business_name}*\n\nHola {customer_name} 👋\nTu cita ha sido agendada.\nOrden: #{order_number}\n\nServicio: {items_text}\nHora: {custom.appointment_time}\nTotal: {total}\n\n¡Te esperamos!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu servicio está completo 💇\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Esperamos que te encante el resultado!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, gracias por visitarnos.\nOrden: #{order_number}\n\n¡Nos vemos pronto!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 11. Gym Locker (Casilleros de gimnasio)
-- Requirement 2.11
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'gym-locker',
  'Casilleros',
  '🔐',
  '[
    {"name": "Alquiler diario", "description": "Alquiler de casillero por un día", "default_price": 5000, "duration": 1440, "unit": "flat_rate"},
    {"name": "Alquiler mensual", "description": "Alquiler de casillero por un mes", "default_price": 50000, "duration": 43200, "unit": "flat_rate"}
  ]'::jsonb,
  '[
    {"field_key": "locker_number", "display_label": "Número de casillero", "field_type": "text", "required": true, "default_value": null},
    {"field_key": "stored_items", "display_label": "Artículos guardados", "field_type": "text", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "ASSIGNED", "display_label": "Asignado"},
    {"status_key": "ACTIVE", "display_label": "Activo"},
    {"status_key": "RETURNED", "display_label": "Devuelto"}
  ]'::jsonb,
  '{
    "order_created": "🔐 *{business_name}*\n\nHola {customer_name} 👋\nTu casillero #{custom.locker_number} ha sido asignado.\nTicket: #{order_number}\n\nTotal: {total}\n\n¡Disfruta tu entrenamiento!",
    "status_ready": "🔐 *{business_name}*\n\nHola {customer_name}, recuerda devolver tu casillero #{custom.locker_number}.\nTicket: #{order_number}\nSaldo: {balance}\n\n¡Gracias!",
    "status_delivered": "✅ *{business_name}*\n\nHola {customer_name}, tu casillero #{custom.locker_number} ha sido devuelto.\nTicket: #{order_number}\n\n¡Hasta la próxima!"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- 12. Nursery (Vivero)
-- Requirement 2.12
-- =============================================================================

INSERT INTO verticals (slug, name, emoji, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default)
VALUES (
  'nursery',
  'Vivero',
  '🌱',
  '[
    {"name": "Planta por encargo", "description": "Planta cultivada por encargo especial", "default_price": 30000, "duration": 10080, "unit": "per_item"},
    {"name": "Mantenimiento", "description": "Servicio de mantenimiento de jardín", "default_price": 50000, "duration": 180, "unit": "flat_rate"},
    {"name": "Asesoría", "description": "Asesoría en jardinería y cuidado de plantas", "default_price": 40000, "duration": 60, "unit": "per_hour"}
  ]'::jsonb,
  '[
    {"field_key": "plant_type", "display_label": "Tipo de planta", "field_type": "text", "required": true, "default_value": null},
    {"field_key": "care_instructions", "display_label": "Instrucciones de cuidado", "field_type": "text", "required": false, "default_value": null},
    {"field_key": "delivery_date", "display_label": "Fecha de entrega", "field_type": "date", "required": false, "default_value": null}
  ]'::jsonb,
  '[
    {"status_key": "RECEIVED", "display_label": "Recibido"},
    {"status_key": "GROWING", "display_label": "En crecimiento"},
    {"status_key": "READY", "display_label": "Listo"},
    {"status_key": "DELIVERED", "display_label": "Entregado"}
  ]'::jsonb,
  '{
    "order_created": "🌱 *{business_name}*\n\nHola {customer_name} 👋\nTu pedido de {custom.plant_type} ha sido registrado.\nOrden: #{order_number}\n\nDetalle: {items_text}\nTotal: {total}\n\n¡Tu planta está en proceso de crecimiento!",
    "status_ready": "✅ *{business_name}*\n\nHola {customer_name}, tu planta ({custom.plant_type}) está lista 🌱\nOrden: #{order_number}\nSaldo: {balance}\n\n¡Puedes pasar a recogerla!",
    "status_delivered": "🎉 *{business_name}*\n\nHola {customer_name}, tu planta ha sido entregada.\nOrden: #{order_number}\n\n¡Disfruta de tu nuevo verde! 🌿"
  }'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Migration: Migrate existing laundry businesses and orders to multi-vertical schema
-- Requirements: 9.5, 12.1, 12.2, 12.3
-- Depends on: 003_seed_verticals.sql (laundry vertical must already exist)
--
-- This migration:
-- 1. Looks up the laundry vertical id from the verticals table
-- 2. Assigns all existing businesses to the laundry vertical
-- 3. Copies laundry default configs into each business's config columns
-- 4. Migrates existing order is_delicate/rack_location into custom_fields JSONB

DO $$
DECLARE
  laundry_vertical_id UUID;
  laundry_services JSONB;
  laundry_custom_fields JSONB;
  laundry_status_flow JSONB;
  laundry_whatsapp_templates JSONB;
BEGIN
  -- ==========================================================================
  -- Step 1: Look up the laundry vertical and its default configurations
  -- ==========================================================================
  SELECT id, services_default, custom_fields_default, status_flow_default, whatsapp_templates_default
  INTO laundry_vertical_id, laundry_services, laundry_custom_fields, laundry_status_flow, laundry_whatsapp_templates
  FROM verticals
  WHERE slug = 'laundry';

  IF laundry_vertical_id IS NULL THEN
    RAISE EXCEPTION 'Laundry vertical not found. Ensure migration 003_seed_verticals.sql has been applied first.';
  END IF;

  -- ==========================================================================
  -- Step 2: Assign all existing businesses to the laundry vertical
  -- Copy laundry defaults into business-level config columns
  -- ==========================================================================
  UPDATE businesses
  SET
    vertical_id = laundry_vertical_id,
    services_config = laundry_services,
    custom_fields_config = laundry_custom_fields,
    status_flow_config = laundry_status_flow,
    whatsapp_templates_config = laundry_whatsapp_templates
  WHERE vertical_id IS NULL;

  -- ==========================================================================
  -- Step 3: Migrate existing orders - copy is_delicate and rack_location
  -- into the custom_fields JSONB column
  -- ==========================================================================
  UPDATE orders
  SET custom_fields = jsonb_build_object(
    'is_delicate', is_delicate,
    'rack_location', COALESCE(rack_location, '')
  )
  WHERE custom_fields = '{}'::jsonb;

END $$;

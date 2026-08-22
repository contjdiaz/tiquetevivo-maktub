-- Migration: Multi-Vertical Platform Schema
-- Requirements: 9.1, 9.2, 9.3, 9.4, 8.1, 8.2, 8.5
-- Creates verticals table, extends businesses and orders tables for multi-vertical support

-- =============================================================================
-- 1. Create verticals table (Vertical Registry)
-- =============================================================================

CREATE TABLE IF NOT EXISTS verticals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📋',
  services_default JSONB NOT NULL DEFAULT '[]',
  custom_fields_default JSONB NOT NULL DEFAULT '[]',
  status_flow_default JSONB NOT NULL DEFAULT '[]',
  whatsapp_templates_default JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. Extend businesses table with vertical configuration columns
-- =============================================================================

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS vertical_id UUID REFERENCES verticals(id);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS services_config JSONB NOT NULL DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS custom_fields_config JSONB NOT NULL DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS status_flow_config JSONB NOT NULL DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_templates_config JSONB NOT NULL DEFAULT '{}';

-- =============================================================================
-- 3. Extend orders table with custom_fields and remove status CHECK constraint
-- =============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';

-- Drop the status CHECK constraint to allow dynamic status flows per vertical
-- The constraint name is derived from the column definition in schema.sql
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- =============================================================================
-- 4. RLS policies for verticals table
-- =============================================================================

ALTER TABLE verticals ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read verticals
DROP POLICY IF EXISTS "authenticated can read verticals" ON verticals;
CREATE POLICY "authenticated can read verticals" ON verticals
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only service_role can insert verticals (platform admin)
DROP POLICY IF EXISTS "service_role can insert verticals" ON verticals;
CREATE POLICY "service_role can insert verticals" ON verticals
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Only service_role can update verticals (platform admin)
DROP POLICY IF EXISTS "service_role can update verticals" ON verticals;
CREATE POLICY "service_role can update verticals" ON verticals
  FOR UPDATE
  USING (auth.role() = 'service_role');

-- Only service_role can delete verticals (platform admin)
DROP POLICY IF EXISTS "service_role can delete verticals" ON verticals;
CREATE POLICY "service_role can delete verticals" ON verticals
  FOR DELETE
  USING (auth.role() = 'service_role');

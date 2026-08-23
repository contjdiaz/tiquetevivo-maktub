-- Migration: Add digital confirmation columns to orders
-- Requirements: digital signature/acceptance confirmation on intake and delivery

-- Confirmation when the item is received (intake)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_confirmed_ip text;

-- Confirmation when the order is delivered
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_confirmed_ip text;

-- Migration: Add ticket_token column for public ticket access
-- Requirements: 2.5 (unique non-guessable token), 5.1, 5.2
-- Note: intake_photo_url and delivery_photo_url already exist from migration 005

-- Ensure pgcrypto is available (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add ticket_token column with default UUID generation
-- Using IF NOT EXISTS pattern via DO block for idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'ticket_token'
  ) THEN
    ALTER TABLE orders ADD COLUMN ticket_token UUID DEFAULT gen_random_uuid() NOT NULL;
  END IF;
END $$;

-- Backfill any existing orders that might have NULL ticket_token
-- (covers the case where the column was added without NOT NULL initially)
UPDATE orders SET ticket_token = gen_random_uuid() WHERE ticket_token IS NULL;

-- Create unique index for fast token lookups (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_ticket_token ON orders(ticket_token);

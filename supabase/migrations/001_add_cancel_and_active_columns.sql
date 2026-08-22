-- Migration: Add cancelled_at to orders and active/deactivated_at to businesses
-- Requirements: 5.1 (soft-delete orders), 7.1 (deactivate businesses)

-- Add cancelled_at column to orders table for soft-delete (cancellation) tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Add active flag to businesses table (defaults to true for existing rows)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Add deactivated_at timestamp to businesses table
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

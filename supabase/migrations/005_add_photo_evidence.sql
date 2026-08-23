-- Migration: Add photo evidence columns to orders
-- Requirements: photo evidence of intake and delivery

-- Photo taken when the item is received (intake)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_photo_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS intake_photo_taken_at timestamptz;

-- Photo taken when the order is delivered
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_photo_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_photo_taken_at timestamptz;

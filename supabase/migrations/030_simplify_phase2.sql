-- Migration: Simplify Phase 2 - Add business_pin_hash column
-- Adds optional PIN hash for PIN-based authentication (4-6 digit numeric PIN)

ALTER TABLE businesses ADD COLUMN business_pin_hash text;

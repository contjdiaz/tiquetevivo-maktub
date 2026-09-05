-- Migration: Add per-business payment_config for direct-transfer payment details.
-- Replaces hardcoded Nequi/Bancolombia numbers in the ticket page and WhatsApp
-- templates with per-business data, so each business shows its own accounts.
--
-- Shape (all keys optional):
--   {
--     "nequi": "3100000000",
--     "daviplata": "3200000000",
--     "bancolombia": "123-456789-01",
--     "account_holder": "Nombre del titular"
--   }
--
-- Idempotent: safe to run multiple times.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS payment_config JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN businesses.payment_config IS
  'Per-business direct-transfer payment details (nequi, daviplata, bancolombia, account_holder). Public-safe subset exposed via get-business-config.';

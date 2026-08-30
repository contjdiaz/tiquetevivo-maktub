-- Migration: Core Flows Phase 1 — otp_codes and delivery_tokens tables
-- Requirements: 2.2 (OTP storage), 9.1, 9.2 (Delivery tokens)

-- Ensure pgcrypto is available (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- OTP Codes table
-- Stores one-time passwords for ticket recovery phone verification
-- ============================================================

CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for looking up active OTPs by phone + business
CREATE INDEX IF NOT EXISTS otp_codes_phone_business_idx
  ON otp_codes (phone, business_id, expires_at DESC);

-- Index for cleanup of expired unused OTPs
CREATE INDEX IF NOT EXISTS otp_codes_cleanup_idx
  ON otp_codes (expires_at)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

-- Enable RLS — only service_role (Netlify Functions) can access
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- No permissive policies: service_role bypasses RLS automatically.
-- This ensures no anonymous or authenticated user can read/write OTP codes directly.

-- ============================================================
-- Delivery Tokens table
-- Stores time-limited single-use tokens for delivery confirmation
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique index for fast token lookups (ensures no duplicate tokens)
CREATE UNIQUE INDEX IF NOT EXISTS delivery_tokens_token_idx ON delivery_tokens(token);

-- Index for looking up tokens by order with most recent first
CREATE INDEX IF NOT EXISTS delivery_tokens_order_idx
  ON delivery_tokens (order_id, expires_at DESC);

-- Enable RLS — only service_role (Netlify Functions) can access
ALTER TABLE delivery_tokens ENABLE ROW LEVEL SECURITY;

-- No permissive policies: service_role bypasses RLS automatically.
-- This ensures no anonymous or authenticated user can read/write delivery tokens directly.

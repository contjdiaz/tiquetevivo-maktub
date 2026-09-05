-- Migration: Approval requests (quote approval by the customer).
--
-- Enables verticals like mechanic / phone repair / tailoring where the business
-- sends a quote and the customer approves or rejects it from a public link
-- (WhatsApp / ticket). Mirrors the delivery_tokens pattern (migration 020):
-- single-use, time-limited, token-secured, service_role-only via RLS.
--
-- Idempotent: safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  decided_at TIMESTAMPTZ,
  decided_ip TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast, unique token lookups.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_token_idx ON approval_requests(token);

-- Most-recent-active request per order.
CREATE INDEX IF NOT EXISTS approval_requests_order_idx
  ON approval_requests (order_id, created_at DESC);

-- RLS: service_role (Netlify Functions) bypasses RLS. No permissive policies:
-- anon/authenticated cannot read/write approval requests directly.
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;

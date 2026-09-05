-- Migration: Customers as a first-class entity.
--
-- Today customer data lives embedded in `orders` (customer_name/customer_phone).
-- This migration introduces a `customers` table and links orders to it, enabling
-- retention metrics (frequency, days-since-last-order, return rate) per business.
--
-- All changes are additive: orders.customer_id is nullable and orders keeps its
-- customer_name/customer_phone columns as historical fallback.
--
-- Idempotent: safe to run multiple times.

-- =============================================================================
-- 1. customers table
-- =============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  consent_marketing BOOLEAN NOT NULL DEFAULT false,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_order_at TIMESTAMPTZ,
  orders_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A phone identifies a customer uniquely within a business (multi-tenant safe).
  UNIQUE (business_id, phone)
);

CREATE INDEX IF NOT EXISTS customers_business_idx ON customers (business_id);
CREATE INDEX IF NOT EXISTS customers_last_order_idx ON customers (business_id, last_order_at DESC);

-- updated_at trigger (reuses the shared function from schema.sql)
DROP TRIGGER IF EXISTS update_customers_updated_at ON customers;
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: service_role (Netlify Functions) bypasses RLS; block anon/authenticated
-- direct access. Reads for the operator panel go through authenticated functions.
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own customers" ON customers;
CREATE POLICY "members read own customers" ON customers
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM business_users bu
      WHERE bu.auth_user_id = auth.uid()
        AND bu.business_id = customers.business_id
        AND bu.active = true
    )
  );

-- =============================================================================
-- 2. Link orders -> customers (nullable FK, non-breaking)
-- =============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);

-- =============================================================================
-- 3. Backfill customers from existing orders (idempotent)
-- =============================================================================

-- Create one customer per distinct (business_id, customer_phone) with aggregates.
INSERT INTO customers (business_id, name, phone, first_seen_at, last_order_at, orders_count)
SELECT
  o.business_id,
  -- Use the most recent name seen for that phone.
  (ARRAY_AGG(o.customer_name ORDER BY o.created_at DESC))[1] AS name,
  o.customer_phone AS phone,
  MIN(o.created_at) AS first_seen_at,
  MAX(o.created_at) AS last_order_at,
  COUNT(*) AS orders_count
FROM orders o
WHERE o.customer_phone IS NOT NULL AND o.customer_phone <> ''
GROUP BY o.business_id, o.customer_phone
ON CONFLICT (business_id, phone) DO NOTHING;

-- Link existing orders to their customer.
UPDATE orders o
SET customer_id = c.id
FROM customers c
WHERE o.customer_id IS NULL
  AND c.business_id = o.business_id
  AND c.phone = o.customer_phone;

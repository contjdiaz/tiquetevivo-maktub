-- Migration: Add reactivation engine tables (coupons + reactivation_log)
-- Requirements: 7, 8, 9, 10, 12
-- Creates coupons table for trackable discount codes, reactivation_log for
-- campaign tracking, adds reactivation_config to businesses, and marketing_opt_in
-- to customer_loyalty for opt-out support.

-- =============================================================================
-- 1. Create coupons table
-- =============================================================================

create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  code text not null unique,
  type text not null check (type in ('PERCENT', 'AMOUNT', 'FREE_DELIVERY')),
  value numeric(12,2) not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 2. Create reactivation_log table
-- =============================================================================

create table if not exists reactivation_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  phone text not null,
  coupon_id uuid references coupons(id) on delete set null,
  sent_at timestamptz not null default now(),
  clicked_at timestamptz,
  converted_order_id uuid references orders(id) on delete set null,
  status text not null default 'SENT' check (status in ('SENT', 'DELIVERED', 'READ', 'FAILED', 'CONVERTED'))
);

-- =============================================================================
-- 3. Create index for efficient phone + date lookup
-- =============================================================================

create index if not exists reactivation_log_phone_idx
  on reactivation_log (phone, sent_at desc);

-- =============================================================================
-- 4. Add reactivation_config to businesses
-- =============================================================================

alter table businesses
  add column if not exists reactivation_config jsonb not null
  default '{"enabled": true, "threshold_days": 30, "monthly_limit": 50}';

-- =============================================================================
-- 5. Add marketing_opt_in to customer_loyalty for opt-out tracking
-- =============================================================================

alter table customer_loyalty
  add column if not exists marketing_opt_in boolean default true;

-- =============================================================================
-- 6. RLS policies for coupons
-- =============================================================================

alter table coupons enable row level security;

-- Public can read coupons (for validation via code lookup)
drop policy if exists "public can read coupons" on coupons;
create policy "public can read coupons" on coupons
  for select
  using (true);

-- Only service_role can insert/update/delete coupons
drop policy if exists "service_role can manage coupons" on coupons;
create policy "service_role can manage coupons" on coupons
  for all
  using (auth.role() = 'service_role');

-- =============================================================================
-- 7. RLS policies for reactivation_log
-- =============================================================================

alter table reactivation_log enable row level security;

-- Authenticated users can read reactivation logs for their businesses
drop policy if exists "users read own reactivation_log" on reactivation_log;
create policy "users read own reactivation_log" on reactivation_log
  for select
  using (
    exists (
      select 1 from business_users bu
      where bu.auth_user_id = auth.uid()
        and bu.business_id = reactivation_log.business_id
        and bu.active = true
    )
  );

-- Only service_role can insert/update reactivation logs
drop policy if exists "service_role can manage reactivation_log" on reactivation_log;
create policy "service_role can manage reactivation_log" on reactivation_log
  for all
  using (auth.role() = 'service_role');

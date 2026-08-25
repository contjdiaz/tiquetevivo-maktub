-- Migration: Add customer loyalty tables
-- Requirements: 1 (Stamp Visualization), 2 (Automatic Stamp Accumulation),
--               3 (Reward Redemption), 11 (Loyalty Configuration Management)
-- Creates customer_loyalty and loyalty_events tables, adds loyalty_config to businesses

-- =============================================================================
-- 1. Create customer_loyalty table
-- =============================================================================

create table if not exists customer_loyalty (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  total_stamps integer not null default 0,
  available_rewards integer not null default 0,
  last_stamp_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 2. Create loyalty_events table
-- =============================================================================

create table if not exists loyalty_events (
  id uuid primary key default gen_random_uuid(),
  loyalty_id uuid not null references customer_loyalty(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  event_type text not null check (event_type in ('STAMP', 'REVERT', 'REDEEM')),
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 3. Unique partial index: one stamp per order (idempotency enforcement)
-- =============================================================================

create unique index if not exists loyalty_events_one_stamp_per_order
  on loyalty_events(order_id)
  where event_type = 'STAMP';

-- =============================================================================
-- 4. Add loyalty_config column to businesses
-- =============================================================================

alter table businesses
  add column if not exists loyalty_config jsonb not null default '{"enabled": true, "target": 5}';

-- =============================================================================
-- 5. Enable RLS and add policies
-- =============================================================================

alter table customer_loyalty enable row level security;
alter table loyalty_events enable row level security;

-- Public read access (tiquete.html needs to display stamps)
drop policy if exists "public can read customer_loyalty" on customer_loyalty;
create policy "public can read customer_loyalty" on customer_loyalty
  for select using (true);

drop policy if exists "public can read loyalty_events" on loyalty_events;
create policy "public can read loyalty_events" on loyalty_events
  for select using (true);

-- Service role write access (Netlify Functions use service_role key)
drop policy if exists "service_role can insert customer_loyalty" on customer_loyalty;
create policy "service_role can insert customer_loyalty" on customer_loyalty
  for insert
  with check (auth.role() = 'service_role');

drop policy if exists "service_role can update customer_loyalty" on customer_loyalty;
create policy "service_role can update customer_loyalty" on customer_loyalty
  for update
  using (auth.role() = 'service_role');

drop policy if exists "service_role can delete customer_loyalty" on customer_loyalty;
create policy "service_role can delete customer_loyalty" on customer_loyalty
  for delete
  using (auth.role() = 'service_role');

drop policy if exists "service_role can insert loyalty_events" on loyalty_events;
create policy "service_role can insert loyalty_events" on loyalty_events
  for insert
  with check (auth.role() = 'service_role');

drop policy if exists "service_role can update loyalty_events" on loyalty_events;
create policy "service_role can update loyalty_events" on loyalty_events
  for update
  using (auth.role() = 'service_role');

drop policy if exists "service_role can delete loyalty_events" on loyalty_events;
create policy "service_role can delete loyalty_events" on loyalty_events
  for delete
  using (auth.role() = 'service_role');

-- =============================================================================
-- 6. Add update_updated_at trigger on customer_loyalty
-- =============================================================================

drop trigger if exists update_customer_loyalty_updated_at on customer_loyalty;
create trigger update_customer_loyalty_updated_at
  before update on customer_loyalty
  for each row execute function update_updated_at_column();

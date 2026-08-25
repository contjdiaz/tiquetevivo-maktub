-- Adds order_items table for structured garment/item tracking.
-- This replaces free-text items_text with a checklist per order.
-- Premium feature: available only for paid-plan businesses.

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  item_type text not null default 'prenda',
  description text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  total_price numeric(12,2) generated always as (quantity * unit_price) stored,
  status text not null default 'OK' check (status in ('OK', 'DAMAGED', 'MISSING', 'STAINED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on order_items (order_id);
create index if not exists order_items_business_idx on order_items (business_id);

alter table order_items enable row level security;

-- Read access: own business orders (handled by service role in functions; policy allows authenticated app access)
drop policy if exists "users read own order_items" on order_items;
create policy "users read own order_items" on order_items
  for select
  using (
    exists (
      select 1 from business_users bu
      where bu.auth_user_id = auth.uid()
        and bu.business_id = order_items.business_id
        and bu.active = true
    )
  );

drop trigger if exists update_order_items_updated_at on order_items;
create trigger update_order_items_updated_at
  before update on order_items
  for each row execute function update_updated_at_column();

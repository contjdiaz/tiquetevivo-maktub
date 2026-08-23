create extension if not exists pgcrypto;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  phone text,
  address text,
  city text,
  color text default '#18a058',
  logo_url text,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  active boolean not null default true,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  order_number text not null,
  customer_name text not null,
  customer_phone text not null,
  items_text text not null,
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,
  balance numeric(12,2) generated always as (greatest(total - paid, 0)) stored,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'IN_PROGRESS', 'READY', 'DELIVERED', 'CANCELLED')),
  due_date date,
  rack_location text,
  is_delicate boolean not null default false,
  whatsapp_sent_at timestamptz,
  cancelled_at timestamptz,
  intake_photo_url text,
  intake_photo_taken_at timestamptz,
  delivery_photo_url text,
  delivery_photo_taken_at timestamptz,
  intake_confirmed_at timestamptz,
  intake_confirmed_ip text,
  delivery_confirmed_at timestamptz,
  delivery_confirmed_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_number)
);

create index if not exists orders_business_created_idx on orders (business_id, created_at desc);
create index if not exists orders_status_idx on orders (status);

alter table businesses enable row level security;
alter table orders enable row level security;

-- MVP: las Netlify Functions usan service_role y saltan RLS.
-- Cuando agregues login, reemplaza estas politicas por reglas por usuario/negocio.
drop policy if exists "public can read businesses" on businesses;
create policy "public can read businesses" on businesses for select using (true);
drop policy if exists "public can read orders" on orders;
create policy "public can read orders" on orders for select using (true);

-- Function to update updated_at automatically
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger update_businesses_updated_at
  before update on businesses
  for each row execute function update_updated_at_column();

create or replace trigger update_orders_updated_at
  before update on orders
  for each row execute function update_updated_at_column();

-- Historial de mensajes de WhatsApp
create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  business_id uuid references businesses(id) on delete cascade,
  phone text not null,
  template_name text,
  message_body text,
  meta_message_id text,
  status text not null default 'SENT',
  error_message text,
  created_at timestamptz not null default now()
);

alter table whatsapp_messages enable row level security;
drop policy if exists "public can read whatsapp_messages" on whatsapp_messages;
create policy "public can read whatsapp_messages" on whatsapp_messages for select using (true);

-- Business users and roles
create table if not exists business_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  business_id uuid references businesses(id) on delete cascade,
  email text not null,
  role text not null default 'operator' check (role in ('superadmin', 'owner', 'operator')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, business_id)
);

create index if not exists business_users_auth_idx on business_users (auth_user_id);
create index if not exists business_users_business_idx on business_users (business_id);

alter table business_users enable row level security;

drop policy if exists "users read own memberships" on business_users;
create policy "users read own memberships" on business_users for select using (auth.uid() = auth_user_id);

drop policy if exists "superadmin manage memberships" on business_users;
create policy "superadmin manage memberships" on business_users
  for all
  using (
    exists (
      select 1 from business_users bu
      where bu.auth_user_id = auth.uid()
        and bu.role = 'superadmin'
        and bu.active = true
    )
  );

create trigger if not exists update_business_users_updated_at
  before update on business_users
  for each row execute function update_updated_at_column();

-- Seed default business
insert into businesses (slug, name, phone, address, city, color)
values ('majesty', 'Majesty Lavanderia', '+573001234567', 'Calle 50 #21-15', 'Medellin', '#18a058')
on conflict (slug) do update set name = excluded.name;




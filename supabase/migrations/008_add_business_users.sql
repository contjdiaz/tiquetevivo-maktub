-- Adds business_users table to link Supabase Auth users with businesses and roles.
-- Roles: superadmin (can manage everything), owner (manages one business), operator (creates/updates orders).

-- Ensure the updated_at helper function exists (idempotent)
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

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

comment on table business_users is 'Links Supabase Auth users to businesses with a specific role.';
comment on column business_users.role is 'superadmin: manages all businesses; owner: manages one business; operator: works on orders for one business.';

alter table business_users enable row level security;

-- Users can read their own membership rows
 drop policy if exists "users read own memberships" on business_users;
create policy "users read own memberships" on business_users for select using (auth.uid() = auth_user_id);

-- Superadmins can manage all memberships (managed via application/service role)
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

drop trigger if exists update_business_users_updated_at on business_users;
create trigger update_business_users_updated_at
  before update on business_users
  for each row execute function update_updated_at_column();

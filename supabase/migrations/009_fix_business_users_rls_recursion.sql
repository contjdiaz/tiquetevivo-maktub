-- Fix RLS recursion on business_users by ensuring the superadmin check
-- uses a SECURITY DEFINER helper that does not re-evaluate RLS.

-- Recreate helper function (idempotent)
create or replace function is_superadmin(check_user_id uuid)
returns boolean
language plpgsql
security definer
as $$
begin
  return exists (
    select 1 from business_users
    where auth_user_id = check_user_id
      and role = 'superadmin'
      and active = true
  );
end;
$$;

-- Drop and recreate policies to ensure they use the helper
alter table business_users disable row level security;
alter table business_users enable row level security;

drop policy if exists "users read own memberships" on business_users;
create policy "users read own memberships" on business_users
  for select
  using (auth.uid() = auth_user_id);

drop policy if exists "superadmin manage memberships" on business_users;
create policy "superadmin manage memberships" on business_users
  for all
  using (is_superadmin(auth.uid()));

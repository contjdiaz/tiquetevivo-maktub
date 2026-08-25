-- Migration: Add payments table for payment gateway reconciliation (Wompi/Bold)
-- Requirements: 4 (Payment button), 5 (Webhook processing), 6 (Payment confirmation)

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  gateway text not null check (gateway in ('WOMPI', 'BOLD')),
  gateway_transaction_id text not null unique,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'COP',
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'MANUAL_REVIEW')),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for quick lookups by order
create index if not exists payments_order_idx on payments (order_id);

-- Enable RLS
alter table payments enable row level security;

-- Read access: business users can read their own business payments
drop policy if exists "users read own payments" on payments;
create policy "users read own payments" on payments
  for select
  using (
    exists (
      select 1 from business_users bu
      where bu.auth_user_id = auth.uid()
        and bu.business_id = payments.business_id
        and bu.active = true
    )
  );

-- updated_at trigger
drop trigger if exists update_payments_updated_at on payments;
create trigger update_payments_updated_at
  before update on payments
  for each row execute function update_updated_at_column();

-- Adds plan tier to businesses for freemium support.
-- Free plans cannot use premium features like photo evidence or digital confirmation.

alter table businesses
  add column if not exists plan text not null default 'free' check (plan in ('free', 'paid'));

comment on column businesses.plan is 'Subscription tier: free or paid. Free plans disable premium features.';

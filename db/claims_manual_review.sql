create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'claim_status'
  ) then
    create type public.claim_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  restaurant_id text,
  restaurant_name text not null,
  address text not null,
  postal_code text,
  city text,
  type text,
  contact_person text,
  phone text,
  organization_number text,
  website text,
  message text,
  status public.claim_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table public.claims
  alter column user_id drop not null,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists type text,
  add column if not exists contact_person text,
  add column if not exists organization_number text;

create index if not exists claims_user_status_idx
  on public.claims (user_id, status);

create index if not exists claims_email_idx
  on public.claims (email);

create index if not exists claims_status_idx
  on public.claims (status);

create index if not exists claims_status_created_at_idx
  on public.claims (status, created_at);

create unique index if not exists claims_one_pending_per_user_idx
  on public.claims (user_id)
  where status = 'pending';

alter table public.claims enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
    and tablename = 'claims'
    and policyname = 'users can read own claims'
  ) then
    create policy "users can read own claims"
      on public.claims for select
      using (user_id = auth.uid());
  end if;
end $$;

-- Admin TODO:
-- Build an admin-only view for pending claims:
-- 1. list claims where status = 'pending'
-- 2. approve: create/update restaurants.claimed_by_user_id, claim_email, claimed_at, claimed=true
-- 3. reject: set status='rejected', reviewed_at=now(), reviewed_by=admin user id
-- Admin mutations should run server-side with SUPABASE_SERVICE_KEY.

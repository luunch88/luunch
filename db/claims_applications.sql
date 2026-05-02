create extension if not exists pgcrypto;

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  restaurant_name text not null,
  address text not null,
  postal_code text not null,
  city text not null,
  restaurant_type text not null,
  contact_person text not null,
  email text not null,
  phone text,
  website text,
  organization_number text,
  message text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  admin_note text,
  constraint claims_status_check check (status in ('pending', 'approved', 'rejected'))
);

alter table public.claims
  add column if not exists user_id uuid,
  add column if not exists restaurant_name text,
  add column if not exists address text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists restaurant_type text,
  add column if not exists contact_person text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists organization_number text,
  add column if not exists message text,
  add column if not exists status text not null default 'pending',
  add column if not exists created_at timestamptz default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by text,
  add column if not exists admin_note text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
    and table_name = 'claims'
    and column_name = 'type'
  ) then
    execute 'update public.claims set restaurant_type = coalesce(restaurant_type, type) where restaurant_type is null';
  end if;
end $$;

alter table public.claims
  alter column status type text using status::text;

alter table public.claims
  alter column restaurant_name set not null,
  alter column address set not null,
  alter column postal_code set not null,
  alter column city set not null,
  alter column restaurant_type set not null,
  alter column contact_person set not null,
  alter column email set not null,
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'claims_status_check'
  ) then
    alter table public.claims
      add constraint claims_status_check check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists claims_status_idx
  on public.claims (status);

create index if not exists claims_email_idx
  on public.claims (email);

create index if not exists claims_created_at_idx
  on public.claims (created_at);

alter table public.claims enable row level security;

-- Claims are written and read through serverless API routes with SUPABASE_SERVICE_ROLE_KEY.
-- Do not add public insert/select policies unless you intentionally want direct browser access.

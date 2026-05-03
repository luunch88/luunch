alter table public.restaurants
add column if not exists status text not null default 'unclaimed';

alter table public.restaurants
add column if not exists owner_user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_status_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
    add constraint restaurants_status_check
    check (status in ('unclaimed', 'pending_claim', 'claimed', 'verified'));
  end if;
end $$;

create table if not exists public.restaurant_claims (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_name text not null,
  role text,
  phone text,
  email text not null,
  org_number text,
  message text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create unique index if not exists restaurant_claims_one_pending_per_restaurant_idx
on public.restaurant_claims (restaurant_id)
where status = 'pending';

create index if not exists restaurant_claims_status_idx
on public.restaurant_claims (status);

create index if not exists restaurant_claims_user_id_idx
on public.restaurant_claims (user_id);

create index if not exists restaurants_status_idx
on public.restaurants (status);

create index if not exists restaurants_owner_user_id_idx
on public.restaurants (owner_user_id);

notify pgrst, 'reload schema';

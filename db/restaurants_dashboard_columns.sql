alter table public.restaurants
  add column if not exists claimed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists restaurants_claimed_by_user_id_updated_at_idx
  on public.restaurants (claimed_by_user_id, updated_at desc);

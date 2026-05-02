alter table public.restaurants
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists name text,
  add column if not exists address text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists category text,
  add column if not exists type text,
  add column if not exists phone text,
  add column if not exists source text default 'manual',
  add column if not exists source_id text,
  add column if not exists osm_id text,
  add column if not exists slug text,
  add column if not exists claimed boolean default false,
  add column if not exists verified boolean default false,
  add column if not exists claimed_by_user_id uuid,
  add column if not exists claim_email text,
  add column if not exists claimed_at timestamptz,
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists visible boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.restaurants
  alter column id set default gen_random_uuid(),
  alter column source set default 'manual',
  alter column claimed set default false,
  alter column verified set default false,
  alter column visible set default true,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.restaurants
set
  source = coalesce(source, 'manual'),
  claimed = coalesce(claimed, false),
  verified = coalesce(verified, false),
  visible = coalesce(visible, true),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

create index if not exists restaurants_name_address_idx
  on public.restaurants (name, address);

create index if not exists restaurants_verified_lat_lon_idx
  on public.restaurants (verified, lat, lon);

create index if not exists restaurants_claimed_by_user_id_idx
  on public.restaurants (claimed_by_user_id);

notify pgrst, 'reload schema';

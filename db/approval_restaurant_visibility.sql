alter table public.claims
  add column if not exists user_id uuid;

alter table public.restaurants
  add column if not exists name text,
  add column if not exists address text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists category text,
  add column if not exists type text,
  add column if not exists source text,
  add column if not exists source_id text,
  add column if not exists osm_id text,
  add column if not exists slug text,
  add column if not exists claimed boolean not null default false,
  add column if not exists verified boolean not null default false,
  add column if not exists claimed_by_user_id uuid,
  add column if not exists claim_email text,
  add column if not exists claimed_at timestamptz,
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists visible boolean not null default false,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'restaurants_claimed_by_user_id_fkey'
  ) then
    alter table public.restaurants
      add constraint restaurants_claimed_by_user_id_fkey
      foreign key (claimed_by_user_id)
      references auth.users(id)
      on delete set null;
  end if;
exception
  when others then
    raise notice 'Skipping restaurants_claimed_by_user_id_fkey: %', sqlerrm;
end $$;

create index if not exists restaurants_manual_visible_idx
  on public.restaurants (verified, visible, lat, lon);

create index if not exists restaurants_name_address_idx
  on public.restaurants (name, address);

create index if not exists restaurants_claimed_by_user_id_idx
  on public.restaurants (claimed_by_user_id);

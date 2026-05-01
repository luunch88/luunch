create extension if not exists pgcrypto;

alter table public.claims
  add column if not exists restaurant_id text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists type text,
  add column if not exists contact_person text,
  add column if not exists organization_number text,
  add column if not exists review_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  alter column user_id drop not null;

create index if not exists claims_email_idx
  on public.claims (email);

create index if not exists claims_status_idx
  on public.claims (status);

create index if not exists claims_restaurant_id_idx
  on public.claims (restaurant_id);

alter table public.restaurants
  add column if not exists source text,
  add column if not exists source_id text,
  add column if not exists slug text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists category text,
  add column if not exists type text,
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists claimed boolean not null default false,
  add column if not exists verified boolean not null default false,
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists claim_email text,
  add column if not exists claimed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists restaurants_verified_lat_lon_idx
  on public.restaurants (verified, lat, lon);

create index if not exists restaurants_claimed_by_user_id_idx
  on public.restaurants (claimed_by_user_id);

create unique index if not exists restaurants_source_id_unique_idx
  on public.restaurants (source_id)
  where source_id is not null;

create unique index if not exists restaurants_osm_id_unique_idx
  on public.restaurants (osm_id)
  where osm_id is not null;

-- Admin approval is intentionally server-side only:
-- /api/admin/claims/approve links a pending claim to an existing restaurants.id.
-- /api/admin/claims/approve-create creates a verified manual restaurant with lat/lon.
-- /api/admin/claims/reject marks the claim as rejected with an optional review_reason.
-- Configure ADMIN_EMAILS and SUPABASE_SERVICE_KEY in Vercel before using these endpoints.

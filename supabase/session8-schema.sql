-- MOMENTUM Supabase schema (Step B)
-- Mirrors BOb's persistence model. Run in Supabase → SQL Editor.
-- NOTE: confirm against BOb's live schema before applying in production.

-- 1. Saved sidebar configurations -------------------------------------------
create table if not exists public.configs (
  id           uuid primary key default gen_random_uuid(),
  project_name text,
  industry     text,
  template     text,
  business_fn  text,
  size         text,
  language     text,
  logo         text,
  payload      jsonb not null,          -- full sidebar config blob
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2. Full journey definitions -----------------------------------------------
create table if not exists public.journeys (
  id          uuid primary key default gen_random_uuid(),
  config_id   uuid references public.configs(id) on delete cascade,
  stages      jsonb not null,           -- serialized journeyStages (incl. tp.nameI18n)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3. KBR definitions ---------------------------------------------------------
-- IMPORTANT: answers[] and touchpoints[] are DISTINCT arrays — store both.
create table if not exists public.kbrs (
  id             uuid primary key default gen_random_uuid(),
  config_id      uuid references public.configs(id) on delete cascade,
  name           text not null,
  kbr_type       text,                  -- 'value' | 'percentage'
  direction      text,                  -- 'up' | 'down'
  risk_tolerance numeric,
  answers        jsonb not null default '[]'::jsonb,
  touchpoints    jsonb not null default '[]'::jsonb,
  alerts         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

-- 4. Point-in-time board snapshots ------------------------------------------
create table if not exists public.snapshots (
  id          uuid primary key default gen_random_uuid(),
  config_id   uuid references public.configs(id) on delete cascade,
  label       text,
  state       jsonb not null,           -- full board state for demo/restore
  created_at  timestamptz not null default now()
);

-- 5. Reusable touchpoint library --------------------------------------------
create table if not exists public.touchpoint_library (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_i18n   jsonb,                     -- tp.nameI18n {es,fr,pt}
  archetype   jsonb not null,
  created_at  timestamptz not null default now()
);

-- Row Level Security ---------------------------------------------------------
-- Demo posture: anon key may read/write. For authenticated users, replace the
-- USING/WITH CHECK clauses with (auth.uid() = owner) and add an owner column.
alter table public.configs            enable row level security;
alter table public.journeys           enable row level security;
alter table public.kbrs               enable row level security;
alter table public.snapshots          enable row level security;
alter table public.touchpoint_library enable row level security;

-- Demo policies (anon full access). TIGHTEN before any real multi-tenant use.
do $$
declare t text;
begin
  foreach t in array array['configs','journeys','kbrs','snapshots','touchpoint_library']
  loop
    execute format('drop policy if exists demo_all on public.%I;', t);
    execute format('create policy demo_all on public.%I for all using (true) with check (true);', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- MOMENTUM · Phase 3 — data profile storage
-- Additive to the five tables scaffolded in session 8. Nothing here is
-- required for a text-only configuration; a simulation with no data attached
-- never touches these objects.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · raw uploads. Large files go browser → Storage via signed URL and are
--     read exactly once by api/profile.js. They are never re-read afterwards.
insert into storage.buckets (id, name, public, file_size_limit)
values ('momentum-data', 'momentum-data', false, 536870912)
on conflict (id) do nothing;

-- 2 · the profile itself: ~50-700 KB of JSON, keyed by dataset id.
create table if not exists public.data_profiles (
  dataset_id      text primary key,
  schema_version  int         not null default 1,
  source_name     text,
  size_bytes      bigint,
  ingest_path     text        check (ingest_path in ('light','heavy')),
  rows_profiled   bigint      default 0,
  profile         jsonb       not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists data_profiles_created_idx on public.data_profiles (created_at desc);

create or replace function public.touch_data_profiles() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists data_profiles_touch on public.data_profiles;
create trigger data_profiles_touch before update on public.data_profiles
  for each row execute function public.touch_data_profiles();

-- 3 · RLS. Only the service role writes; api/profile.js holds that key, the
--     browser never does.
alter table public.data_profiles enable row level security;

drop policy if exists data_profiles_service_all on public.data_profiles;
create policy data_profiles_service_all on public.data_profiles
  for all to service_role using (true) with check (true);

drop policy if exists data_profiles_read on public.data_profiles;
create policy data_profiles_read on public.data_profiles
  for select to authenticated using (true);

-- 4 · configs reference the profile by id. Exports stay small and portable.
--
--     THE TABLE IS `configs`, NOT `configurations`. This line named the latter
--     for two sessions and nothing created it, so a fresh project failed on the
--     last statement of the file with no clue what the missing table should
--     look like. Session 8 (session8-schema.sql, table 1) creates `configs`.
--     Run that file FIRST; this one is additive to it.
alter table public.configs
  add column if not exists data_profile_id text references public.data_profiles(dataset_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 4 amendment · profile schema 2
-- The profile JSON gained cycles, transitions, schedules and per-cell sd. The
-- column is jsonb and schema_version already carries the number, so nothing
-- here changes. Profiles written at schema 1 remain readable; the generator
-- reports 'not bound' rather than failing when a v1 profile lacks a cycle
-- model, so an older stored profile degrades instead of breaking.
-- ═══════════════════════════════════════════════════════════════════════════

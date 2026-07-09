-- Minimal Supabase-schema stub so migration RLS can be exercised on a throwaway vanilla
-- Postgres (no local Supabase stack — see memory supabase-migration-local-testing).
-- Reproduces just enough of Supabase's auth + storage schema for the policies in
-- 0008_logbook_imports.sql to run and be role-switched: the `authenticated`/`anon` roles,
-- an auth.uid() that reads a per-session GUC, and a faithful storage.foldername + a
-- minimal storage.objects/buckets. RLS semantics are standard Postgres, so a stub with
-- the SAME foldername definition + SAME policies genuinely exercises the policy predicate
-- (this catches a missing WITH CHECK, a wrong path index, or a cross-user leak). Final
-- fidelity still requires applying to real Supabase — see the migration's manual step.

-- Roles Supabase provides. NOLOGIN; we reach them via `set role`.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;
grant usage on schema public, auth, storage to anon, authenticated;

-- auth.users (only the id matters here). FK targets it with on delete cascade.
create table if not exists auth.users (
    id uuid primary key
);

-- auth.uid(): in real Supabase it reads the JWT; here it reads a session GUC the test
-- sets per "logged-in" user via set_config('test.uid', …).
create or replace function auth.uid() returns uuid
    language sql stable
as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

-- storage.foldername: Supabase's helper — the path split minus the final filename.
-- 'uid/uuid-file.csv' -> {uid}; foldername[1] is the owning user's id.
create or replace function storage.foldername(name text) returns text[]
    language plpgsql stable
as $$
declare _parts text[];
begin
    _parts := string_to_array(name, '/');
    return _parts[1 : array_length(_parts, 1) - 1];
end $$;

create table if not exists storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean not null default false,
    file_size_limit    bigint,
    allowed_mime_types text[]   -- real Supabase column; 0009 sets it for the avatars bucket
);

-- Minimal storage.objects. `owner` mirrors Supabase (set-null on user delete, NOT
-- cascade — which is exactly why delete_user() must sweep the bucket explicitly).
create table if not exists storage.objects (
    id         uuid primary key default gen_random_uuid(),
    bucket_id  text references storage.buckets (id),
    name       text not null,
    owner      uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Minimal public.profiles so 0009's `alter table ... add constraint avatar_url_...` and
-- its owner-scoped insert/update RLS can be exercised WITHOUT pulling in 0001 (which needs
-- the citext extension). Real 0001 has more columns; only `id` + `avatar_url` + the owner
-- RLS matter for the avatar_url CHECK test. `display_name` is included so a realistic
-- insert works. Owner policies mirror 0001 (self insert/update; world-readable select).
create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text not null default '',
    avatar_url   text,
    created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Profiles readable by authenticated users"
    on public.profiles for select to authenticated using (true);
create policy "Users insert their own profile"
    on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Users update their own profile"
    on public.profiles for update to authenticated
    using (id = auth.uid()) with check (id = auth.uid());

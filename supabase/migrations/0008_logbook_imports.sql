-- 0008_logbook_imports.sql
-- Sample-collection for the MoonBoard logbook importer.
--
-- The official MoonBoard app can't be imported programmatically (App Check / Play
-- Integrity — see docs + memory), so users get their logbook via a GDPR request and
-- upload the returned file here. We don't yet know Moon's export format, so this stores
-- the RAW file byte-for-byte and records only an ENVELOPE row (who / when / where / size)
-- — zero assumptions about the contents. A future importer (out of scope) will read
-- `status = 'uploaded'` rows, parse them into public.ascents, and flip the status.
--
-- This is the project's FIRST Supabase Storage bucket. The entire security boundary is
-- (a) the bucket being PRIVATE and (b) owner-scoped RLS — the anon key is public by
-- design, so RLS is the only thing standing between one user and another's personal
-- logbook. The storage.objects folder-scoping policy (with check on writes) is the
-- load-bearing control: it pins every object to `{auth.uid()}/…` and blocks a user from
-- reading or writing another user's folder.
--
-- Manual step: paste this whole file into the Supabase SQL Editor and Run (see
-- docs/social-accounts-login-SETUP.md). The `insert into storage.buckets` below creates
-- the bucket; alternatively create it in the dashboard (Storage → New bucket →
-- "logbook-imports", Private, 25 MB limit) and the insert becomes a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- Private bucket. 25 MiB per-file limit (a GDPR export — even a full-account ZIP with
-- media — fits comfortably; blocks video dumps). Under the 50 MB project global, so no
-- global change is needed. No allowed_mime_types: browser MIME for .csv is unreliable,
-- so we gate by file extension client-side and cap only size here.
insert into storage.buckets (id, name, public, file_size_limit)
values ('logbook-imports', 'logbook-imports', false, 26214400)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Envelope-only metadata index. One row per uploaded file. NOTHING about MoonBoard's
-- format is modeled here — `storage_path` is a client-asserted hint (the storage.objects
-- RLS is the real boundary), and the raw bytes live in the bucket. Online-only (not part
-- of the offline-sync spine like ascents), so no updated_at trigger and no `deleted`
-- tombstone — removal is a hard delete.
create table if not exists public.logbook_imports (
    id                uuid        primary key default gen_random_uuid(),
    user_id           uuid        not null references auth.users (id) on delete cascade,
    storage_path      text        not null,
    original_filename text        not null default '',
    content_type      text        not null default '',
    size              bigint      not null default 0,
    status            text        not null default 'uploaded',
    created_at        timestamptz not null default now()
);

comment on table public.logbook_imports is
    'Envelope index for raw MoonBoard export files uploaded to the logbook-imports bucket. No file contents modeled; storage_path is a hint, the storage.objects RLS is the boundary.';

create index if not exists logbook_imports_user_created_idx
    on public.logbook_imports (user_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS on the metadata table: owner-only quartet, mirroring public.ascents (0002).
alter table public.logbook_imports enable row level security;

create policy "Users read their own logbook_imports"
    on public.logbook_imports for select to authenticated
    using (user_id = auth.uid());
create policy "Users insert their own logbook_imports"
    on public.logbook_imports for insert to authenticated
    with check (user_id = auth.uid());
create policy "Users update their own logbook_imports"
    on public.logbook_imports for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete their own logbook_imports"
    on public.logbook_imports for delete to authenticated
    using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS on storage.objects for THIS bucket — the load-bearing control. Every object must
-- live under `{auth.uid()}/…`; the first path segment (storage.foldername(name))[1] is
-- the owning user's id. `with check` on insert/update blocks folder-spoofing (a user
-- crafting `{victimUUID}/x.csv` to plant or overwrite in someone else's folder). RLS is
-- default-deny, so scoping to `bucket_id = 'logbook-imports'` leaves every other bucket
-- (and the anon role) untouched.
create policy "Users read own logbook-import objects"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'logbook-imports'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
create policy "Users upload own logbook-import objects"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'logbook-imports'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
create policy "Users update own logbook-import objects"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'logbook-imports'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'logbook-imports'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
create policy "Users delete own logbook-import objects"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'logbook-imports'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-user object cap (abuse / denial-of-wallet guard): at most 2 files per user (a GDPR
-- export is realistically one file, maybe a CSV + a JSON; Remove handles mistakes). This
-- lives on storage.objects — not just the metadata table — because a caller could upload
-- objects directly and skip the row insert, so the storage layer is the only place that
-- bounds the actual stored bytes (≤ 2 × 25 MB = 50 MB/user).
--
-- Enforced in a BEFORE INSERT trigger (not an RLS count subquery) so it is concurrency-
-- safe: the per-user advisory lock serializes this user's inserts within the transaction,
-- so a burst of parallel uploads can't each read count < 2 and all slip past (the TOCTOU
-- an RLS subquery would suffer under READ COMMITTED). SECURITY DEFINER so the count sees
-- all of the user's objects regardless of RLS; the lock key is scoped per user, so it
-- never serializes across different users.
create or replace function public.enforce_logbook_import_cap()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
declare
    _uid   text := (storage.foldername(new.name))[1];
    _count int;
begin
    if new.bucket_id <> 'logbook-imports' then
        return new;  -- other buckets are untouched
    end if;
    perform pg_advisory_xact_lock(hashtextextended('logbook-imports:' || coalesce(_uid, ''), 0));
    select count(*) into _count
    from storage.objects
    where bucket_id = 'logbook-imports'
      and (storage.foldername(name))[1] = _uid;
    if _count >= 2 then
        raise exception 'logbook-imports upload limit reached (max 2 files per user)'
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

drop trigger if exists enforce_logbook_import_cap on storage.objects;
create trigger enforce_logbook_import_cap
    before insert on storage.objects
    for each row execute function public.enforce_logbook_import_cap();

-- ─────────────────────────────────────────────────────────────────────────────
-- GDPR erasure: account deletion must sweep the user's uploaded files. The
-- logbook_imports rows cascade via their FK to auth.users, but storage.objects does NOT
-- cascade (its owner FK is set-null, not cascade), so deleting the account would orphan
-- the personal logbook files in the bucket. Extend the existing delete_user() RPC to
-- delete the user's objects first (while auth.uid() still resolves), then remove the
-- account as before. SECURITY DEFINER, so it can reach storage.objects.
create or replace function public.delete_user()
    returns void
    language plpgsql
    security definer
    set search_path = public
as $$
begin
    -- Sweep the caller's uploaded logbook-import files (folder-scoped to their uid).
    delete from storage.objects
    where bucket_id = 'logbook-imports'
      and (storage.foldername(name))[1] = auth.uid()::text;

    delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_user() from public;
grant execute on function public.delete_user() to authenticated;

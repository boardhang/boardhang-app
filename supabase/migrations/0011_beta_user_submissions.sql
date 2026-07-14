-- 0011_beta_user_submissions.sql
-- Phase 2 of the beta-videos feature: open the ONE write seam 0010 deliberately left closed —
-- let a signed-in user submit a *pending user* clip, and nothing else. Approval/rejection stay
-- service-role / dashboard only (no client UPDATE/DELETE policy), so the moderation boundary is
-- unbreakable from the client. (See docs/plans/2026-07-10-001-feat-web-beta-videos-plan.md, U1/U2.)
--
-- Four pieces:
--   1. INSERT policy — a full WITH CHECK clamp. Pins EVERY field the client must leave to the
--      server, not just the trust fields: a user row is source='user', status='pending',
--      provider='youtube', added_by=auth.uid(), not deleted, AND all metadata empty
--      (title/channel/views/is_short/duration_s). So "the client submits only a video_id" is a
--      DB-enforced invariant — a user cannot self-approve, impersonate, forge a seed row,
--      pre-tombstone, or forge attribution/views. Metadata can ONLY come from the trusted
--      server-side enrich pass (scripts/seed_beta_videos.py --enrich-pending, U6), which backfills
--      empty fields.
--   2. video_id format CHECK — defense-in-depth so a direct REST-API insert can't store a
--      malformed id even though the client extractor (U3) already validates it. Scoped to
--      provider='youtube' so a future Instagram row (different id shape) isn't blocked.
--   3. Per-user pending cap (BEFORE INSERT trigger) — at most 10 pending submissions per user, so
--      a scripted account can't flood the table or the notification channel. Counts *pending*
--      only, so it self-heals as the owner moderates. SECURITY DEFINER because the count must see
--      pending rows the RLS read-gate hides from the calling user.
--   4. Submission notification (AFTER INSERT trigger, WHEN source='user') — pings the owner via
--      pg_net. Source-filtered in the trigger because a dashboard Database Webhook cannot filter
--      by row and would fire on every seed insert too. Treated as a convenience nudge; the
--      authoritative "what's pending" list is the U6 enrich pass, which selects every pending row.
--
-- ⚠️ pg_net is a PROJECT PREREQUISITE, enabled once via the Supabase dashboard — NOT a
--    `create extension` line here (the extension isn't installed on the throwaway test Postgres,
--    which would break the RLS harness). The harness stubs net.http_post as a no-op logger.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. INSERT policy: a signed-in user may add exactly one shape of row — a pending user clip with
--    server-owned metadata left empty. Mirrors 0003's list_problems insert policy (added_by =
--    auth.uid() in the WITH CHECK).
drop policy if exists "Signed-in users submit a pending beta" on public.problem_beta_videos;
create policy "Signed-in users submit a pending beta"
    on public.problem_beta_videos for insert to authenticated
    with check (
        source     = 'user'
        and status = 'pending'
        and provider = 'youtube'
        and added_by = auth.uid()
        and not deleted
        -- metadata MUST originate from the trusted enrich pass (U6), never the client:
        and title = ''
        and channel = ''
        and views = 0
        and is_short = false
        and duration_s is null
    );
-- No UPDATE/DELETE policy for users — moderation (approve/reject/soft-delete) is service-role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Table constraints, added NOT VALID then validated in a second step so the ADD takes only a
--    brief lock (VALIDATE needs just SHARE UPDATE EXCLUSIVE, not ACCESS EXCLUSIVE for a full
--    scan) — matters as the public-read table grows. Both are guarded so a re-run after a partial
--    apply is clean (ALTER TABLE has no ADD CONSTRAINT IF NOT EXISTS).
--
--   (a) video_id format (YouTube-scoped). Existing 0010 rows are youtube with real 11-char ids,
--       so validation passes; instagram (reserved for later) is left unconstrained.
--   (b) reject invariant: a rejected row MUST be soft-deleted. The dedupe index (0010) is
--       `where not deleted`, so a status-only reject would strand the (problem, provider, video)
--       tuple and permanently block re-adding the clip. This makes that mistake unrepresentable
--       rather than merely documented in the runbook.
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'problem_beta_videos_video_id_fmt') then
        alter table public.problem_beta_videos
            add constraint problem_beta_videos_video_id_fmt
            check (provider <> 'youtube' or video_id ~ '^[A-Za-z0-9_-]{11}$') not valid;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'problem_beta_videos_reject_soft_deleted') then
        alter table public.problem_beta_videos
            add constraint problem_beta_videos_reject_soft_deleted
            check (status <> 'rejected' or deleted) not valid;
    end if;
end $$;
alter table public.problem_beta_videos validate constraint problem_beta_videos_video_id_fmt;
alter table public.problem_beta_videos validate constraint problem_beta_videos_reject_soft_deleted;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Per-user pending-submission cap. SECURITY DEFINER so the count sees pending rows the
--    read-gate would otherwise hide from the calling user (else the cap would always read 0).
create or replace function public.enforce_beta_pending_cap()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, pg_catalog
as $$
declare _pending int;
begin
    -- Serialize the check per user: a plain count under READ COMMITTED lets N concurrent inserts
    -- each read the same pre-commit count and all pass, defeating the cap (the exact scripted-flood
    -- adversary it exists to stop). A per-user xact advisory lock queues same-user inserts so each
    -- sees the others' committed rows; different users don't contend.
    perform pg_advisory_xact_lock(hashtextextended(new.added_by::text, 0));
    select count(*) into _pending
    from public.problem_beta_videos
    where added_by = new.added_by and status = 'pending' and not deleted;
    if _pending >= 10 then
        raise exception
            'Beta submission limit reached: % pending (max 10). Wait for review before adding more.',
            _pending;
    end if;
    return new;
end $$;

drop trigger if exists beta_pending_cap on public.problem_beta_videos;
create trigger beta_pending_cap
    before insert on public.problem_beta_videos
    for each row when (new.source = 'user')
    execute function public.enforce_beta_pending_cap();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Submission notification.
--
-- The webhook URL lives in an RLS-LOCKED config table, NOT a custom GUC. A dotted GUC like
-- `app.beta_webhook_url` is USERSET — any signed-in user can `set_config` it for their own session
-- and redirect the pg_net POST to an arbitrary internal/metadata URL (SSRF from the database's
-- network context). Reading from a table only the service role / owner can write closes that: a
-- user can neither read nor influence the target.
create table if not exists public.beta_notify_config (
    id          int  primary key default 1 check (id = 1),  -- enforce a single row
    webhook_url text not null default ''
);
insert into public.beta_notify_config (id, webhook_url) values (1, '')
    on conflict (id) do nothing;
alter table public.beta_notify_config enable row level security;
-- No anon/authenticated policy and no client GRANT → deny-all for clients. Only the service role
-- / owner (which bypass RLS) and the SECURITY DEFINER function below can read or write it.

-- Fires only on user rows (WHEN new.source='user'). SECURITY DEFINER so it reads the locked config
-- and calls net.http_post as the owner (not the invoking user, whose net.http_post grant is not
-- guaranteed in prod — an invoker-privilege failure would otherwise roll back the submission). The
-- POST is wrapped so ANY delivery/permission error is swallowed: a notification must never block or
-- roll back a submission (the U6 enrich pass is the reconciliation backstop).
create or replace function public.notify_beta_submission()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, pg_catalog
as $$
declare _url text;
begin
    select webhook_url into _url from public.beta_notify_config where id = 1;
    if _url is null or _url = '' then
        return null;  -- notifications not configured — inert
    end if;
    begin
        perform net.http_post(
            url     := _url,
            -- Body carries a human-readable message under BOTH `content` (Discord) and `text`
            -- (Slack) so the same payload works for either incoming webhook, plus the structured
            -- fields for a generic relay (Make/Zapier/n8n) that forwards elsewhere.
            body    := jsonb_build_object(
                'content',           format('🎥 New beta submitted — https://youtu.be/%s (problem %s)',
                                            new.video_id, new.source_catalog_id),
                'text',              format('🎥 New beta submitted — https://youtu.be/%s (problem %s)',
                                            new.video_id, new.source_catalog_id),
                'event',             'beta_submission',
                'source_catalog_id', new.source_catalog_id,
                'video_id',          new.video_id,
                'added_by',          new.added_by
            ),
            headers := jsonb_build_object('Content-Type', 'application/json')
        );
    exception when others then
        null;  -- best-effort: delivery failure never touches the user's transaction
    end;
    return null;  -- AFTER trigger; return value ignored
end $$;

drop trigger if exists beta_submission_notify on public.problem_beta_videos;
create trigger beta_submission_notify
    after insert on public.problem_beta_videos
    for each row when (new.source = 'user')
    execute function public.notify_beta_submission();

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual steps (no SQL equivalent):
--   1. Enable pg_net once on the project: Dashboard → Database → Extensions → enable `pg_net`.
--   2. Apply this migration (SQL Editor → paste + Run, or `supabase db push`).
--   3. Set the notification target so the trigger fires (empty = inert). Run as the owner /
--      service role (the table is RLS-locked to clients — do NOT use a session GUC):
--        update public.beta_notify_config set webhook_url = 'https://<owner-channel-webhook>' where id = 1;
--      (a Slack/Discord incoming webhook or an email relay). Never commit the URL.
--
-- Moderation runbook (dashboard — Table Editor or a saved SQL snippet):
--   • First enrich pending metadata:  python scripts/seed_beta_videos.py --enrich-pending
--     (fills title/channel/views/duration_s/is_short; also prints the pending queue — U6.)
--   • APPROVE a clip:
--        update public.problem_beta_videos set status = 'approved' where id = '<id>';
--   • REJECT a clip — MUST soft-delete too, not status alone (the dedupe index is
--     `where not deleted`; a status-only reject strands the tuple and the clip can never be
--     re-added):
--        update public.problem_beta_videos set status = 'rejected', deleted = true where id = '<id>';
-- ─────────────────────────────────────────────────────────────────────────────

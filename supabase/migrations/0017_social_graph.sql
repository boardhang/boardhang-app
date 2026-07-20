-- 0017_social_graph.sql
-- Friends / follow feed (the social arc's next phase): a persistent, ASYMMETRIC follow
-- graph and an activity feed of friends' sends. This deliberately adds a new sharing axis
-- alongside — not replacing — the membership-based sharing of collaborative lists (0003):
-- lists/sessions are unchanged; following is a durable relationship independent of any list.
--
-- Scope (this migration = storage + columns + helpers + trigger + RLS only; every RPC —
-- request_follow, block_user, search_profiles, the feed/profile-sends projection core —
-- lives in 0018, mirroring the 0003→0004 storage-then-RPC split):
--   • profiles gains is_private (public/private account) + privacy_choice_at (the
--     explicit-choice marker, so existing users get exactly one privacy notice — KTD9).
--   • ascents gains first_sent_at: a SERVER-STAMPED, immutable-once-set timestamp of when
--     the server first saw a row as sent=true. It is the feed's sort key — fresh on late
--     sync, unmoved by edits, ungameable by the client's `date` (KTD3).
--   • follows: the edge table (follower → followee, pending|active). No friend symmetry.
--   • blocks: a bidirectional cut. is_blocked(a,b) is threaded through every social read
--     in 0018; blocking removes edges both ways (block_user, 0018).
--   • notifications: fire-and-forget events (new follower, request accepted). Follow
--     REQUESTS are NOT here — they are read from `follows WHERE status='pending'` (KTD7).
--
-- Design (see docs/plans/2026-07-20-001-feat-web-friends-feed-plan.md):
--   • Cross-user reads of owner-only `ascents` (0002) are NOT done by relaxing ascents RLS
--     — that would leak the whole logbook row. They go through 0018's minimal-projection
--     SECURITY DEFINER core. `ascents` RLS stays owner-only, untouched.
--   • Edge creation is gated: `follows` has NO direct INSERT policy (a private target must
--     land `pending`, which the client cannot be trusted to set). request_follow() (0018)
--     is the only writer, same as list_members / join_list_by_token (0003/0004).
--
-- RLS: a user reads their own edges (either side), their own blocks, their own
-- notifications. All FKs are ON DELETE CASCADE on BOTH sides, so the existing
-- public.delete_user() (0001) sweeps a deleted user's follows (both directions), blocks,
-- and notifications with no RPC change.
--
-- NOTE on statement order: the `language sql` helpers validate their bodies at CREATE time
-- (check_function_bodies), so the tables they query must exist first. And the first_sent_at
-- BACKFILL must run BEFORE its trigger exists (the trigger would otherwise overwrite the
-- backfilled value with now()). Hence: profile/ascent columns → backfill → trigger →
-- tables → helpers → RLS.

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles: privacy flag + explicit-choice marker.
--   • is_private DEFAULT false keeps the column non-null and the feed live by default, but
--     the UI never sets it implicitly — new users pick during onboarding, existing users
--     via a one-time notice (KTD9). privacy_choice_at is that marker: NULL = "never chose"
--     (show the notice); a timestamp = "chose" (never show again).
alter table public.profiles
    add column if not exists is_private        boolean     not null default false,
    add column if not exists privacy_choice_at timestamptz;

comment on column public.profiles.is_private is
    'Account privacy. false = public (any signed-in, non-blocked user may follow + see sends). true = private (sends/feed/stats/follower-list gated to active followers; the profile card stays visible).';
comment on column public.profiles.privacy_choice_at is
    'When the user explicitly chose public/private (onboarding step or one-time notice). NULL = not yet chosen; drives the exactly-once existing-user privacy notice (KTD9).';

-- ─────────────────────────────────────────────────────────────────────────────
-- ascents.first_sent_at: the feed's sort key (KTD3).
-- Server-stamped the first time a row is seen sent=true, NEVER moved thereafter, NULL while
-- unsent. Ordering the feed by this (not by climb `date`, not by `updated_at`) gives:
--   fresh (a week-late sync appears at arrival time), no edit-spam (a re-grade bumps
--   updated_at, not this), no clock-gaming (server clock, not user-set `date`), no
--   backfill-invisibility (ordered by arrival, not climb date).
alter table public.ascents
    add column if not exists first_sent_at timestamptz;

comment on column public.ascents.first_sent_at is
    'Server-stamped time the row was first seen sent=true; immutable once set, NULL while unsent. The follow-feed''s reverse-chronological sort key (0018). Server-authoritative — client values are ignored (see set_first_sent_at).';

-- Backfill existing sent rows to a stable, sensible arrival stamp (updated_at). This MUST
-- precede the trigger below — with the trigger present, this UPDATE would re-stamp every
-- row to now(). We also suspend the 0002 updated_at trigger for the backfill so historical
-- rows don't all bump to now() (which would trigger a one-time full re-pull on every synced
-- device). first_sent_at is a fresh column; nothing has stamped it yet.
alter table public.ascents disable trigger ascents_set_updated_at;
update public.ascents
    set first_sent_at = updated_at
    where sent = true and first_sent_at is null;
alter table public.ascents enable trigger ascents_set_updated_at;

-- The stamp function. Server-authoritative: it derives first_sent_at from OLD/now() only and
-- OVERWRITES whatever the client sent on EVERY branch (mirrors set_updated_at, 0002). The
-- single assignment `coalesce(OLD.first_sent_at, case when NEW.sent then now() end)` means:
--   • INSERT sent   → coalesce(NULL, now())  = now()   (stamp arrival)
--   • INSERT unsent → coalesce(NULL, NULL)   = NULL     (client value discarded)
--   • UPDATE edit   → coalesce(OLD, ...)      = OLD      (never moves once set)
--   • UPDATE →unsent→ coalesce(OLD, NULL)     = OLD      (never moves once set)
--   • UPDATE →sent  → coalesce(NULL, now())   = now()    (false→true stamps arrival)
-- Crucially the client's NEW.first_sent_at is NEVER read, so a crafted client cannot insert
-- an unsent row with a future first_sent_at and have it survive the later sent-flip (which the
-- earlier `if NEW.sent`-only form allowed — it would pin a spoofed send atop every feed).
-- Pinned search_path (advisor hardening).
create or replace function public.set_first_sent_at()
    returns trigger
    language plpgsql
    set search_path = ''
as $$
begin
    new.first_sent_at := coalesce(old.first_sent_at, case when new.sent then now() end);
    return new;
end;
$$;

create trigger ascents_set_first_sent_at
    before insert or update on public.ascents
    for each row execute function public.set_first_sent_at();

-- Feed hot-path index. The follow feed (0018) orders live sends by (first_sent_at desc,
-- id desc) as a keyset over a set of followed actors. Partial — only live sends carry a
-- non-null first_sent_at — so the index stays small and the ORDER BY is index-only.
create index if not exists ascents_first_sent_idx
    on public.ascents (first_sent_at desc, id desc)
    where sent = true and deleted = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- follows: the edge. ASYMMETRIC — a row means follower_id follows followee_id, nothing about
-- the reverse. status is 'active' (public target, or an approved request) or 'pending' (an
-- unapproved request to a private target). PK (follower_id, followee_id) makes an edge unique
-- (R5); the self-follow CHECK blocks following yourself. NO INSERT / NO UPDATE policy: edges
-- are created only by request_follow() and their status flipped only by respond_to_follow()
-- (0018) — a private target must land pending, which the client can't be trusted to set.
create table if not exists public.follows (
    follower_id uuid        not null references auth.users (id) on delete cascade,
    followee_id uuid        not null references auth.users (id) on delete cascade,
    status      text        not null default 'active',
    created_at  timestamptz not null default now(),
    primary key (follower_id, followee_id),
    constraint follows_status_check   check (status in ('pending', 'active')),
    constraint follows_no_self_follow check (follower_id <> followee_id)
);

comment on table public.follows is
    'Asymmetric follow edges. status pending (unapproved request to a private account) or active. Edges created only via request_follow() (0018); no direct INSERT/UPDATE policy.';

-- Followers-of-X and pending-requests-to-X reads hit followee_id; filter by status too.
create index if not exists follows_followee_idx on public.follows (followee_id, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- blocks: a bidirectional cut. A row (blocker_id blocks blocked_id) hides each user from the
-- other across every social read (via is_blocked, applied in 0018). block_user() (0018) also
-- deletes any follow edges both ways in the same transaction. NO INSERT policy — block_user()
-- is the only writer (it must atomically delete edges); unblock is a direct DELETE (harmless).
create table if not exists public.blocks (
    blocker_id uuid        not null references auth.users (id) on delete cascade,
    blocked_id uuid        not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    constraint blocks_no_self_block check (blocker_id <> blocked_id)
);

comment on table public.blocks is
    'Directed block rows; is_blocked(a,b) treats them as bidirectional. Blocking removes follow edges both ways (block_user, 0018) and gates every social read (0018).';

create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- notifications: fire-and-forget events only. 'follow' (someone became an active follower)
-- and 'follow_accepted' (a private request you sent was approved). Follow REQUESTS are NOT
-- rows here — the requests inbox reads `follows WHERE followee=me AND status='pending'`, and
-- approve/decline mutates that edge (KTD7). Rows are inserted only by 0018's SECURITY DEFINER
-- RPCs (which create the edges), so creation is server-authoritative; NO client INSERT policy.
create table if not exists public.notifications (
    id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        not null references auth.users (id) on delete cascade,
    type       text        not null,
    actor_id   uuid        not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    read_at    timestamptz,
    constraint notifications_type_check check (type in ('follow', 'follow_accepted'))
);

comment on table public.notifications is
    'In-app fire-and-forget social notifications (new follower, request accepted). Inserted only by 0018 RPCs. Follow requests are sourced from follows.status=pending, not duplicated here.';

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers. is_blocked breaks the both-directions predicate out once so every 0018 read can
-- apply it uniformly; is_active_follower is the private-account gate. SECURITY DEFINER (they
-- read tables the caller may be RLS-restricted from), STABLE, pinned search_path — the
-- is_list_member idiom (0003). Defined AFTER their tables exist so the sql bodies validate.
create or replace function public.is_blocked(a uuid, b uuid)
    returns boolean
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select exists (
        select 1 from public.blocks
        where (blocker_id = a and blocked_id = b)
           or (blocker_id = b and blocked_id = a)
    );
$$;

revoke all on function public.is_blocked(uuid, uuid) from public;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;

create or replace function public.is_active_follower(f uuid, t uuid)
    returns boolean
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select exists (
        select 1 from public.follows
        where follower_id = f and followee_id = t and status = 'active'
    );
$$;

revoke all on function public.is_active_follower(uuid, uuid) from public;
grant execute on function public.is_active_follower(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security. Follows/blocks/notifications are all self-scoped: you read your own
-- edges (either side), your own blocks, your own notifications. Writes that need server logic
-- (create edge with correct pending/active status; block-with-edge-teardown; notification
-- creation) have NO client policy and go through 0018's RPCs.
alter table public.follows       enable row level security;
alter table public.blocks        enable row level security;
alter table public.notifications enable row level security;

-- follows: read edges you're either side of (your following list AND your followers/requests).
-- No INSERT (request_follow, 0018). No UPDATE (respond_to_follow, 0018). DELETE either side —
-- unfollow (you're the follower) or remove-follower (you're the followee). R4.
create policy "Read edges you are party to"
    on public.follows for select to authenticated
    using (follower_id = auth.uid() or followee_id = auth.uid());
create policy "Delete edges you are party to"
    on public.follows for delete to authenticated
    using (follower_id = auth.uid() or followee_id = auth.uid());

-- blocks: you see and remove your own block rows. No INSERT (block_user, 0018, must also tear
-- down edges atomically). DELETE = unblock (harmless on its own).
create policy "Read your own blocks"
    on public.blocks for select to authenticated
    using (blocker_id = auth.uid());
create policy "Delete your own blocks"
    on public.blocks for delete to authenticated
    using (blocker_id = auth.uid());

-- notifications: read your own; UPDATE your own (mark read — with check pins ownership so a
-- read can't reassign the row); DELETE your own (dismiss). No INSERT (0018 RPCs only).
create policy "Read your own notifications"
    on public.notifications for select to authenticated
    using (user_id = auth.uid());
create policy "Update your own notifications"
    on public.notifications for update to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Delete your own notifications"
    on public.notifications for delete to authenticated
    using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. public.delete_user() (0001) deletes auth.users for the
-- calling user; the ON DELETE CASCADE FKs above sweep their follows (both as follower and as
-- followee), their blocks (both sides), and their notifications (as recipient and as actor).
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project (SQL Editor →
-- paste + Run, or `supabase db push`), before 0018. See docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────

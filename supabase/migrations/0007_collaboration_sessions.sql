-- 0007_collaboration_sessions.sql
-- Collaboration sessions (cross-member ascent-status filtering): an ephemeral,
-- join-by-link grouping of climbers scoped to one board. Members filter their catalog
-- against each other's logbooks ("a project none of us has sent"). The session only
-- changes what the filters can target — everyone keeps their own device + catalog view.
--
-- Scope (this migration = the entire backend substrate): two tables — sessions,
-- session_members — plus the recursion-safe membership helper, an owner-seat trigger,
-- RLS, and all four RPCs (join_session_by_token, session_member_ascents,
-- session_invite_token, touch_session).
--
-- Design (see docs/plans/2026-07-07-002-feat-web-collab-sessions-plan.md):
--   • Dedicated tables, NOT a `kind` discriminator on lists (KTD-1) — keeps sessions out
--     of the Saved Lists UI/cache and lets the schema carry expires_at + session RPCs.
--   • Membership is the unit of sharing — join by an unguessable invite_token (share-link
--     / QR). Joining consents to sharing your sent/tried status for this board (R8).
--   • Cross-member reads (a member seeing another's sent/tried set) are NOT done by
--     relaxing RLS on `ascents` (0002) — that stays owner-only (R10). They go through the
--     minimal-projection SECURITY DEFINER RPC session_member_ascents(), which projects
--     status-only ({sent, attempted}) and never comments/dates/tries/grades/stars (R7).
--   • Liveness (KTD-6): a session is live iff `deleted = false AND expires_at > now()`.
--     CANONICAL EXPIRY WINDOW = 24 hours — this literal (`interval '24 hours'`) appears in
--     the table default and in each expiry-bumping RPC (create/join bump inline;
--     touch_session bumps for manual refresh + rename). Keep them identical: divergence
--     changes liveness semantics silently. expires_at bumps ONLY on explicit intent —
--     the projection RPC is a pure read and never bumps it, so the 24h privacy backstop
--     can actually fire once all members go quiet.
--
-- RLS: a member may read a session + its roster; a non-member sees nothing. session_members
-- has NO INSERT policy — joins go only through join_session_by_token() (the creator is
-- seated by the owner-seat trigger). Both tables FK to auth.users / sessions ON DELETE
-- CASCADE, so the existing public.delete_user() RPC (0001) sweeps them on account
-- deletion — no RPC change.
--
-- NOTE on statement order: the membership helper is a `language sql` function whose body
-- is validated at CREATE time (check_function_bodies), so the tables it queries MUST
-- exist first. Hence: tables → helper → owner-seat trigger → RLS policies → RPCs.

-- ─────────────────────────────────────────────────────────────────────────────
-- sessions: the container. One board per session (board_layout_id, resolved app-side via
-- Board.with(layoutId:), default 7 = Mini MoonBoard 2025). invite_token is the
-- unguessable share-link secret; join_session_by_token() trades it for membership. A
-- session is disposable but backed by a real (reusable) row so a crew can be re-opened.
create table if not exists public.sessions (
    id              uuid        primary key default gen_random_uuid(),
    owner_id        uuid        not null references auth.users (id) on delete cascade,
    name            text        not null default '',
    board_layout_id int         not null default 7,
    invite_token    uuid        not null unique default gen_random_uuid(),
    -- CANONICAL EXPIRY WINDOW (see header): keep identical to the RPC bumps below.
    expires_at      timestamptz not null default now() + interval '24 hours',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted         boolean     not null default false,

    -- Server-authoritative name cap (mirrors the client's MAX name length). The client
    -- also trims/caps, but this is the source of truth.
    constraint session_name_len check (char_length(name) <= 60)
);

comment on table public.sessions is
    'Collaboration session container (name + board + invite token + expiry). Owner-created; members join via invite_token. Live iff deleted=false AND expires_at>now(). Soft-deleted via `deleted`.';

create index if not exists sessions_owner_idx on public.sessions (owner_id);

create trigger sessions_set_updated_at
    before insert or update on public.sessions
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- session_members: who is in a session. Composite PK (session_id, user_id) — a user is in
-- a session at most once. Joining exposes this user's sent/tried set (that board) to
-- co-members via session_member_ascents(); deleting the row (leaving) revokes it. There is
-- NO direct INSERT policy: joins go through join_session_by_token(), and the creator is
-- seated by the trigger below — a not-yet-member can't see the session to insert anyway.
create table if not exists public.session_members (
    session_id uuid        not null references public.sessions (id) on delete cascade,
    user_id    uuid        not null references auth.users (id) on delete cascade,
    joined_at  timestamptz not null default now(),
    primary key (session_id, user_id)
);

comment on table public.session_members is
    'Membership of a collaboration session. Membership is the unit of sharing; leaving (row delete) revokes status exposure and read access.';

create index if not exists session_members_user_idx on public.session_members (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Membership helper. RLS on session_members that itself queried session_members would
-- recurse; a SECURITY DEFINER function runs as its owner (bypassing RLS on the inner
-- read), which breaks the cycle. Standard Supabase membership-policy pattern (mirrors
-- is_list_member in 0003). STABLE (no writes); pinned search_path (advisor hardening).
-- Defined AFTER session_members exists so its `language sql` body validates.
create or replace function public.is_session_member(s uuid, u uuid)
    returns boolean
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select exists (
        select 1 from public.session_members
        where session_id = s and user_id = u
    );
$$;

revoke all on function public.is_session_member(uuid, uuid) from public;
grant execute on function public.is_session_member(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seat the creator as the first member. SECURITY DEFINER so it can insert into
-- session_members regardless of that table's RLS (which has no member-facing INSERT
-- policy). Without this, the owner could not satisfy is_session_member() and would be
-- locked out of the session they just made.
create or replace function public.add_owner_as_session_member()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    insert into public.session_members (session_id, user_id)
    values (new.id, new.owner_id)
    on conflict do nothing;
    return new;
end;
$$;

create trigger sessions_add_owner_member
    after insert on public.sessions
    for each row execute function public.add_owner_as_session_member();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security. Membership (via is_session_member) is the gate; a non-member sees
-- zero rows. Mirrors the policy shape of 0003.
alter table public.sessions        enable row level security;
alter table public.session_members enable row level security;

-- sessions: a member (or the owner) may read; only the owner writes/renames/ends.
create policy "Members read their sessions"
    on public.sessions for select to authenticated
    using (owner_id = auth.uid() or public.is_session_member(id, auth.uid()));
create policy "Users create their own sessions"
    on public.sessions for insert to authenticated
    with check (owner_id = auth.uid());
create policy "Owners update their sessions"
    on public.sessions for update to authenticated
    using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owners delete their sessions"
    on public.sessions for delete to authenticated
    using (owner_id = auth.uid());

-- session_members: a member reads the roster of sessions they belong to. DELETE is either
-- self-leave (user_id = auth.uid()) OR the session owner removing another member (KTD-11).
-- No INSERT policy — joins go through join_session_by_token().
create policy "Members read the roster"
    on public.session_members for select to authenticated
    using (public.is_session_member(session_id, auth.uid()));
create policy "Members leave or owner removes a member"
    on public.session_members for delete to authenticated
    using (
        user_id = auth.uid()
        or exists (
            select 1 from public.sessions s
            where s.id = session_id and s.owner_id = auth.uid()
        )
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs. All SECURITY DEFINER with pinned search_path. `authenticated` gets execute; the
-- helper-gated membership check inside each is what actually authorizes the caller.

-- join_session_by_token: the ONLY sanctioned membership INSERT (KTD-3). Trades a live
-- token for membership, seats the caller, bumps expiry (explicit intent), and returns the
-- session row WITHOUT invite_token (the secret is fetched separately via
-- session_invite_token). Raises on an unknown / ended / expired token.
create or replace function public.join_session_by_token(token uuid)
    returns table (
        id              uuid,
        owner_id        uuid,
        name            text,
        board_layout_id int,
        expires_at      timestamptz,
        created_at      timestamptz,
        updated_at      timestamptz,
        deleted         boolean
    )
    language plpgsql
    security definer
    set search_path = ''
as $$
#variable_conflict use_column
declare
    v_session_id uuid;
begin
    select s.id into v_session_id
    from public.sessions s
    where s.invite_token = token
      and s.deleted = false
      and s.expires_at > now();

    if v_session_id is null then
        raise exception 'session not found, ended, or expired';
    end if;

    insert into public.session_members (session_id, user_id)
    values (v_session_id, auth.uid())
    on conflict do nothing;

    -- Explicit-intent expiry bump (CANONICAL EXPIRY WINDOW — see header). The liveness
    -- predicate is repeated in the WHERE so a session that went dead between the lookup
    -- above and this write cannot have its expiry revived (matches touch_session's guard).
    update public.sessions s
    set expires_at = now() + interval '24 hours'
    where s.id = v_session_id
      and s.deleted = false
      and s.expires_at > now();

    return query
    select s.id, s.owner_id, s.name, s.board_layout_id,
           s.expires_at, s.created_at, s.updated_at, s.deleted
    from public.sessions s
    where s.id = v_session_id;
end;
$$;

revoke all on function public.join_session_by_token(uuid) from public;
grant execute on function public.join_session_by_token(uuid) to authenticated;

-- session_member_ascents: the minimal-projection cross-member read (KTD-2, R7). Gated on
-- caller membership AND session liveness. Projects status-only ({sent, attempted}) for the
-- session's board — NEVER comment/date/tries/grade/stars. LEFT JOIN so every member yields
-- at least one row: a member with no matching ascents emits a single marker row
-- (user_id, NULL, NULL). That makes the result carry the full, server-consistent member
-- set in one call — the client seeds per-member Set-pairs from it (a just-departed member
-- is simply absent). PURE READ — no expiry bump (KTD-6).
create or replace function public.session_member_ascents(p_session_id uuid)
    returns table (
        user_id           uuid,
        source_catalog_id text,
        status            text
    )
    language plpgsql
    security definer
    set search_path = ''
    stable
as $$
#variable_conflict use_column
begin
    if not public.is_session_member(p_session_id, auth.uid()) then
        raise exception 'not a session member';
    end if;
    if not exists (
        select 1 from public.sessions s
        where s.id = p_session_id
          and s.deleted = false
          and s.expires_at > now()
    ) then
        raise exception 'session is not live';
    end if;

    return query
    select
        m.user_id,
        a.source_catalog_id,
        case
            when a.id is null then null
            when a.sent      then 'sent'
            else                  'attempted'
        end
    from public.session_members m
    join public.sessions s on s.id = m.session_id
    left join public.ascents a
        on  a.user_id           = m.user_id
        and a.board_layout_id   = s.board_layout_id
        and a.deleted           = false
        and a.source_catalog_id is not null
    where m.session_id = p_session_id;
end;
$$;

revoke all on function public.session_member_ascents(uuid) from public;
grant execute on function public.session_member_ascents(uuid) to authenticated;

-- touch_session: the sanctioned expiry-bump path for manual refresh + rename (KTD-6).
-- sessions RLS grants UPDATE to the owner only, so non-owner members cannot bump expiry
-- directly — they go through this member-gated DEFINER RPC or their activity would never
-- keep the session alive. Gated on membership AND liveness.
create or replace function public.touch_session(p_session_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if not public.is_session_member(p_session_id, auth.uid()) then
        raise exception 'not a session member';
    end if;

    -- CANONICAL EXPIRY WINDOW (see header). The liveness predicate is in the WHERE so a
    -- dead session cannot be revived.
    update public.sessions s
    set expires_at = now() + interval '24 hours'
    where s.id = p_session_id
      and s.deleted = false
      and s.expires_at > now();

    if not found then
        raise exception 'session is not live';
    end if;
end;
$$;

revoke all on function public.touch_session(uuid) from public;
grant execute on function public.touch_session(uuid) to authenticated;

-- session_invite_token: the sanctioned client path to the share secret (KTD-7). The token
-- never enters SESSION_COLUMNS or the client cache; a current member re-fetches it on
-- demand to build the share URL / QR. Membership-gated ONLY (no liveness check), so a
-- still-member can retrieve the token even for an ended session — harmless, because
-- join_session_by_token refuses the ended token anyway.
create or replace function public.session_invite_token(p_session_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    stable
as $$
declare
    v_token uuid;
begin
    if not public.is_session_member(p_session_id, auth.uid()) then
        raise exception 'not a session member';
    end if;

    select s.invite_token into v_token
    from public.sessions s
    where s.id = p_session_id;

    return v_token;
end;
$$;

revoke all on function public.session_invite_token(uuid) from public;
grant execute on function public.session_invite_token(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. public.delete_user() (0001) deletes auth.users for
-- the calling user; the ON DELETE CASCADE FKs above sweep their owned sessions (and those
-- sessions' members) and their own memberships.
--
-- Follow-up (deferred, per plan): a scheduled hard-delete sweep of expired sessions
-- (e.g. pg_cron). v1 makes expired sessions inert via the liveness guards in the RPCs;
-- physical cleanup is not required for correctness. invite_token rotation is also deferred.
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project
-- (SQL Editor → paste + Run, or `supabase db push`), and — because this is a
-- cross-user data path — verify it BEFORE deploying the client bundle that calls its RPCs.
-- See docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────

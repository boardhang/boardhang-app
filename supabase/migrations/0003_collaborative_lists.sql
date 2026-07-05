-- 0003_collaborative_lists.sql
-- Collaborative lists (Phase 3 of the social arc): a shared list = its people + a
-- shared pile of problems. A group climbing together uses it to find problems nobody
-- in the group has sent yet.
--
-- Scope (this migration = storage + RLS only; the join + group-status RPCs live in
-- 0004): three tables — lists, list_members, list_problems — plus the recursion-safe
-- membership helper the policies lean on, and a trigger that seats the creator as the
-- first member.
--
-- Design (see docs/plans/2026-07-03-002-feat-collaborative-lists-plan.md):
--   • Membership is the unit of sharing — no friend graph. Being a member of a list is
--     what grants read access to that list and (via 0004's RPC) to co-members' send
--     status. People join by an unguessable invite_token (share-link).
--   • Lists are cloud-only in v1 (no SwiftData mirror), so — unlike ascents/user_problems
--     — these tables are NOT part of the offline high-water-mark sync spine. They still
--     carry updated_at + a `deleted` tombstone for cheap read-through and soft removal.
--   • Cross-user reads (a member seeing another member's sent/tried set) are NOT done by
--     relaxing RLS on `ascents` — that would leak the whole logbook row. They go through
--     the minimal-projection SECURITY DEFINER RPC in 0004 instead. `ascents` RLS (0002)
--     is left untouched, owner-only.
--
-- RLS: a member may read a list, its members, and its problem pile; a non-member sees
-- nothing. All three tables FK to auth.users / lists ON DELETE CASCADE, so the existing
-- public.delete_user() RPC (0001) sweeps them on account deletion — no RPC change.
--
-- NOTE on statement order: the membership helper is a `language sql` function whose body
-- is validated at CREATE time (check_function_bodies), so the tables it queries MUST
-- exist first. Hence: tables → helper → owner-seat trigger → RLS policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- lists: the container. One board per list (board_layout_id, resolved app-side via
-- Board.with(layoutId:), default 7 = Mini MoonBoard 2025). invite_token is the
-- unguessable share-link secret; 0004's join_list_by_token() trades it for membership.
create table if not exists public.lists (
    id              uuid        primary key default gen_random_uuid(),
    owner_id        uuid        not null references auth.users (id) on delete cascade,
    name            text        not null default '',
    board_layout_id int         not null default 7,
    invite_token    uuid        not null unique default gen_random_uuid(),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    deleted         boolean     not null default false
);

comment on table public.lists is
    'Collaborative list container (name + board + invite token). Owner-created; members join via invite_token. Soft-deleted via `deleted`.';

create index if not exists lists_owner_idx on public.lists (owner_id);

create trigger lists_set_updated_at
    before insert or update on public.lists
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- list_members: who is in a list. Composite PK (list_id, user_id) — a user is in a
-- list at most once. Joining exposes this user's sent/tried set (that board) to
-- co-members via 0004's RPC; deleting the row (leaving) revokes it. There is NO direct
-- INSERT policy: joins go through join_list_by_token() (0004), and the creator is
-- seated by the trigger below — a not-yet-member can't see the list to insert anyway.
create table if not exists public.list_members (
    list_id   uuid        not null references public.lists (id) on delete cascade,
    user_id   uuid        not null references auth.users (id) on delete cascade,
    joined_at timestamptz not null default now(),
    primary key (list_id, user_id)
);

comment on table public.list_members is
    'Membership of a collaborative list. Membership is the unit of sharing; leaving (row delete) revokes exposure and read access.';

create index if not exists list_members_user_idx on public.list_members (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- list_problems: the shared pile. A catalog problem someone added to the list
-- (source_catalog_id resolves against the local bundle, like ascents). All members are
-- equal — any member adds/soft-removes. board_layout_id snapshots the list's board.
create table if not exists public.list_problems (
    id                uuid        primary key default gen_random_uuid(),
    list_id           uuid        not null references public.lists (id) on delete cascade,
    source_catalog_id text        not null,
    board_layout_id   int         not null default 7,
    added_by          uuid        references auth.users (id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    deleted           boolean     not null default false
);

comment on table public.list_problems is
    'Problems in a collaborative list''s shared pile. Any member may add; removal is a soft-delete (`deleted`).';

create index if not exists list_problems_list_idx on public.list_problems (list_id);

-- A catalog problem appears at most once (live) per list.
create unique index if not exists list_problems_list_catalog_key
    on public.list_problems (list_id, source_catalog_id)
    where deleted = false;

create trigger list_problems_set_updated_at
    before insert or update on public.list_problems
    for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Membership helper. RLS on list_members that itself queried list_members would
-- recurse; a SECURITY DEFINER function runs as its owner (bypassing RLS on the inner
-- read), which breaks the cycle. This is the standard Supabase pattern for
-- membership-scoped policies. STABLE (no writes); pinned search_path (advisor
-- hardening). The policies below all route co-membership checks through this. Defined
-- AFTER list_members exists so its `language sql` body validates.
create or replace function public.is_list_member(l uuid, u uuid)
    returns boolean
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select exists (
        select 1 from public.list_members
        where list_id = l and user_id = u
    );
$$;

revoke all on function public.is_list_member(uuid, uuid) from public;
grant execute on function public.is_list_member(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seat the creator as the first member. SECURITY DEFINER so it can insert into
-- list_members regardless of that table's RLS (which has no member-facing INSERT
-- policy). Without this, the owner could not satisfy is_list_member() and would be
-- locked out of the list they just made.
create or replace function public.add_owner_as_member()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    insert into public.list_members (list_id, user_id)
    values (new.id, new.owner_id)
    on conflict do nothing;
    return new;
end;
$$;

create trigger lists_add_owner_member
    after insert on public.lists
    for each row execute function public.add_owner_as_member();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-Level Security. Membership (via is_list_member) is the gate on all three tables;
-- a non-member sees zero rows. Mirrors the policy-quartet shape of 0001/0002.
alter table public.lists         enable row level security;
alter table public.list_members  enable row level security;
alter table public.list_problems enable row level security;

-- lists: a member (or the owner) may read; only the owner writes/renames/deletes.
create policy "Members read their lists"
    on public.lists for select to authenticated
    using (owner_id = auth.uid() or public.is_list_member(id, auth.uid()));
create policy "Users create their own lists"
    on public.lists for insert to authenticated
    with check (owner_id = auth.uid());
create policy "Owners update their lists"
    on public.lists for update to authenticated
    using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Owners delete their lists"
    on public.lists for delete to authenticated
    using (owner_id = auth.uid());

-- list_members: a member reads the roster of lists they belong to; a user may delete
-- only their own membership (leave). No INSERT policy — see join_list_by_token (0004).
create policy "Members read the roster"
    on public.list_members for select to authenticated
    using (public.is_list_member(list_id, auth.uid()));
create policy "Users leave lists they are in"
    on public.list_members for delete to authenticated
    using (user_id = auth.uid());

-- list_problems: any member reads and edits the pile (all members equal). Insert is
-- attributed to the caller; removal is a soft-delete via update.
create policy "Members read the pile"
    on public.list_problems for select to authenticated
    using (public.is_list_member(list_id, auth.uid()));
create policy "Members add to the pile"
    on public.list_problems for insert to authenticated
    with check (public.is_list_member(list_id, auth.uid()) and added_by = auth.uid());
create policy "Members edit the pile"
    on public.list_problems for update to authenticated
    using (public.is_list_member(list_id, auth.uid()))
    with check (public.is_list_member(list_id, auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change needed. public.delete_user() (0001) deletes auth.users
-- for the calling user; the ON DELETE CASCADE FKs above sweep their owned lists (and
-- those lists' members + problems) and their own memberships. added_by is SET NULL so a
-- pile entry survives its adder's deletion as an attribution-less row.
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project
-- (SQL Editor → paste + Run, or `supabase db push`), before 0004. See
-- docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────

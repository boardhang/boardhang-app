-- 0018_social_rpcs.sql
-- Friends / follow feed — the RPC layer over 0017's storage (mirrors the 0003→0004
-- storage-then-RPC split). Every cross-user read of owner-only `ascents` (0002) goes through
-- a minimal-projection SECURITY DEFINER core here; `ascents` RLS stays owner-only, untouched.
--
-- Contents:
--   • Follow lifecycle: request_follow, respond_to_follow, unfollow, remove_follower.
--   • Block: block_user (tears down edges + cross-pair notifications, then blocks), unblock_user.
--   • Discovery: search_profiles, suggest_co_members.
--   • Reads: get_profile_card, get_follow_counts, get_follow_list, get_user_sends,
--     get_notifications; the internal _sends_for_actors projection core.
--   • Notifications: mark_notifications_read.
--
-- Load-bearing invariants (see docs/plans/2026-07-20-001-feat-web-friends-feed-plan.md):
--   • KTD4: _sends_for_actors carries NO gate, so it is REVOKEd from every client role and
--     only the two SECURITY-DEFINER wrappers (same owner) may call it. "Internal" ≠ access
--     control; the revoke is.
--   • KTD5: is_blocked (either direction) is applied in EVERY social read — card, sends, feed,
--     search, follower/following lists, notifications.
--   • KTD9a: an account with privacy_choice_at IS NULL is private-until-chosen. Gates key on
--     *effective privacy* = is_private OR privacy_choice_at IS NULL, so an existing user is
--     never silently followable before their one-time notice.
--
-- Conventions: all functions SECURITY DEFINER + `set search_path = ''` (so every reference is
-- schema-qualified) + `revoke all from public; grant execute to authenticated` (0004 idiom),
-- EXCEPT _sends_for_actors which is granted to no client role. `handle` is returned as text —
-- the citext type is not resolvable under an empty search_path, and text is what the client
-- wants anyway; case-insensitive matching uses ilike on the ::text form.

-- ─────────────────────────────────────────────────────────────────────────────
-- Effective-privacy helper (KTD9a). An account is treated as private when it is is_private OR
-- has not yet made the explicit public/private choice (privacy_choice_at IS NULL). STABLE;
-- profiles is world-readable (0001) so this needs no elevated read, but SECURITY DEFINER +
-- pinned search_path keeps it uniform with the other helpers.
create or replace function public.is_effectively_private(u uuid)
    returns boolean
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select coalesce(
        (select p.is_private or p.privacy_choice_at is null
         from public.profiles p where p.id = u),
        true)  -- no profile row → treat as private (fail closed)
$$;

revoke all on function public.is_effectively_private(uuid) from public;
grant execute on function public.is_effectively_private(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Follow lifecycle.

-- request_follow: the ONLY writer of a follow edge (0017 has no INSERT policy). Sets
-- pending vs active from the target's EFFECTIVE privacy — the client never chooses. Rejects
-- self-follow and a blocked pair (either direction). Lands a `follow` notification only when
-- the edge is newly created AND active (a public / already-chosen target). Idempotent:
-- re-requesting returns the existing edge without a duplicate row or notification.
create or replace function public.request_follow(p_target uuid)
    returns public.follows
    language plpgsql
    security definer
    set search_path = ''
as $$
declare _edge public.follows;
begin
    if p_target = auth.uid() then
        raise exception 'cannot follow yourself';
    end if;
    if public.is_blocked(auth.uid(), p_target) then
        raise exception 'cannot follow a blocked user';
    end if;

    -- Conditional INSERT ... SELECT (not VALUES): the WHERE re-checks is_blocked at insert time.
    -- The explicit check above gives a clear error on the common already-blocked case; this
    -- re-check narrows the TOCTOU where a concurrent block_user commits between that check and
    -- this insert — without it, the block would land and this insert would still create an orphan
    -- follow edge coexisting with the block. No sends leak either way (every sends read re-gates
    -- on is_blocked); this keeps the follow graph itself consistent with the block.
    insert into public.follows (follower_id, followee_id, status)
    select auth.uid(), p_target,
           case when public.is_effectively_private(p_target) then 'pending' else 'active' end
    where not public.is_blocked(auth.uid(), p_target)
    on conflict (follower_id, followee_id) do nothing
    returning * into _edge;

    if found then
        -- Newly created. Notify the followee only when the follow is immediately active — and
        -- only if they don't already have an UNREAD 'follow' notification from this actor. That
        -- de-dup makes a follow → unfollow → re-follow loop produce at most one unread follow
        -- notification per (actor, target) pair (each cycle re-creates the edge and would
        -- otherwise fire a fresh notification), while still allowing a genuine later re-follow to
        -- notify once the followee has seen the previous one.
        if _edge.status = 'active' then
            insert into public.notifications (user_id, type, actor_id)
            select p_target, 'follow', auth.uid()
            where not exists (
                select 1 from public.notifications
                where user_id = p_target and actor_id = auth.uid()
                  and type = 'follow' and read_at is null
            );
        end if;
        return _edge;
    end if;

    -- Already existed (idempotent) — return the current edge.
    select * into _edge from public.follows
        where follower_id = auth.uid() and followee_id = p_target;
    return _edge;
end;
$$;

revoke all on function public.request_follow(uuid) from public;
grant execute on function public.request_follow(uuid) to authenticated;

-- respond_to_follow: the followee approves/declines a PENDING request. Only auth.uid() as the
-- followee, only a pending edge. Accept → active + a `follow_accepted` notification to the
-- requester; decline → delete the edge. No-op if there is no matching pending edge.
create or replace function public.respond_to_follow(p_follower uuid, p_accept boolean)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if p_accept then
        update public.follows set status = 'active'
            where follower_id = p_follower and followee_id = auth.uid() and status = 'pending';
        if found then
            insert into public.notifications (user_id, type, actor_id)
            values (p_follower, 'follow_accepted', auth.uid());
        end if;
    else
        delete from public.follows
            where follower_id = p_follower and followee_id = auth.uid() and status = 'pending';
    end if;
end;
$$;

revoke all on function public.respond_to_follow(uuid, boolean) from public;
grant execute on function public.respond_to_follow(uuid, boolean) to authenticated;

-- unfollow: the follower removes their own outgoing edge (active OR pending — cancels a
-- request). remove_follower: the followee removes an incoming edge. Both are also expressible
-- via 0017's DELETE policy; the RPCs keep the client surface uniform.
create or replace function public.unfollow(p_target uuid)
    returns void
    language sql
    security definer
    set search_path = ''
as $$
    delete from public.follows where follower_id = auth.uid() and followee_id = p_target;
$$;

revoke all on function public.unfollow(uuid) from public;
grant execute on function public.unfollow(uuid) to authenticated;

create or replace function public.remove_follower(p_follower uuid)
    returns void
    language sql
    security definer
    set search_path = ''
as $$
    delete from public.follows where follower_id = p_follower and followee_id = auth.uid();
$$;

revoke all on function public.remove_follower(uuid) from public;
grant execute on function public.remove_follower(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Block. block_user is the only writer of a block row (0017 has no INSERT policy). In one
-- transaction it deletes follow edges BOTH ways, purges cross-pair notifications BOTH ways
-- (so a stale "new follower" row can't keep rendering a now-blocked user's card), then inserts
-- the block. unblock_user removes the block row (also expressible via 0017's DELETE policy).
create or replace function public.block_user(p_target uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if p_target = auth.uid() then
        raise exception 'cannot block yourself';
    end if;

    delete from public.follows
        where (follower_id = auth.uid() and followee_id = p_target)
           or (follower_id = p_target and followee_id = auth.uid());

    delete from public.notifications
        where (user_id = auth.uid() and actor_id = p_target)
           or (user_id = p_target and actor_id = auth.uid());

    insert into public.blocks (blocker_id, blocked_id)
    values (auth.uid(), p_target)
    on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

revoke all on function public.block_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_target uuid)
    returns void
    language sql
    security definer
    set search_path = ''
as $$
    delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_target;
$$;

revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Profile card (KTD6). Block-aware handle→card read (the /u/:handle screen has a handle, not
-- an id): empty for a blocked pair (R11/R12), so a blocked viewer sees an "unavailable"
-- profile. The R7 card exemption (a private account's card stays visible to non-followers) is
-- NOT extended to blocked users — hence this gate. Match is case-insensitive via lower() on the
-- ::text form (handle is citext, but its operators aren't resolvable under an empty search_path).
--
-- SECURITY BOUNDARY (accepted v1 limitation): this gate is UI-deep, not a hard access boundary.
-- `profiles` is world-readable to any authenticated user (0001 SELECT `using (true)`), which
-- AuthProvider and the session-member UI read directly, so a determined client can bypass this
-- RPC and read a blocked user's handle/display_name/is_private straight from the table (and page
-- the whole profile list, sidestepping search_profiles' anti-scrape floor). We accept this for
-- v1: profile handle/display_name are low-sensitivity in a signed-in app, and the REAL privacy
-- boundary is the SENDS/activity gate (the revoked _sends_for_actors core + is_blocked in every
-- sends read), which is hard-enforced and cannot be bypassed this way. Narrowing the `profiles`
-- policy (and routing session-member + card reads through gated RPCs) is a tracked follow-up.
create or replace function public.get_profile_card(p_handle text)
    returns table (id uuid, handle text, display_name text, avatar_url text, is_private boolean)
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    return query
        select p.id, p.handle::text, p.display_name, p.avatar_url, p.is_private
        from public.profiles p
        where lower(p.handle::text) = lower(trim(p_handle))
          and not public.is_blocked(auth.uid(), p.id);  -- blocked pair → empty (absent profile)
end;
$$;

revoke all on function public.get_profile_card(text) from public;
grant execute on function public.get_profile_card(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Discovery.

-- search_profiles (KTD8): prefix match on handle/display_name, min length 2 (anti-scraping
-- floor), block-filtered both ways, excludes self, hard-capped. Returns the card plus the
-- caller's current edge status toward each result (null | 'pending' | 'active') so the client
-- renders the right relationship button. ilike on the ::text form keeps case-insensitive
-- matching without depending on citext operators being visible under an empty search_path.
create or replace function public.search_profiles(p_q text, p_limit int default 20)
    returns table (id uuid, handle text, display_name text, avatar_url text,
                   is_private boolean, edge_status text)
    language plpgsql
    security definer
    set search_path = ''
as $$
declare _prefix text;
begin
    if length(trim(p_q)) < 2 then
        return;  -- below the minimum: no query, no enumeration
    end if;
    -- Escape LIKE metacharacters so the query is a literal PREFIX, not a pattern. Without this,
    -- `__` (underscores, which pass the length floor) becomes the wildcard pattern `__%` and
    -- matches every profile of length >= 2 — defeating the prefix/anti-scrape intent. Escape the
    -- escape char first, then the wildcards, and match with an explicit ESCAPE '\'.
    _prefix := replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    return query
        select p.id, p.handle::text, p.display_name, p.avatar_url, p.is_private, f.status
        from public.profiles p
        left join public.follows f
               on f.follower_id = auth.uid() and f.followee_id = p.id
        where p.id <> auth.uid()
          and not public.is_blocked(auth.uid(), p.id)
          and (p.handle::text ilike _prefix escape '\'
               or p.display_name ilike _prefix escape '\')
        order by p.handle::text
        limit least(greatest(p_limit, 1), 50);
end;
$$;

revoke all on function public.search_profiles(text, int) from public;
grant execute on function public.search_profiles(text, int) to authenticated;

-- suggest_co_members (KTD8a): people the caller already shares a collaborative list (0003) or
-- session (0007) with — the warm graph already in the DB. Excludes self, already-followed, and
-- blocked. No contact import, no friend-of-friend (both deferred).
create or replace function public.suggest_co_members(p_limit int default 20)
    returns table (id uuid, handle text, display_name text, avatar_url text, is_private boolean)
    language sql
    security definer
    set search_path = ''
as $$
    select distinct p.id, p.handle::text, p.display_name, p.avatar_url, p.is_private
    from public.profiles p
    where p.id <> auth.uid()
      and not public.is_blocked(auth.uid(), p.id)
      and not exists (
          select 1 from public.follows
          where follower_id = auth.uid() and followee_id = p.id)
      and (
          p.id in (
              select lm2.user_id from public.list_members lm2
              where lm2.list_id in (
                  select lm1.list_id from public.list_members lm1 where lm1.user_id = auth.uid()))
          or
          p.id in (
              select sm2.user_id from public.session_members sm2
              where sm2.session_id in (
                  select sm1.session_id from public.session_members sm1 where sm1.user_id = auth.uid()))
      )
    limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.suggest_co_members(int) from public;
grant execute on function public.suggest_co_members(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Follower/following lists + counts (KTD5). `follows` SELECT RLS only returns edges the
-- caller is party to, so rendering ANOTHER user's followers/following/counts needs an RPC.
-- Gate: blocked pair → empty; a private target's lists are visible only to an active follower
-- (or self). A shared internal predicate keeps the gate identical across counts and lists.
create or replace function public.can_view_social_graph(p_target uuid)
    returns boolean
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select not public.is_blocked(auth.uid(), p_target)
       and (p_target = auth.uid()
            or not public.is_effectively_private(p_target)
            or public.is_active_follower(auth.uid(), p_target));
$$;

revoke all on function public.can_view_social_graph(uuid) from public;
grant execute on function public.can_view_social_graph(uuid) to authenticated;

create or replace function public.get_follow_counts(p_target uuid)
    returns table (followers bigint, following bigint)
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if not public.can_view_social_graph(p_target) then
        return;  -- gated: no counts
    end if;
    -- Exclude the viewer's blocked pairs from the counts so they agree with get_follow_list
    -- (which drops blocked users per row). Without this, counts and the rendered list disagree by
    -- exactly the blocked/orphan edges.
    return query
        select (select count(*) from public.follows f
                    where f.followee_id = p_target and f.status = 'active'
                      and not public.is_blocked(auth.uid(), f.follower_id)),
               (select count(*) from public.follows f
                    where f.follower_id = p_target and f.status = 'active'
                      and not public.is_blocked(auth.uid(), f.followee_id));
end;
$$;

revoke all on function public.get_follow_counts(uuid) from public;
grant execute on function public.get_follow_counts(uuid) to authenticated;

-- p_kind: 'followers' (people following the target) or 'following' (people the target follows).
create or replace function public.get_follow_list(p_target uuid, p_kind text, p_limit int default 50)
    returns table (id uuid, handle text, display_name text, avatar_url text, is_private boolean)
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if not public.can_view_social_graph(p_target) then
        return;  -- gated
    end if;
    return query
        select p.id, p.handle::text, p.display_name, p.avatar_url, p.is_private
        from public.follows f
        join public.profiles p
          on p.id = case when p_kind = 'followers' then f.follower_id else f.followee_id end
        where f.status = 'active'
          and (case when p_kind = 'followers' then f.followee_id else f.follower_id end) = p_target
          and not public.is_blocked(auth.uid(), p.id)
        order by p.handle::text
        limit least(greatest(p_limit, 1), 100);
end;
$$;

revoke all on function public.get_follow_list(uuid, text, int) from public;
grant execute on function public.get_follow_list(uuid, text, int) to authenticated;

-- get_follow_requests: the pending-request inbox (R24) — requesters' cards for edges pending
-- toward the caller. Sourced from `follows` (status='pending'), NOT from notifications (KTD7):
-- respond_to_follow mutates the edge, so the request list is the edge itself. Block-filtered.
create or replace function public.get_follow_requests(p_limit int default 50)
    returns table (id uuid, handle text, display_name text, avatar_url text,
                   is_private boolean, requested_at timestamptz)
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select p.id, p.handle::text, p.display_name, p.avatar_url, p.is_private, f.created_at
    from public.follows f
    join public.profiles p on p.id = f.follower_id
    where f.followee_id = auth.uid()
      and f.status = 'pending'
      and not public.is_blocked(auth.uid(), p.id)
    order by f.created_at desc
    limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.get_follow_requests(int) from public;
grant execute on function public.get_follow_requests(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The sends projection core (KTD4) + its two wrappers.
--
-- _sends_for_actors carries NO block/privacy gate — it just projects + keysets. It is the
-- single most load-bearing invariant of the feature, so it is granted to NO client role: a
-- direct client call with an arbitrary actor set would read anyone's private/blocked sends.
-- Only the two SECURITY-DEFINER wrappers below (same owner) invoke it, after applying the gate.
-- The projection deliberately omits comment/voted_grade/stars/updated_at/sent/deleted — a full
-- ascents row is never returned. `tries` IS included: it drives the profile grade pyramid's
-- try-bucket split (flash/2nd/3rd/4+), the same chart the owner sees on their own logbook.
create or replace function public._sends_for_actors(
        p_actor_ids uuid[],
        p_limit int,
        p_before_first_sent timestamptz,
        p_before_id uuid)
    returns table (ascent_id uuid, actor_id uuid, handle text, display_name text, avatar_url text,
                   source_catalog_id text, user_problem_id uuid, problem_name text,
                   problem_grade text, board_layout_id int, climbed_at timestamptz,
                   first_sent_at timestamptz, tries int)
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select a.id, a.user_id, p.handle::text, p.display_name, p.avatar_url,
           a.source_catalog_id, a.user_problem_id, a.problem_name,
           a.problem_grade, a.board_layout_id, a.date, a.first_sent_at, a.tries
    from public.ascents a
    join public.profiles p on p.id = a.user_id
    where a.user_id = any(p_actor_ids)
      and a.sent = true and a.deleted = false and a.first_sent_at is not null
      and (p_before_first_sent is null
           or (a.first_sent_at, a.id) < (p_before_first_sent, p_before_id))
    order by a.first_sent_at desc, a.id desc
    limit least(greatest(p_limit, 1), 100);
$$;

-- No grant to any client role — see the KTD4 note above. Revoke from public AND from anon /
-- authenticated / service_role explicitly: Supabase's default privileges grant EXECUTE on new
-- public functions to those roles directly, and `revoke ... from public` does NOT remove an
-- explicit role grant — so revoking only public would leave the core client-callable (a full
-- gate bypass: any client could POST /rest/v1/rpc/_sends_for_actors with an arbitrary actor
-- array and read anyone's sends). Only the two same-owner SECURITY DEFINER wrappers below may
-- call it.
revoke all on function public._sends_for_actors(uuid[], int, timestamptz, uuid)
    from public, anon, authenticated, service_role;

-- get_user_sends: a single actor after the R6/R12 gate — blocked → empty; effectively-private
-- and neither self nor an active follower → empty.
create or replace function public.get_user_sends(
        p_target uuid,
        p_limit int default 30,
        p_before_first_sent timestamptz default null,
        p_before_id uuid default null)
    returns table (ascent_id uuid, actor_id uuid, handle text, display_name text, avatar_url text,
                   source_catalog_id text, user_problem_id uuid, problem_name text,
                   problem_grade text, board_layout_id int, climbed_at timestamptz,
                   first_sent_at timestamptz, tries int)
    language plpgsql
    security definer
    set search_path = ''
    stable
as $$
begin
    if public.is_blocked(auth.uid(), p_target) then
        return;
    end if;
    if p_target <> auth.uid()
       and public.is_effectively_private(p_target)
       and not public.is_active_follower(auth.uid(), p_target) then
        return;
    end if;
    return query
        select * from public._sends_for_actors(
            array[p_target], p_limit, p_before_first_sent, p_before_id);
end;
$$;

revoke all on function public.get_user_sends(uuid, int, timestamptz, uuid) from public;
grant execute on function public.get_user_sends(uuid, int, timestamptz, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notifications. get_notifications is block-aware (a stale row whose actor is now blocked is
-- filtered — belt-and-suspenders with block_user's purge). mark_notifications_read stamps
-- read_at on the caller's own unread rows.
create or replace function public.get_notifications(p_limit int default 50)
    returns table (id uuid, type text, actor_id uuid, handle text, display_name text,
                   avatar_url text, created_at timestamptz, read_at timestamptz)
    language sql
    security definer
    set search_path = ''
    stable
as $$
    select n.id, n.type, n.actor_id, p.handle::text, p.display_name, p.avatar_url,
           n.created_at, n.read_at
    from public.notifications n
    join public.profiles p on p.id = n.actor_id
    where n.user_id = auth.uid()
      and not public.is_blocked(auth.uid(), n.actor_id)
    order by n.created_at desc
    limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.get_notifications(int) from public;
grant execute on function public.get_notifications(int) to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[])
    returns void
    language sql
    security definer
    set search_path = ''
as $$
    update public.notifications set read_at = now()
        where user_id = auth.uid() and id = any(p_ids) and read_at is null;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Account deletion: no change. These are functions only; the 0017 tables they write carry the
-- ON DELETE CASCADE FKs that public.delete_user() (0001) relies on.
--
-- Manual step (no SQL equivalent): apply this migration to the Supabase project after 0017.
-- ─────────────────────────────────────────────────────────────────────────────

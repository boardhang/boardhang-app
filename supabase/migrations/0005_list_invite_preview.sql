-- 0005_list_invite_preview.sql
-- Consent gate for share-link joins. Lets an invited (not-yet-member) user see WHAT
-- they're about to join — the list's name and who invited them — BEFORE joining, so the
-- app can show a confirmation prompt instead of silently adding them (and silently
-- exposing their sent/tried sets) on a single deep-link tap.
--
-- Read-only: it resolves a valid invite_token to the list's name + owner handle and
-- changes no membership. SECURITY DEFINER because a not-yet-member cannot read the list
-- under RLS. It reveals nothing the caller wouldn't see on joining anyway, and only for a
-- valid token (the token is the bearer secret); an unknown/expired token returns no rows,
-- so the app simply ignores a bad link.

create or replace function public.preview_list_by_token(p_token uuid)
    returns table (list_id uuid, name text, owner_handle text)
    language plpgsql
    security definer
    set search_path = ''
    stable
as $$
begin
    return query
    select l.id, l.name, p.handle::text
    from public.lists l
    join public.profiles p on p.id = l.owner_id
    where l.invite_token = p_token and l.deleted = false;
end;
$$;

revoke all on function public.preview_list_by_token(uuid) from public;
grant execute on function public.preview_list_by_token(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Manual step (no SQL equivalent): apply this migration after 0004 (SQL Editor →
-- paste + Run, or `supabase db push`). See docs/social-accounts-login-SETUP.md.
-- ─────────────────────────────────────────────────────────────────────────────

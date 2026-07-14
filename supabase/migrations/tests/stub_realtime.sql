-- Minimal Supabase `realtime`-schema stub so 0012's broadcast fan-out + private-channel
-- authorization can be exercised on a throwaway vanilla Postgres (no local Supabase stack —
-- see memory supabase-migration-local-testing). Reproduces just enough of Supabase's Realtime
-- Authorization surface for the migration to apply and for its policy predicate to run:
--   • realtime.messages — the table Realtime Authorization RLS is attached to. Real Supabase
--     ships this with RLS already enabled; we mirror that so 0012's SELECT policy is genuinely
--     exercised (a member sees rows, a non-member is filtered out).
--   • realtime.topic() — reads a session GUC the test sets per subscribed channel, exactly the
--     way stub_supabase.sql's auth.uid() reads test.uid. In real Supabase it returns the topic
--     of the channel being authorized.
--   • realtime.send() — real Supabase inserts a broadcast row into realtime.messages and the
--     Realtime server relays it to subscribers. The stub records the SAME row so trigger tests
--     can assert which topic/event/payload/private the fan-out emitted.
-- RLS semantics are standard Postgres, so a stub with the SAME policy predicate genuinely
-- exercises it. Final fidelity (that Supabase evaluates this policy on receive, and that
-- realtime.send relays) still requires applying to real Supabase — see 0012's manual step.

create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated;

-- The Realtime Authorization table. Columns pared to what 0012 touches: `extension` marks the
-- message kind ('broadcast'), and the policy reads realtime.topic() (not these columns) for the
-- membership check. RLS enabled to match real Supabase, where it ships enabled.
create table if not exists realtime.messages (
    id          bigint generated always as identity primary key,
    topic       text,
    event       text,
    payload     jsonb,
    private      boolean     not null default false,
    extension   text,
    inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to anon, authenticated;

-- realtime.topic(): the topic of the channel being authorized. Stub reads a per-test GUC.
create or replace function realtime.topic() returns text
    language sql stable
as $$ select nullif(current_setting('realtime.topic', true), '') $$;

-- realtime.send(): Supabase's DB→Realtime broadcast entrypoint. SECURITY DEFINER so it inserts
-- into realtime.messages regardless of the caller's role/RLS (mirrors Supabase, where the
-- publishing path is privileged). The recorded row is what the trigger tests inspect.
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
    returns void
    language sql
    security definer
as $$
    insert into realtime.messages (topic, event, payload, private, extension)
    values (topic, event, payload, private, 'broadcast');
$$;

-- Background agent runtime: enabled state, run ledger, notifications, and per-agent memory.
-- Apply after 202609150002_agents.sql. Server role only; no browser grants.

-- 1. Enabled state lives in a column so the cron can query it and Postgres can enforce the cap.
alter table public.socialtrading_agents
  add column if not exists enabled boolean not null default false,
  add column if not exists memory jsonb not null default '{}'::jsonb;

create or replace function public.socialtrading_agents_enabled_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.enabled then
    -- Serialize enable attempts per user so two concurrent toggles cannot both pass the count.
    perform pg_advisory_xact_lock(hashtext('socialtrading_agents_enabled:' || new.user_id));
    if (select count(*) from socialtrading_agents where user_id = new.user_id and enabled and agent_id <> new.agent_id) >= 2 then
      raise exception 'AGENT_LIMIT' using errcode = 'P0001', hint = 'At most two agents per user can be enabled.';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists socialtrading_agents_enabled_limit on public.socialtrading_agents;
create trigger socialtrading_agents_enabled_limit
  before insert or update of enabled on public.socialtrading_agents
  for each row execute function public.socialtrading_agents_enabled_limit();

-- Returns true when the change applied, false when the two-agent cap blocked it, null when the agent is missing.
create or replace function public.socialtrading_agent_set_enabled(p_user_id text, p_agent_id text, p_enabled boolean)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update socialtrading_agents set enabled = p_enabled, updated_at = now(),
    state = case when state ? 'agent' then jsonb_set(state, '{agent,enabled}', to_jsonb(p_enabled)) else state end
    where user_id = p_user_id and agent_id = p_agent_id;
  if not found then return null; end if;
  return true;
exception when sqlstate 'P0001' then
  return false;
end; $$;
revoke all on function public.socialtrading_agent_set_enabled(text, text, boolean) from public, anon, authenticated;
grant execute on function public.socialtrading_agent_set_enabled(text, text, boolean) to service_role;

-- The compare-and-swap save keeps the JSON mirror of `enabled` equal to the column.
create or replace function public.socialtrading_agent_save(p_user_id text, p_agent_id text, p_revision integer, p_state jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_state jsonb; v_enabled boolean;
begin
  select enabled into v_enabled from socialtrading_agents where user_id = p_user_id and agent_id = p_agent_id and revision = p_revision for update;
  if not found then return false; end if;
  v_state := jsonb_set(p_state, '{revision}', to_jsonb(p_revision + 1));
  if v_state ? 'agent' then v_state := jsonb_set(v_state, '{agent,enabled}', to_jsonb(v_enabled)); end if;
  update socialtrading_agents set state = v_state, revision = p_revision + 1, updated_at = now()
    where user_id = p_user_id and agent_id = p_agent_id and revision = p_revision;
  insert into socialtrading_agent_versions(user_id, agent_id, revision, state) values (p_user_id, p_agent_id, p_revision + 1, v_state);
  return true;
end; $$;

-- Deleting an agent removes its versions, runs, and notifications.
alter table public.socialtrading_agent_versions drop constraint if exists socialtrading_agent_versions_user_id_agent_id_fkey;
alter table public.socialtrading_agent_versions
  add constraint socialtrading_agent_versions_user_id_agent_id_fkey
  foreign key (user_id, agent_id) references public.socialtrading_agents(user_id, agent_id) on delete cascade;

-- 2. Run ledger. One row per wake-up, whatever triggered it.
create table if not exists public.socialtrading_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  agent_id text not null,
  trigger text not null check (trigger in ('cron', 'manual', 'chat', 'event')),
  -- Idempotency key for scheduled runs, e.g. the 30-minute slot start. Null for ad-hoc triggers.
  slot text,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_until timestamptz,
  summary text,
  decision jsonb,
  error text,
  notified boolean not null default false,
  foreign key (user_id, agent_id) references public.socialtrading_agents(user_id, agent_id) on delete cascade
);
create index if not exists socialtrading_agent_runs_recent on public.socialtrading_agent_runs(user_id, agent_id, started_at desc);
-- A scheduled slot runs at most once per agent, so re-invoking the cron is safe.
create unique index if not exists socialtrading_agent_runs_slot on public.socialtrading_agent_runs(user_id, agent_id, slot) where slot is not null;
-- Never two concurrent runs of the same agent.
create unique index if not exists socialtrading_agent_runs_active on public.socialtrading_agent_runs(user_id, agent_id) where status = 'running';

-- Claims a run atomically. Expired leases from crashed runs are failed first. Returns the run id, or null when
-- the agent is already running or the slot already ran.
create or replace function public.socialtrading_agent_run_claim(p_user_id text, p_agent_id text, p_trigger text, p_slot text, p_lease_seconds integer)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  update socialtrading_agent_runs set status = 'failed', finished_at = now(), error = 'Lease expired before the run finished.'
    where user_id = p_user_id and agent_id = p_agent_id and status = 'running' and lease_until is not null and lease_until < now();
  insert into socialtrading_agent_runs(user_id, agent_id, trigger, slot, status, lease_until)
    values (p_user_id, p_agent_id, p_trigger, p_slot, 'running', now() + make_interval(secs => p_lease_seconds))
    returning id into v_id;
  return v_id;
exception when unique_violation then
  return null;
end; $$;
revoke all on function public.socialtrading_agent_run_claim(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.socialtrading_agent_run_claim(text, text, text, text, integer) to service_role;

-- Enabled agents with their most recent wake-up, for the dispatcher.
create or replace function public.socialtrading_agents_due()
returns table (user_id text, agent_id text, agent jsonb, memory jsonb, last_started_at timestamptz)
language sql security invoker stable set search_path = public as $$
  select a.user_id, a.agent_id, a.state -> 'agent', a.memory,
    (select max(r.started_at) from socialtrading_agent_runs r where r.user_id = a.user_id and r.agent_id = a.agent_id and r.trigger = 'cron')
  from socialtrading_agents a where a.enabled
  order by a.user_id, a.agent_id;
$$;
revoke all on function public.socialtrading_agents_due() from public, anon, authenticated;
grant execute on function public.socialtrading_agents_due() to service_role;

-- 3. Notifications the agent chose to surface.
create table if not exists public.socialtrading_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  agent_id text not null,
  run_id uuid references public.socialtrading_agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  title text not null,
  body text not null,
  relevance text not null check (relevance in ('low', 'medium', 'high')),
  dedupe_key text,
  parts jsonb not null default '[]'::jsonb,
  foreign key (user_id, agent_id) references public.socialtrading_agents(user_id, agent_id) on delete cascade
);
create index if not exists socialtrading_notifications_recent on public.socialtrading_notifications(user_id, agent_id, created_at desc);
create unique index if not exists socialtrading_notifications_dedupe on public.socialtrading_notifications(user_id, agent_id, dedupe_key) where dedupe_key is not null;

alter table public.socialtrading_agent_runs enable row level security;
alter table public.socialtrading_notifications enable row level security;
revoke all on public.socialtrading_agent_runs, public.socialtrading_notifications from anon, authenticated;
grant all on public.socialtrading_agent_runs, public.socialtrading_notifications to service_role;

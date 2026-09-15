-- Plans, accounts, the credits ledger, chat threads, and plan-aware limits.
-- Apply after 202609150003_agent_runtime.sql. Server role only; no browser grants.
-- The plan catalogue lives in lib/socialtrading/plans.ts; the server snapshots each user's limits into
-- socialtrading_accounts.limits and Postgres enforces that snapshot. A null limit means "no cap".

-- 1. Accounts: one row per signed-in user.
create table if not exists public.socialtrading_accounts (
  user_id text primary key,
  plan_id text not null default 'free',
  limits jsonb not null default '{}'::jsonb,
  -- USD micros (1 USD = 1,000,000). Debited by real model usage.
  credits_micros bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Usage ledger: one row per model call. A hold is reserved before the call and settled to the real cost after.
create table if not exists public.socialtrading_usage (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  agent_id text,
  source text not null check (source in ('chat', 'background')),
  -- What the call belonged to: the assistant message id for chats, the run id for background wake-ups.
  ref text,
  status text not null check (status in ('reserved', 'settled', 'released')),
  hold_micros bigint not null,
  cost_micros bigint,
  prompt_tokens integer,
  completion_tokens integer,
  model text,
  request_id text,
  cost_source text check (cost_source in ('openrouter', 'estimate')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists socialtrading_usage_recent on public.socialtrading_usage(user_id, created_at desc);

alter table public.socialtrading_accounts enable row level security;
alter table public.socialtrading_usage enable row level security;
revoke all on public.socialtrading_accounts, public.socialtrading_usage from anon, authenticated;
grant all on public.socialtrading_accounts, public.socialtrading_usage to service_role;

-- 3. Chats: every agent's single conversation becomes one thread so threads can be counted, switched, and deleted.
update public.socialtrading_agents set state = (state - 'messages') || jsonb_build_object('chats', jsonb_build_array(jsonb_build_object(
    'id', 'default',
    'title', case when state #>> '{messages,0,role}' = 'user' and state #>> '{messages,0,parts,0,type}' = 'text'
      then left(regexp_replace(state #>> '{messages,0,parts,0,text}', '\s+', ' ', 'g'), 60)
      when jsonb_typeof(state -> 'messages') = 'array' and jsonb_array_length(state -> 'messages') > 0 then 'Earlier conversation'
      else 'New chat' end,
    'createdAt', coalesce(state #>> '{messages,0,at}', to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'updatedAt', coalesce(state #>> '{messages,-1,at}', to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'messages', case when jsonb_typeof(state -> 'messages') = 'array' then state -> 'messages' else '[]'::jsonb end
  )))
  where not (state ? 'chats');

-- 4. Helpers.
create or replace function public.socialtrading_jsonb_len(p_value jsonb)
returns integer language sql immutable as $$
  select case when jsonb_typeof(p_value) = 'array' then jsonb_array_length(p_value) else 0 end;
$$;
create or replace function public.socialtrading_count_follows(p_state jsonb)
returns integer language sql immutable as $$
  select coalesce((select count(*)::int from jsonb_array_elements(case when jsonb_typeof(p_state #> '{profile,interests}') = 'array' then p_state #> '{profile,interests}' else '[]'::jsonb end) i where i ->> 'kind' in ('stock', 'crypto')), 0);
$$;
-- The user's cap for one key: their snapshot, the free defaults when they have no account yet, null when uncapped.
create or replace function public.socialtrading_limit(p_user_id text, p_key text)
returns integer language sql stable set search_path = public as $$
  select case
    when l ? p_key then case when jsonb_typeof(l -> p_key) = 'null' then null else (l ->> p_key)::int end
    else (('{"follows":5,"preferenceItems":5,"learnedAssets":25,"thesisChars":1000,"chats":20,"agents":3,"enabledAgents":2}'::jsonb) ->> p_key)::int
  end
  from (select coalesce((select limits from socialtrading_accounts where user_id = p_user_id), '{}'::jsonb) as l) s;
$$;
-- Raises only when a quantity would end above the cap *and* above where it already was ("no new violations").
create or replace function public.socialtrading_check_limit(p_user_id text, p_key text, p_before integer, p_after integer)
returns void language plpgsql stable set search_path = public as $$
declare v_limit integer;
begin
  v_limit := socialtrading_limit(p_user_id, p_key);
  if v_limit is not null and p_after > v_limit and p_after > p_before then
    raise exception 'LIMIT_%', p_key using errcode = 'P0001', hint = 'This plan allows up to ' || v_limit || ' for ' || p_key || '.';
  end if;
end; $$;

-- 5. Agent count and total chats on insert (creation and the first initialize both insert).
create or replace function public.socialtrading_agents_count_limit()
returns trigger language plpgsql set search_path = public as $$
declare v_limit integer; v_chats integer;
begin
  perform pg_advisory_xact_lock(hashtext('socialtrading_agents_count:' || new.user_id));
  v_limit := socialtrading_limit(new.user_id, 'agents');
  if v_limit is not null and (select count(*) from socialtrading_agents where user_id = new.user_id) >= v_limit then
    raise exception 'AGENT_COUNT_LIMIT' using errcode = 'P0001', hint = 'This plan allows up to ' || v_limit || ' agents.';
  end if;
  v_limit := socialtrading_limit(new.user_id, 'chats');
  select coalesce(sum(socialtrading_jsonb_len(state -> 'chats')), 0) into v_chats from socialtrading_agents where user_id = new.user_id;
  if v_limit is not null and v_chats + socialtrading_jsonb_len(new.state -> 'chats') > v_limit then
    raise exception 'LIMIT_chats' using errcode = 'P0001', hint = 'This plan allows up to ' || v_limit || ' chats.';
  end if;
  return new;
end; $$;
drop trigger if exists socialtrading_agents_count_limit on public.socialtrading_agents;
create trigger socialtrading_agents_count_limit
  before insert on public.socialtrading_agents
  for each row execute function public.socialtrading_agents_count_limit();

-- 6. The enabled-agents cap now follows the plan instead of a constant.
create or replace function public.socialtrading_agents_enabled_limit()
returns trigger language plpgsql set search_path = public as $$
declare v_limit integer;
begin
  if new.enabled then
    perform pg_advisory_xact_lock(hashtext('socialtrading_agents_enabled:' || new.user_id));
    v_limit := socialtrading_limit(new.user_id, 'enabledAgents');
    if v_limit is not null and (select count(*) from socialtrading_agents where user_id = new.user_id and enabled and agent_id <> new.agent_id) >= v_limit then
      raise exception 'AGENT_LIMIT' using errcode = 'P0001', hint = 'At most ' || v_limit || ' agents per user can be enabled.';
    end if;
  end if;
  return new;
end; $$;

-- 7. Compare-and-swap save with plan checks. Learned-asset caps are enforced by the server (theme ids are a code catalogue).
create or replace function public.socialtrading_agent_save(p_user_id text, p_agent_id text, p_revision integer, p_state jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_state jsonb; v_enabled boolean; v_old jsonb; v_before integer; v_after integer; v_other integer; v_limit integer;
begin
  select enabled, state into v_enabled, v_old from socialtrading_agents where user_id = p_user_id and agent_id = p_agent_id and revision = p_revision for update;
  if not found then return false; end if;

  perform socialtrading_check_limit(p_user_id, 'thesisChars', coalesce(length(v_old #>> '{profile,thesis}'), 0), coalesce(length(p_state #>> '{profile,thesis}'), 0));
  perform socialtrading_check_limit(p_user_id, 'follows', socialtrading_count_follows(v_old), socialtrading_count_follows(p_state));
  perform socialtrading_check_limit(p_user_id, 'preferenceItems', socialtrading_jsonb_len(v_old #> '{profile,interests}'), socialtrading_jsonb_len(p_state #> '{profile,interests}'));
  perform socialtrading_check_limit(p_user_id, 'preferenceItems', socialtrading_jsonb_len(v_old -> 'preferences'), socialtrading_jsonb_len(p_state -> 'preferences'));
  perform socialtrading_check_limit(p_user_id, 'preferenceItems', socialtrading_jsonb_len(v_old -> 'dislikes'), socialtrading_jsonb_len(p_state -> 'dislikes'));

  v_before := socialtrading_jsonb_len(v_old -> 'chats'); v_after := socialtrading_jsonb_len(p_state -> 'chats');
  v_limit := socialtrading_limit(p_user_id, 'chats');
  if v_limit is not null and v_after > v_before then
    -- Serialize chat creation per user so two agents cannot both take the last slot.
    perform pg_advisory_xact_lock(hashtext('socialtrading_chats:' || p_user_id));
    select coalesce(sum(socialtrading_jsonb_len(state -> 'chats')), 0) into v_other from socialtrading_agents where user_id = p_user_id and agent_id <> p_agent_id;
    if v_other + v_after > v_limit then
      raise exception 'LIMIT_chats' using errcode = 'P0001', hint = 'This plan allows up to ' || v_limit || ' chats.';
    end if;
  end if;

  v_state := jsonb_set(p_state, '{revision}', to_jsonb(p_revision + 1));
  if v_state ? 'agent' then v_state := jsonb_set(v_state, '{agent,enabled}', to_jsonb(v_enabled)); end if;
  update socialtrading_agents set state = v_state, revision = p_revision + 1, updated_at = now()
    where user_id = p_user_id and agent_id = p_agent_id and revision = p_revision;
  insert into socialtrading_agent_versions(user_id, agent_id, revision, state) values (p_user_id, p_agent_id, p_revision + 1, v_state);
  return true;
end; $$;

-- 8. Account read with usage counts. Creates the account on first sight with the plan the server passes.
create or replace function public.socialtrading_account_get(p_user_id text, p_plan_id text, p_limits jsonb, p_credits bigint)
returns table (plan_id text, limits jsonb, credits_micros bigint, agents integer, enabled_agents integer, chats integer, spent_micros bigint, requests integer)
language plpgsql security invoker set search_path = public as $$
begin
  insert into socialtrading_accounts(user_id, plan_id, limits, credits_micros) values (p_user_id, p_plan_id, p_limits, p_credits)
    on conflict (user_id) do nothing;
  return query select a.plan_id, a.limits, a.credits_micros,
    (select count(*)::int from socialtrading_agents g where g.user_id = p_user_id),
    (select count(*)::int from socialtrading_agents g where g.user_id = p_user_id and g.enabled),
    (select coalesce(sum(socialtrading_jsonb_len(g.state -> 'chats')), 0)::int from socialtrading_agents g where g.user_id = p_user_id),
    (select coalesce(sum(u.cost_micros), 0)::bigint from socialtrading_usage u where u.user_id = p_user_id and u.status = 'settled'),
    (select count(*)::int from socialtrading_usage u where u.user_id = p_user_id and u.status = 'settled')
  from socialtrading_accounts a where a.user_id = p_user_id;
end; $$;

-- 9. Credits. Reserve is the only place a balance can go down before the call happens, and it is atomic.
create or replace function public.socialtrading_credits_reserve(p_user_id text, p_agent_id text, p_source text, p_ref text, p_hold bigint)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  update socialtrading_accounts set credits_micros = credits_micros - p_hold, updated_at = now()
    where user_id = p_user_id and credits_micros >= p_hold;
  if not found then return null; end if;
  insert into socialtrading_usage(user_id, agent_id, source, ref, status, hold_micros) values (p_user_id, p_agent_id, p_source, p_ref, 'reserved', p_hold)
    returning id into v_id;
  return v_id;
end; $$;
-- Settles a reservation to the real cost. Idempotent: a second call returns the balance without charging again.
create or replace function public.socialtrading_credits_settle(p_entry uuid, p_cost bigint, p_prompt integer, p_completion integer, p_model text, p_request_id text, p_cost_source text)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_row socialtrading_usage%rowtype; v_balance bigint;
begin
  select * into v_row from socialtrading_usage where id = p_entry for update;
  if not found then return null; end if;
  if v_row.status = 'reserved' then
    update socialtrading_accounts set credits_micros = credits_micros + v_row.hold_micros - p_cost, updated_at = now() where user_id = v_row.user_id;
    update socialtrading_usage set status = 'settled', cost_micros = p_cost, prompt_tokens = p_prompt, completion_tokens = p_completion,
      model = p_model, request_id = p_request_id, cost_source = p_cost_source, settled_at = now() where id = p_entry;
  end if;
  select credits_micros into v_balance from socialtrading_accounts where user_id = v_row.user_id;
  return v_balance;
end; $$;
-- Refunds a hold when the call never produced a response.
create or replace function public.socialtrading_credits_release(p_entry uuid)
returns bigint language plpgsql security invoker set search_path = public as $$
declare v_row socialtrading_usage%rowtype; v_balance bigint;
begin
  select * into v_row from socialtrading_usage where id = p_entry for update;
  if not found then return null; end if;
  if v_row.status = 'reserved' then
    update socialtrading_accounts set credits_micros = credits_micros + v_row.hold_micros, updated_at = now() where user_id = v_row.user_id;
    update socialtrading_usage set status = 'released', settled_at = now() where id = p_entry;
  end if;
  select credits_micros into v_balance from socialtrading_accounts where user_id = v_row.user_id;
  return v_balance;
end; $$;

revoke all on function public.socialtrading_limit(text, text), public.socialtrading_check_limit(text, text, integer, integer),
  public.socialtrading_account_get(text, text, jsonb, bigint), public.socialtrading_credits_reserve(text, text, text, text, bigint),
  public.socialtrading_credits_settle(uuid, bigint, integer, integer, text, text, text), public.socialtrading_credits_release(uuid)
  from public, anon, authenticated;
grant execute on function public.socialtrading_limit(text, text), public.socialtrading_check_limit(text, text, integer, integer),
  public.socialtrading_account_get(text, text, jsonb, bigint), public.socialtrading_credits_reserve(text, text, text, text, bigint),
  public.socialtrading_credits_settle(uuid, bigint, integer, integer, text, text, text), public.socialtrading_credits_release(uuid)
  to service_role;

-- Each agent owns its state and revision. Existing workspaces are retained for rollback.
create table public.socialtrading_agents (
  user_id text not null,
  agent_id text not null,
  revision integer not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, agent_id)
);
create table public.socialtrading_agent_versions (
  user_id text not null, agent_id text not null, revision integer not null,
  state jsonb not null, created_at timestamptz not null default now(),
  primary key (user_id, agent_id, revision),
  foreign key (user_id, agent_id) references public.socialtrading_agents(user_id, agent_id)
);
insert into public.socialtrading_agents(user_id, agent_id, revision, state)
select user_id, 'default', revision, state || jsonb_build_object('agent', jsonb_build_object(
  'id', 'default', 'name', 'My agent', 'description', '', 'instructions', '',
  'capabilities', jsonb_build_array('profile', 'market', 'trading'), 'createdAt', updated_at
)) from public.socialtrading_workspaces;
insert into public.socialtrading_agent_versions(user_id, agent_id, revision, state, created_at)
select user_id, 'default', revision, state, created_at from public.socialtrading_versions;
alter table public.socialtrading_agents enable row level security;
alter table public.socialtrading_agent_versions enable row level security;
revoke all on public.socialtrading_agents, public.socialtrading_agent_versions from anon, authenticated;
grant all on public.socialtrading_agents, public.socialtrading_agent_versions to service_role;
create function public.socialtrading_agent_save(p_user_id text, p_agent_id text, p_revision integer, p_state jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update socialtrading_agents set state = jsonb_set(p_state, '{revision}', to_jsonb(p_revision + 1)),
    revision = p_revision + 1, updated_at = now()
    where user_id = p_user_id and agent_id = p_agent_id and revision = p_revision;
  if not found then return false; end if;
  insert into socialtrading_agent_versions(user_id, agent_id, revision, state)
    values (p_user_id, p_agent_id, p_revision + 1, jsonb_set(p_state, '{revision}', to_jsonb(p_revision + 1)));
  return true;
end; $$;
revoke all on function public.socialtrading_agent_save(text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.socialtrading_agent_save(text, text, integer, jsonb) to service_role;

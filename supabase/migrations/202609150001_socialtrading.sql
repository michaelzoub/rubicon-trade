-- Server-only persistence. Privy is verified in every route; no browser grants.
create table if not exists public.socialtrading_workspaces (
  user_id text primary key, revision integer not null default 0,
  state jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.socialtrading_versions (
  user_id text not null references public.socialtrading_workspaces(user_id),
  revision integer not null, state jsonb not null, created_at timestamptz not null default now(),
  primary key (user_id, revision)
);
create table if not exists public.socialtrading_connections (
  user_id text primary key, encrypted_tokens text not null, updated_at timestamptz not null default now()
);
create table if not exists public.socialtrading_oauth (
  state_hash text primary key, user_id text not null, encrypted_flow text not null,
  expires_at timestamptz not null
);
alter table public.socialtrading_workspaces enable row level security;
alter table public.socialtrading_versions enable row level security;
alter table public.socialtrading_connections enable row level security;
alter table public.socialtrading_oauth enable row level security;
revoke all on public.socialtrading_workspaces, public.socialtrading_versions, public.socialtrading_connections, public.socialtrading_oauth from anon, authenticated;
grant all on public.socialtrading_workspaces, public.socialtrading_versions, public.socialtrading_connections, public.socialtrading_oauth to service_role;

create or replace function public.socialtrading_save(p_user_id text, p_revision integer, p_state jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  -- Compare-and-swap serializes concurrent changes, including spending reservations.
  update socialtrading_workspaces set state = jsonb_set(p_state, '{revision}', to_jsonb(p_revision + 1)),
    revision = p_revision + 1, updated_at = now()
    where user_id = p_user_id and revision = p_revision;
  if not found then return false; end if;
  insert into socialtrading_versions(user_id, revision, state)
    values (p_user_id, p_revision + 1, jsonb_set(p_state, '{revision}', to_jsonb(p_revision + 1)));
  return true;
end; $$;
revoke all on function public.socialtrading_save(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.socialtrading_save(text, integer, jsonb) to service_role;

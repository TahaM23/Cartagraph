-- Phase 2: the workspace schema.
--
-- Authorization lives here, not in the application. Every table in `public`
-- belongs to an organization, row-level security is forced on by an event
-- trigger rather than remembered per table, and every policy reads the
-- organization off the caller's Clerk session token.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- RLS is on by default
-- ---------------------------------------------------------------------------
-- A table with RLS and no policy returns nothing, which is visible. A table
-- without RLS returns everything, silently. This trigger makes the second
-- impossible: new tables in `public` get RLS enabled as they are created, and
-- an ALTER that would leave a table without it is rejected.

create function private.enforce_rls()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  cmd record;
  has_rls boolean;
begin
  for cmd in
    select * from pg_catalog.pg_event_trigger_ddl_commands()
    where object_type in ('table', 'partitioned table')
      and schema_name = 'public'
  loop
    select c.relrowsecurity into has_rls
    from pg_catalog.pg_class c
    where c.oid = cmd.objid;

    if has_rls is not false then
      continue;
    end if;

    if cmd.command_tag = 'ALTER TABLE' then
      raise exception 'row-level security cannot be disabled on %', cmd.object_identity
        using hint = 'Every table in public must have row-level security enabled.';
    end if;

    execute format('alter table %s enable row level security', cmd.object_identity);
  end loop;
end;
$$;

revoke execute on function private.enforce_rls() from public;

create event trigger enforce_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE')
  execute function private.enforce_rls();

-- ---------------------------------------------------------------------------
-- The organization claim
-- ---------------------------------------------------------------------------
-- Clerk session tokens carry the active organization in `o.id`. This is the
-- only place the policies learn who is asking.

create function private.current_org_id()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'o' ->> 'id', '')
$$;

revoke execute on function private.current_org_id() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
-- Organizations are owned by Clerk; this table exists so that every row
-- below can hang off one by foreign key and go when it goes.
--
-- Child rows carry `org_id` directly (so each policy is a single indexed
-- comparison) and reference their parent through a composite key that
-- includes it, so a row can never claim a different organization from the
-- analysis it belongs to.

create table public.organizations (
  id text primary key check (id like 'org\_%'),
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  repo_owner text not null,
  repo_name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, repo_owner, repo_name),
  unique (id, org_id)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'parsing', 'complete', 'failed')),
  commit_sha text,
  created_by text,
  files_total integer check (files_total >= 0),
  files_parsed integer check (files_parsed >= 0),
  edge_count integer check (edge_count >= 0),
  coverage jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (id, org_id),
  foreign key (project_id, org_id)
    references public.projects (id, org_id) on delete cascade
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  parsed boolean not null default true,
  skip_reason text,
  fan_in integer not null default 0 check (fan_in >= 0),
  fan_out integer not null default 0 check (fan_out >= 0),
  unique (analysis_id, path),
  unique (id, analysis_id),
  foreign key (analysis_id, org_id)
    references public.analyses (id, org_id) on delete cascade,
  check (parsed or skip_reason is not null)
);

create table public.edges (
  id bigint generated always as identity primary key,
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  kind text not null
    check (kind in ('import', 're_export', 'dynamic_import', 'require')),
  specifier text not null,
  type_only boolean not null default false,
  foreign key (analysis_id, org_id)
    references public.analyses (id, org_id) on delete cascade,
  foreign key (source_file_id, analysis_id)
    references public.files (id, analysis_id) on delete cascade,
  foreign key (target_file_id, analysis_id)
    references public.files (id, analysis_id) on delete cascade
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  method text not null
    check (method in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS')),
  path text not null,
  foreign key (analysis_id, org_id)
    references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, analysis_id)
    references public.files (id, analysis_id) on delete cascade
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  cache_key text not null,
  model text not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (file_id, cache_key),
  foreign key (analysis_id, org_id)
    references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, analysis_id)
    references public.files (id, analysis_id) on delete cascade
);

create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null unique,
  role text not null,
  source text not null check (source in ('convention', 'model')),
  foreign key (analysis_id, org_id)
    references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, analysis_id)
    references public.files (id, analysis_id) on delete cascade
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid,
  kind text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (analysis_id, org_id)
    references public.analyses (id, org_id) on delete cascade,
  foreign key (file_id, analysis_id)
    references public.files (id, analysis_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Indexes: the policy column, and the foreign keys cascades walk
-- ---------------------------------------------------------------------------

create index projects_org_id_idx on public.projects (org_id);
create index analyses_org_id_created_at_idx on public.analyses (org_id, created_at desc);
create index analyses_project_id_idx on public.analyses (project_id);
create index files_org_id_idx on public.files (org_id);
create index edges_org_id_idx on public.edges (org_id);
create index edges_analysis_id_idx on public.edges (analysis_id);
create index edges_source_file_id_idx on public.edges (source_file_id);
create index edges_target_file_id_idx on public.edges (target_file_id);
create index routes_org_id_idx on public.routes (org_id);
create index routes_analysis_id_idx on public.routes (analysis_id);
create index routes_file_id_idx on public.routes (file_id);
create index explanations_org_id_idx on public.explanations (org_id);
create index explanations_analysis_id_idx on public.explanations (analysis_id);
create index file_roles_org_id_idx on public.file_roles (org_id);
create index file_roles_analysis_id_idx on public.file_roles (analysis_id);
create index insights_org_id_idx on public.insights (org_id);
create index insights_analysis_id_idx on public.insights (analysis_id);
create index insights_file_id_idx on public.insights (file_id);

-- ---------------------------------------------------------------------------
-- Privileges and policies
-- ---------------------------------------------------------------------------
-- Signed-in members of an organization can read its rows. Nothing writes
-- through the API yet, so no write privileges are granted; anon gets nothing.

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

create policy "members read their organization"
  on public.organizations for select to authenticated
  using (id = (select private.current_org_id()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'analyses', 'files', 'edges',
    'routes', 'explanations', 'file_roles', 'insights'
  ] loop
    execute format(
      'create policy "members read their organization" on public.%I '
      'for select to authenticated '
      'using (org_id = (select private.current_org_id()))',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prove it: no table above enabled RLS itself, so if any lacks it the
-- trigger failed, and the migration should too.
-- ---------------------------------------------------------------------------

do $$
declare
  missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (not c.relrowsecurity
         or not exists (select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid));
  if missing is not null then
    raise exception 'tables in public without row-level security or a policy: %', missing;
  end if;
end;
$$;

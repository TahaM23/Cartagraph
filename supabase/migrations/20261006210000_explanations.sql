-- Phase 10: explanations, and roles a model assigns.
--
-- Both are cached on the content of the thing being explained, not on the
-- rows of one analysis. Files are deleted and re-inserted on every re-run, so
-- a cache hanging off a file row would empty itself each time the repository
-- was re-analysed; one keyed on content survives it, and an unchanged file
-- costs nothing to explain again.
--
-- Reads go through the signed-in user's token, like every other table. Only
-- the server writes, with the secret key, after a model has answered: a
-- member who could insert here could put words in the model's mouth for
-- everyone else in their organization.

-- ---------------------------------------------------------------------------
-- Explanations
-- ---------------------------------------------------------------------------
-- The old table was keyed to a file row and held seed text only.

drop table public.explanations;

create table public.explanations (
  org_id text not null references public.organizations (id) on delete cascade,
  -- sha256 of everything the model was shown, the model and the prompt
  -- version included (lib/ai/cache.ts).
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  subject text not null check (subject in ('file', 'folder')),
  model text not null,
  body text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, cache_key)
);

-- ---------------------------------------------------------------------------
-- Role labels
-- ---------------------------------------------------------------------------
-- What the model called a file no adapter could identify. Only roles that
-- decide nothing structural: page, route and controller decide the route
-- table and the entry-point colouring, and convention owns those.

create table public.role_labels (
  org_id text not null references public.organizations (id) on delete cascade,
  cache_key text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  model text not null,
  role text not null
    check (role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook')),
  created_at timestamptz not null default now(),
  primary key (org_id, cache_key)
);

-- Supabase grants new tables to every API role by default; take that back.
revoke all on public.explanations, public.role_labels from anon, authenticated;
grant select on public.explanations, public.role_labels to authenticated;

create policy "members read their organization"
  on public.explanations for select to authenticated
  using (org_id = (select private.current_org_id()));

create policy "members read their organization"
  on public.role_labels for select to authenticated
  using (org_id = (select private.current_org_id()));

-- The same rule, applied where the labels land: a model-sourced role is one
-- of the non-structural few, whatever wrote it.
alter table public.file_roles
  add constraint file_roles_model_role_is_not_structural
  check (source = 'convention'
         or role in ('service', 'repository', 'model', 'util', 'config', 'component', 'hook'));

-- ---------------------------------------------------------------------------
-- The run labels before it stores
-- ---------------------------------------------------------------------------

alter table public.analyses drop constraint analyses_stage_check;
alter table public.analyses
  add constraint analyses_stage_check check (stage in ('fetch', 'select', 'parse', 'label', 'store'));

-- ---------------------------------------------------------------------------
-- Storing a parse result, with the model's labels
-- ---------------------------------------------------------------------------
-- As before, plus `model_roles`: [{ path, role }] for files no convention
-- named. They land in the same transaction as the graph, and a convention
-- role always wins over a label for the same file.

drop function public.store_parse_result(uuid, jsonb, timestamptz);

create function public.store_parse_result(
  target_analysis uuid, parse_result jsonb, claimed_started_at timestamptz, model_roles jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  org text;
  current_start timestamptz;
  expected integer;
  stored integer;
  stored_routes integer;
  stored_labels integer;
begin
  select a.org_id, a.started_at into org, current_start
  from public.analyses a
  where a.id = target_analysis
  for update;

  if org is null then
    raise exception 'analysis % does not exist', target_analysis;
  end if;

  -- A run that went stale and was taken over may still finish. Its result is
  -- not the one the analysis is waiting for, so it is refused, not stored.
  if current_start is distinct from claimed_started_at then
    raise exception 'analysis % was claimed by a newer run', target_analysis
      using errcode = 'CG409';
  end if;

  -- Cascades to edges, file roles and routes (and anything else hung off a file).
  delete from public.files where analysis_id = target_analysis;

  insert into public.files (
    org_id, analysis_id, path, folder, package, extension, lines, bytes, hash,
    parsed, skip_reason, skip_detail, fan_in, fan_out, entry
  )
  select org, target_analysis, f.path, f.folder, f.package, f.extension, f.lines, f.bytes,
         f.hash, f.parsed, f."skipReason", f."skipDetail", f."fanIn", f."fanOut", f.entry
  from jsonb_to_recordset(parse_result -> 'files') as f (
    path text, folder text, package text, extension text, lines integer, bytes integer,
    hash text, parsed boolean, "skipReason" text, "skipDetail" text,
    "fanIn" integer, "fanOut" integer, entry text
  );

  insert into public.file_roles (org_id, analysis_id, file_id, role, source)
  select org, target_analysis, stored_file.id, f.role, 'convention'
  from jsonb_to_recordset(parse_result -> 'files') as f (path text, role text)
  join public.files stored_file
    on stored_file.analysis_id = target_analysis and stored_file.path = f.path
  where f.role is not null;

  insert into public.edges (
    org_id, analysis_id, source_file_id, target_file_id, kind, specifier, type_only, line
  )
  select org, target_analysis, source_file.id, target_file.id,
         e.kind, e.specifier, e."typeOnly", e.line
  from jsonb_to_recordset(parse_result -> 'edges') as e (
    source text, target text, kind text, specifier text, "typeOnly" boolean, line integer
  )
  join public.files source_file
    on source_file.analysis_id = target_analysis and source_file.path = e.source
  join public.files target_file
    on target_file.analysis_id = target_analysis and target_file.path = e.target;

  -- The joins above must not drop an edge without saying so.
  get diagnostics stored = row_count;
  expected := jsonb_array_length(parse_result -> 'edges');
  if stored <> expected then
    raise exception 'stored % of % edges; some endpoints are not files', stored, expected;
  end if;

  insert into public.routes (org_id, analysis_id, file_id, method, path, line)
  select org, target_analysis, route_file.id, r.method, r.path, r.line
  from jsonb_to_recordset(coalesce(parse_result -> 'routes', '[]'::jsonb)) as r (
    method text, path text, file text, line integer
  )
  join public.files route_file
    on route_file.analysis_id = target_analysis and route_file.path = r.file;

  -- Nor a route.
  get diagnostics stored_routes = row_count;
  if stored_routes <> jsonb_array_length(coalesce(parse_result -> 'routes', '[]'::jsonb)) then
    raise exception 'stored % of % routes; some declaring files are not files',
      stored_routes, jsonb_array_length(parse_result -> 'routes');
  end if;

  -- Nor a label. Every label names a stored file; one that names a file a
  -- convention already gave a role is not stored, and that is the only
  -- reason one is not.
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(model_roles, '[]'::jsonb)) as m (path text, role text)
    left join public.files labelled
      on labelled.analysis_id = target_analysis and labelled.path = m.path
    where labelled.id is null
  ) then
    raise exception 'a role label names a file that is not in the result';
  end if;

  insert into public.file_roles (org_id, analysis_id, file_id, role, source)
  select org, target_analysis, labelled.id, m.role, 'model'
  from jsonb_to_recordset(coalesce(model_roles, '[]'::jsonb)) as m (path text, role text)
  join public.files labelled
    on labelled.analysis_id = target_analysis and labelled.path = m.path
  on conflict (file_id) do nothing;

  get diagnostics stored_labels = row_count;

  update public.analyses
  set status = 'complete',
      stage = 'store',
      stage_message = format('Stored %s files, %s edges, %s routes and %s role labels',
        jsonb_array_length(parse_result -> 'files'), stored, stored_routes, stored_labels),
      stage_at = now(),
      finished_at = now(),
      error = null,
      adapter = parse_result ->> 'adapter',
      coverage = parse_result -> 'coverage',
      unresolved = parse_result -> 'unresolved',
      excluded = parse_result -> 'excluded',
      files_total = (parse_result #>> '{coverage,files,found}')::integer,
      files_parsed = (parse_result #>> '{coverage,files,parsed}')::integer,
      edge_count = stored
  where id = target_analysis;
end;
$$;

revoke execute on function public.store_parse_result(uuid, jsonb, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.store_parse_result(uuid, jsonb, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- What an explanation is written from
-- ---------------------------------------------------------------------------
-- The stored files named in `member_paths`, every distinct import pair with
-- one of them at either end, and the files at the other ends. One round trip,
-- so a cached explanation is answered without reading the whole graph.
--
-- Security invoker (the default): row-level security decides what it reads,
-- and another organization's analysis returns no members.

create function public.neighbourhood(target_analysis uuid, member_paths text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  with members as (
    select f.id
    from public.files f
    where f.analysis_id = target_analysis and f.path = any (member_paths)
  ),
  pairs as (
    select distinct e.source_file_id, e.target_file_id
    from public.edges e
    where e.analysis_id = target_analysis
      and (e.source_file_id in (select id from members) or e.target_file_id in (select id from members))
  ),
  touched as (
    select id from members
    union
    select source_file_id from pairs
    union
    select target_file_id from pairs
  )
  select jsonb_build_object(
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'path', f.path,
        'hash', f.hash,
        'lines', f.lines,
        'parsed', f.parsed,
        'fanIn', f.fan_in,
        'fanOut', f.fan_out,
        'role', r.role,
        'roleSource', r.source,
        'member', f.id in (select id from members)
      ) order by f.path)
      from public.files f
      left join public.file_roles r on r.file_id = f.id
      where f.id in (select id from touched)
    ), '[]'::jsonb),
    'pairs', coalesce((
      select jsonb_agg(jsonb_build_array(s.path, t.path) order by s.path, t.path)
      from pairs p
      join public.files s on s.id = p.source_file_id
      join public.files t on t.id = p.target_file_id
    ), '[]'::jsonb)
  )
$$;

revoke execute on function public.neighbourhood(uuid, text[]) from public, anon;
grant execute on function public.neighbourhood(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Prove it, as the first migration did.
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

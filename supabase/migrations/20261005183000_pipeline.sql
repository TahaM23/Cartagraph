-- Phase 7: the pipeline.
--
-- An analysis is now produced by a run: fetch the archive, select the files,
-- parse them, store the result. This migration gives the run somewhere to say
-- which stage it is in, gives the files table everything the explorer reads,
-- holds a repository to one analysis, and adds the write paths the run needs.

-- ---------------------------------------------------------------------------
-- The run
-- ---------------------------------------------------------------------------
-- `status` stays coarse (queued, parsing, complete, failed) and `stage` says
-- where inside a run it is. A failed run keeps the stage it failed in, next to
-- the error saying why. `stage_at` moves with every stage, so a run that died
-- without failing is told apart from a slow one by how long ago it last moved.

alter table public.analyses
  add column stage text check (stage in ('fetch', 'select', 'parse', 'store')),
  add column stage_message text,
  add column stage_at timestamptz,
  add column adapter text,
  add column unresolved jsonb,
  add column excluded jsonb,
  add constraint analyses_failed_has_error check (status <> 'failed' or error is not null);

-- One analysis per repository. Re-running replaces that analysis's graph; it
-- never adds a second row. Existing duplicates (seed data only) go first,
-- keeping a complete analysis over any other, then the newest.

delete from public.analyses a
using (
  select id, row_number() over (
    partition by project_id
    order by (status = 'complete') desc, created_at desc, id desc
  ) as rank
  from public.analyses
) ranked
where ranked.id = a.id and ranked.rank > 1;

alter table public.analyses
  add constraint analyses_project_id_key unique (project_id);

drop index public.analyses_project_id_idx;

-- ---------------------------------------------------------------------------
-- Files carry what the parser knows about them
-- ---------------------------------------------------------------------------
-- Everything the explorer reads off a file node, so stored rows can stand in
-- for the parse result. A file's role lives in file_roles, as before.

alter table public.files
  add column folder text,
  add column package text,
  add column extension text,
  add column lines integer not null default 0 check (lines >= 0),
  add column bytes integer not null default 0 check (bytes >= 0),
  add column hash text check (hash ~ '^[0-9a-f]{64}$'),
  add column skip_detail text,
  add column entry text;

update public.files
set folder = coalesce(substring(path from '^(.*)/[^/]*$'), '.'),
    extension = coalesce(substring(path from '(\.[^./]+)$'), '');

alter table public.files
  alter column folder set not null,
  alter column extension set not null;

alter table public.edges
  add column line integer check (line > 0);

-- ---------------------------------------------------------------------------
-- Starting an analysis
-- ---------------------------------------------------------------------------
-- A signed-in member creates the project and its analysis rows for their own
-- organization, and the policy is what checks "their own". The organization
-- row is created on first use, since organizations are made in Clerk.

grant insert on public.organizations, public.projects, public.analyses to authenticated;

create policy "members register their organization"
  on public.organizations for insert to authenticated
  with check (id = (select private.current_org_id()));

create policy "members start analyses in their organization"
  on public.projects for insert to authenticated
  with check (org_id = (select private.current_org_id()));

create policy "members start analyses in their organization"
  on public.analyses for insert to authenticated
  with check (org_id = (select private.current_org_id()) and status = 'queued');

-- ---------------------------------------------------------------------------
-- Storing a parse result
-- ---------------------------------------------------------------------------
-- The run itself writes with the server's secret key: it outlives the
-- request, and the user's session token with it. It is handed one analysis id
-- and takes the organization from that row, never from its caller.
--
-- The graph is stored in one transaction. The previous graph (on a re-run) is
-- replaced and the analysis marked complete together, or not at all, so there
-- is never a half-written graph on a row that says complete. The argument is
-- the parser's own output (lib/parser/contract.ts), validated before the call.

create function public.store_parse_result(target_analysis uuid, parse_result jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  org text;
  expected integer;
  stored integer;
begin
  select a.org_id into org
  from public.analyses a
  where a.id = target_analysis
  for update;

  if org is null then
    raise exception 'analysis % does not exist', target_analysis;
  end if;

  -- Cascades to edges and file roles (and anything else hung off a file).
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

  update public.analyses
  set status = 'complete',
      stage = 'store',
      stage_message = format('Stored %s files and %s edges', jsonb_array_length(parse_result -> 'files'), stored),
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

revoke execute on function public.store_parse_result(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.store_parse_result(uuid, jsonb) to service_role;

-- Phase 8: routes.
--
-- A framework adapter now recovers HTTP routes, and only when the method and
-- the full pattern are both stated by the code. Each route keeps the line its
-- handler is declared on, so anyone can open the file and check it by hand.
--
-- Routes hang off a file, so storing a new graph (which deletes the old
-- files) removes the old routes by cascade, as it does edges and roles.

-- Routes nothing parsed (the seed's hand-written rows) have no line to point
-- at, and a route no parser produced is not one to show.
delete from public.routes;

alter table public.routes
  add column line integer not null check (line > 0);

create or replace function public.store_parse_result(target_analysis uuid, parse_result jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  org text;
  expected integer;
  stored integer;
  stored_routes integer;
begin
  select a.org_id into org
  from public.analyses a
  where a.id = target_analysis
  for update;

  if org is null then
    raise exception 'analysis % does not exist', target_analysis;
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

  update public.analyses
  set status = 'complete',
      stage = 'store',
      stage_message = format('Stored %s files, %s edges and %s routes',
        jsonb_array_length(parse_result -> 'files'), stored, stored_routes),
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

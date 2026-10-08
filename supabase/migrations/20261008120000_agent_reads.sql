-- What the agent's tools read, and the only way they read it.
--
-- The tools have no signed-in user, only a short-lived credential the app
-- signs when someone opens a conversation about an analysis: the analysis,
-- its organization and an expiry, HMAC-signed. This function checks that
-- signature itself, against a secret held in Vault, and returns that one
-- analysis's graph. The endpoint calls it with the publishable key, so
-- nothing it holds can read anything else: no secret key, and no token that
-- policies would let read a whole organization.
--
-- The secret is put in Vault once, outside the migrations, with the same
-- value as the app's AGENT_CREDENTIAL_SECRET:
--
--   select vault.create_secret('<value>', 'agent_credential_secret');

create function private.agent_credential_analysis(credential text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload text := split_part(credential, '.', 1);
  signature text := split_part(credential, '.', 2);
  secret text;
  claims jsonb;
  target uuid;
begin
  select s.decrypted_secret into secret
  from vault.decrypted_secrets s
  where s.name = 'agent_credential_secret';
  if secret is null then
    raise exception 'agent credentials are not configured' using errcode = 'CG503';
  end if;

  -- base64url, unpadded, as the app writes it.
  if payload = '' or signature = ''
     or signature <> rtrim(translate(encode(extensions.hmac(payload, secret, 'sha256'), 'base64'), '+/', '-_'), '=') then
    raise exception 'credential invalid or expired' using errcode = 'CG401';
  end if;

  begin
    claims := convert_from(
      decode(rpad(translate(payload, '-_', '+/'), (length(payload) + 3) / 4 * 4, '='), 'base64'),
      'utf8'
    )::jsonb;
    target := (claims ->> 'a')::uuid;
  exception when others then
    raise exception 'credential invalid or expired' using errcode = 'CG401';
  end;

  if (claims ->> 'exp') is null or (claims ->> 'exp')::bigint <= extract(epoch from now()) then
    raise exception 'credential invalid or expired' using errcode = 'CG401';
  end if;

  -- The organization is signed too: an analysis that has since moved, or a
  -- credential naming the wrong one, reads nothing.
  if not exists (
    select 1 from public.analyses a
    where a.id = target and a.org_id = claims ->> 'o' and a.status = 'complete'
  ) then
    raise exception 'analysis not available' using errcode = 'CG404';
  end if;

  return target;
end;
$$;

revoke execute on function private.agent_credential_analysis(text) from public, anon, authenticated;

-- The stored graph in the shapes the app's own reads return, so one piece of
-- code assembles both (lib/analysis/stored.ts).
create function public.agent_graph(credential text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target uuid := private.agent_credential_analysis(credential);
begin
  return jsonb_build_object(
    'analysis', (
      select jsonb_build_object(
        'adapter', a.adapter,
        'commit_sha', a.commit_sha,
        'coverage', a.coverage,
        'repository', p.repo_owner || '/' || p.repo_name
      )
      from public.analyses a
      join public.projects p on p.id = a.project_id
      where a.id = target
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'path', f.path, 'folder', f.folder, 'package', f.package, 'extension', f.extension,
        'lines', f.lines, 'bytes', f.bytes, 'hash', f.hash, 'parsed', f.parsed,
        'skip_reason', f.skip_reason, 'skip_detail', f.skip_detail,
        'fan_in', f.fan_in, 'fan_out', f.fan_out, 'entry', f.entry
      ) order by f.path)
      from public.files f
      where f.analysis_id = target
    ), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('file_id', r.file_id, 'role', r.role, 'source', r.source))
      from public.file_roles r
      where r.analysis_id = target
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object('source_file_id', e.source_file_id, 'target_file_id', e.target_file_id))
      from (
        select distinct e.source_file_id, e.target_file_id
        from public.edges e
        where e.analysis_id = target
      ) e
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object('file_id', r.file_id, 'method', r.method, 'path', r.path, 'line', r.line))
      from public.routes r
      where r.analysis_id = target
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.agent_graph(text) from public, authenticated;
grant execute on function public.agent_graph(text) to anon;

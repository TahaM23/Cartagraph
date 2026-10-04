-- Seed data for the two Clerk organizations in the development instance.
-- Nothing creates analyses yet, so these rows stand in for real ones. Every
-- table gets rows in both organizations so isolation can be checked on all of
-- them, not just the one the dashboard reads.
--
-- Idempotent: safe to run again. To reseed from scratch, delete the two
-- organizations and the cascade removes everything else.

insert into public.organizations (id) values
  ('org_3KEmDacdx6GneH3GIWcBhRwkifB'),  -- Taha's Team
  ('org_3KEmN678GQnexiO3AOSQZJBMEU8')   -- Mohammad's Organization
on conflict do nothing;

insert into public.projects (id, org_id, repo_owner, repo_name, created_at) values
  ('a0000000-0000-4000-8000-000000000001', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'vercel', 'next.js',          now() - interval '9 days'),
  ('a0000000-0000-4000-8000-000000000002', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'tanstack', 'query',          now() - interval '6 days'),
  ('a0000000-0000-4000-8000-000000000003', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'colinhacks', 'zod',          now() - interval '2 days'),
  ('b0000000-0000-4000-8000-000000000001', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'expressjs', 'express',       now() - interval '5 days'),
  ('b0000000-0000-4000-8000-000000000002', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'sindresorhus', 'got',        now() - interval '1 day')
on conflict do nothing;

insert into public.analyses
  (id, org_id, project_id, status, commit_sha, files_total, files_parsed, edge_count, error, created_at, started_at, finished_at)
values
  -- Taha's Team
  ('a1000000-0000-4000-8000-000000000001', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a0000000-0000-4000-8000-000000000001',
   'complete', '3f9c2a1d8e4b7c6a5f0e9d8c7b6a5f4e3d2c1b0a', 2841, 2790, 11532, null,
   now() - interval '9 days', now() - interval '9 days', now() - interval '9 days' + interval '74 seconds'),
  ('a1000000-0000-4000-8000-000000000002', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a0000000-0000-4000-8000-000000000002',
   'complete', '8b1e4f7a2c5d9e0f3a6b8c1d4e7f0a2b5c8d1e4f', 412, 409, 1688, null,
   now() - interval '6 days', now() - interval '6 days', now() - interval '6 days' + interval '11 seconds'),
  ('a1000000-0000-4000-8000-000000000003', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a0000000-0000-4000-8000-000000000001',
   'failed', 'c4d7e0f3a6b9c2d5e8f1a4b7c0d3e6f9a2b5c8d1', null, null, null, 'Repository exceeds the 5,000 file limit for a single request.',
   now() - interval '3 days', now() - interval '3 days', now() - interval '3 days' + interval '4 seconds'),
  ('a1000000-0000-4000-8000-000000000004', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a0000000-0000-4000-8000-000000000003',
   'parsing', '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', 318, 140, null, null,
   now() - interval '2 minutes', now() - interval '2 minutes', null),
  ('a1000000-0000-4000-8000-000000000005', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a0000000-0000-4000-8000-000000000002',
   'queued', null, null, null, null, null,
   now() - interval '30 seconds', null, null),
  -- Mohammad's Organization
  ('b1000000-0000-4000-8000-000000000001', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b0000000-0000-4000-8000-000000000001',
   'complete', 'e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4', 142, 142, 391, null,
   now() - interval '5 days', now() - interval '5 days', now() - interval '5 days' + interval '3 seconds'),
  ('b1000000-0000-4000-8000-000000000002', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b0000000-0000-4000-8000-000000000002',
   'complete', '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c', 87, 85, 203, null,
   now() - interval '1 day', now() - interval '1 day', now() - interval '1 day' + interval '2 seconds')
on conflict do nothing;

-- A handful of graph rows under one complete analysis per organization, so the
-- remaining six tables are populated in both.

insert into public.files (id, org_id, analysis_id, path, parsed, skip_reason, fan_in, fan_out) values
  ('a2000000-0000-4000-8000-000000000001', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'src/index.ts',                 true,  null, 0, 1),
  ('a2000000-0000-4000-8000-000000000002', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'src/queryClient.ts',           true,  null, 1, 1),
  ('a2000000-0000-4000-8000-000000000003', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'src/utils.ts',                 true,  null, 1, 0),
  ('a2000000-0000-4000-8000-000000000004', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'src/__generated__/schema.js',  false, 'Generated file', 0, 0),
  ('b2000000-0000-4000-8000-000000000001', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001', 'index.js',                     true,  null, 0, 1),
  ('b2000000-0000-4000-8000-000000000002', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001', 'lib/express.js',               true,  null, 1, 1),
  ('b2000000-0000-4000-8000-000000000003', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001', 'lib/router/index.js',          true,  null, 1, 0)
on conflict do nothing;

insert into public.edges (org_id, analysis_id, source_file_id, target_file_id, kind, specifier)
select v.* from (values
  ('org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000002'::uuid, 're_export', './queryClient'),
  ('org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002'::uuid, 'a2000000-0000-4000-8000-000000000002'::uuid, 'a2000000-0000-4000-8000-000000000003'::uuid, 'import',    './utils'),
  ('org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid, 'b2000000-0000-4000-8000-000000000002'::uuid, 'require',   './lib/express'),
  ('org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001'::uuid, 'b2000000-0000-4000-8000-000000000002'::uuid, 'b2000000-0000-4000-8000-000000000003'::uuid, 'require',   './router')
) as v(org_id, analysis_id, source_file_id, target_file_id, kind, specifier)
where not exists (select 1 from public.edges);

insert into public.routes (id, org_id, analysis_id, file_id, method, path) values
  ('a3000000-0000-4000-8000-000000000001', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'GET', '/'),
  ('b3000000-0000-4000-8000-000000000001', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', 'GET', '/')
on conflict do nothing;

insert into public.explanations (id, org_id, analysis_id, file_id, cache_key, model, body) values
  ('a4000000-0000-4000-8000-000000000001', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002',
   'seed', 'seed', 'Constructs the QueryClient the rest of the package imports through src/index.ts, and leans on src/utils.ts for key hashing.'),
  ('b4000000-0000-4000-8000-000000000001', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002',
   'seed', 'seed', 'Builds the application factory that index.js exports, wiring in the router from lib/router/index.js.')
on conflict do nothing;

insert into public.file_roles (id, org_id, analysis_id, file_id, role, source) values
  ('a5000000-0000-4000-8000-000000000001', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'entry', 'convention'),
  ('b5000000-0000-4000-8000-000000000001', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'entry', 'convention')
on conflict do nothing;

insert into public.insights (id, org_id, analysis_id, file_id, kind, detail) values
  ('a6000000-0000-4000-8000-000000000001', 'org_3KEmDacdx6GneH3GIWcBhRwkifB', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000004', 'unreferenced', '{}'),
  ('b6000000-0000-4000-8000-000000000001', 'org_3KEmN678GQnexiO3AOSQZJBMEU8', 'b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', 'unreferenced', '{}')
on conflict do nothing;

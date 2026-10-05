-- Phase 7: live progress.
--
-- When a run moves, the database publishes it, and the progress page and the
-- dashboard subscribe. Nothing in the browser polls.
--
-- Each analysis has its own private Broadcast topic, `analysis:<id>`. A
-- private topic delivers only to subscribers a policy on realtime.messages
-- admits, so the policy below is what declares the topic pattern: without
-- it, publishing still succeeds and the page simply never updates. It is also
-- who may subscribe, decided exactly as for the rows: another organization's
-- analysis channel is not joinable, for the same reason its row is not
-- selectable.

-- ---------------------------------------------------------------------------
-- Who may subscribe
-- ---------------------------------------------------------------------------
-- A member may receive broadcasts on `analysis:<id>` when that analysis
-- belongs to the organization on their token. Nothing grants sending: only
-- the trigger below publishes.

create policy "members receive their organization's analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.analyses a
      -- `case` so a topic of any other shape is never cast (AND does not
      -- promise to short-circuit); it matches no analysis instead.
      where a.id = case
          when (select realtime.topic()) ~ '^analysis:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring((select realtime.topic()) from 10)::uuid
        end
        and a.org_id = (select private.current_org_id())
    )
  );

-- ---------------------------------------------------------------------------
-- Publishing
-- ---------------------------------------------------------------------------
-- A trigger on our own table, never on the realtime machinery. It publishes
-- the stage and its message, not the row: the page has nothing to filter and
-- nothing to interpret. When the run has failed, the message is the reason.

create function private.publish_analysis_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status,
      'stage', new.stage,
      'message', case when new.status = 'failed' then new.error else new.stage_message end
    ),
    'stage',
    'analysis:' || new.id::text,
    true
  );
  return null;
end;
$$;

revoke execute on function private.publish_analysis_progress() from public, anon, authenticated;

create trigger publish_progress
  after update of status, stage, stage_message, error on public.analyses
  for each row
  when (
    (old.status, old.stage, old.stage_message, old.error)
      is distinct from (new.status, new.stage, new.stage_message, new.error)
  )
  execute function private.publish_analysis_progress();

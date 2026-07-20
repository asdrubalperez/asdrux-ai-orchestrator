create or replace function notify_run_observer()
returns trigger
language plpgsql
as $$
declare
  target_run_id uuid;
  source text;
begin
  if tg_table_name = 'run_events' then
    target_run_id := new.run_id;
    source := 'run_events';
  else
    target_run_id := new.id;
    source := 'runs';
  end if;

  perform pg_notify(
    'run_events_channel',
    json_build_object('run_id', target_run_id, 'source', source)::text
  );

  return new;
end;
$$;

drop trigger if exists run_events_notify_observer on run_events;
create trigger run_events_notify_observer
after insert on run_events
for each row execute function notify_run_observer();

drop trigger if exists runs_notify_observer on runs;
create trigger runs_notify_observer
after update of status, current_phase on runs
for each row execute function notify_run_observer();

do $$
begin
  if not exists (select 1 from users where handle = 'asdru' and password_hash is not null) then
    raise exception 'No existe users.handle=asdru con password_hash poblado. Ejecutar seed:user antes de Migracion B.';
  end if;

  if exists (
    select 1
    from runs
    where owner_id not in ('asdru', 'asdru-exhaustion-test', 'asdru-feature006-test2')
  ) then
    raise exception 'Existen owner_id historicos no contemplados para backfill.';
  end if;
end $$;

with asdru_user as (
  select id
  from users
  where handle = 'asdru'
),
initial_project as (
  insert into projects (name, repo_path, owner_id)
  select 'asdrux-ai-orchestrator', '/home/asdru/ai-orchestrator', id
  from asdru_user
  returning id
)
update runs
set owner_id_new = (select id from asdru_user),
    project_id = (select id from initial_project);

do $$
begin
  if exists (select 1 from runs where owner_id_new is null) then
    raise exception 'Backfill incompleto: runs.owner_id_new contiene nulls.';
  end if;

  if exists (select 1 from runs where project_id is null) then
    raise exception 'Backfill incompleto: runs.project_id contiene nulls.';
  end if;
end $$;

alter table runs drop column owner_id;
alter table runs rename column owner_id_new to owner_id;
alter table runs alter column owner_id set not null;

create index runs_owner_id_idx on runs (owner_id);

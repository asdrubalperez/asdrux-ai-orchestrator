-- FEATURE-042: proyectos con repositorio GitHub como configuración canónica.
-- Secciones A.2/A.4 del diseño aprobado (docs/features/FEATURE-042-propuesta-de-alcance-revisado-absorbe-FEATURE-030.md).

alter table projects
  add column updated_at timestamptz not null default now();

-- Corrección de implementación sobre lo aprobado en A.2: el diseño decía "dropear repo_path"
-- asumiendo que ningún camino la lee -- falso. `src/cli/commands/runStart.ts:228` (comando CLI
-- `run:start --case`, cleanupStrategy "shared-worktree") todavía la usa como ruta real de
-- filesystem de un repo ya clonado en el VPS, fuera del alcance de FEATURE-042 (que es
-- exclusivamente el flujo web). Dropearla rompería ese comando sin que el diseño diga qué debería
-- reemplazarla. Se deja la columna, solo se la vuelve nullable -- los proyectos nuevos del flujo
-- web (que no la usan) pueden crearse sin ella; el comando CLI legacy sigue funcionando igual para
-- los proyectos que ya la tienen.
alter table projects
  alter column repo_path drop not null;

alter table projects
  add column repository_provider text,
  add column repository_external_id text,
  add column repository_owner text,
  add column repository_name text,
  add column repository_full_name text,
  add column repository_clone_url text,
  add column repository_visibility text;

alter table projects
  add constraint projects_repository_provider_check
    check (
      repository_provider is null
      or repository_provider = 'github'
    );

alter table projects
  add constraint projects_repository_visibility_check
    check (
      repository_visibility is null
      or repository_visibility in ('public', 'private', 'internal')
    );

alter table projects
  add constraint projects_repository_fields_consistent_check
    check (
      (
        repository_provider is null
        and repository_external_id is null
        and repository_owner is null
        and repository_name is null
        and repository_full_name is null
        and repository_clone_url is null
        and repository_visibility is null
      )
      or
      (
        repository_provider is not null
        and repository_external_id is not null
        and repository_owner is not null
        and repository_name is not null
        and repository_full_name is not null
        and repository_clone_url is not null
        and repository_visibility is not null
      )
    );

-- Sección A.3: doble creación accidental del mismo proyecto (mismo owner+repo+nombre) o mismo
-- owner+nombre sin repositorio todavía. Deliberadamente SIN unique(owner_id, repository_external_id)
-- -- un usuario puede crear varios proyectos sobre el mismo repo.
create unique index projects_owner_repo_name_unique
  on projects (
    owner_id,
    repository_external_id,
    lower(name)
  )
  where repository_external_id is not null;

create unique index projects_owner_name_without_repo_unique
  on projects (
    owner_id,
    lower(name)
  )
  where repository_external_id is null;

-- Sección A.4/A.5: último proyecto seleccionado, preferencia de navegación (no fuente de verdad
-- de cada operación). ON DELETE SET NULL obligatorio -- ver A.5 para el orden de creación en dos
-- pasos que evita el ciclo lógico users->projects->users.
alter table users
  add column last_selected_project_id uuid;

alter table users
  add constraint users_last_selected_project_fk
    foreign key (last_selected_project_id)
    references projects(id)
    on delete set null;

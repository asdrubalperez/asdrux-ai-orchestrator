-- FEATURE-017: definición de los 12 campos del intake asistido por IA. Tabla simple, sin
-- versionado (una sola fila vigente por field_key, actualizable in-place) — ver Scope/Excluido #1
-- de la Feature para la justificación y el criterio de escalabilidad a versionado futuro.

create table intake_field_definitions (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  field_order integer not null,
  label text not null,
  description text not null,
  field_type text not null default 'text',
  updated_at timestamptz not null default now(),
  constraint intake_field_definitions_type_check
    check (field_type in ('text', 'textarea', 'select', 'list'))
);

insert into intake_field_definitions (field_key, field_order, label, description, field_type) values
  ('tipo_solucion', 1, 'Tipo de solución',
   'nueva o mejora_existente. No condiciona ningún otro campo en el MVP.', 'select'),
  ('vision', 2, 'Visión',
   'Visión general de la iniciativa: hacia dónde apunta.', 'textarea'),
  ('necesidad_problema', 3, 'Necesidad / Problema',
   'El problema o necesidad que motiva la iniciativa.', 'textarea'),
  ('solucion_propuesta', 4, 'Solución Propuesta',
   'Cómo se propone resolver la necesidad/problema descripto.', 'textarea'),
  ('grupo_objetivo_beneficiarios', 5, 'Grupo Objetivo / Beneficiarios',
   'Quién usa o se beneficia de la solución.', 'textarea'),
  ('objetivos_negocio', 6, 'Objetivos de Negocio',
   'Objetivos de negocio que persigue la iniciativa.', 'textarea'),
  ('alternativas_competidores', 7, 'Alternativas / Competidores',
   'Alternativas o competidores ya considerados.', 'textarea'),
  ('canales', 8, 'Canales',
   'Canales por los que se entrega o distribuye la solución.', 'list'),
  ('beneficios_esperables', 9, 'Beneficios Esperables',
   'Beneficios concretos esperados de la iniciativa.', 'textarea'),
  ('supuestos_pendientes', 10, 'Supuestos y Pendientes',
   'Supuestos asumidos y puntos aún sin resolver.', 'textarea'),
  ('repositorio', 11, 'Repositorio',
   'Repositorio de código sobre el que corre esta iniciativa. Siempre requerido.', 'text'),
  ('rama_base_trabajo', 12, 'Rama Base de Trabajo',
   'Rama base sobre la que arranca el trabajo. Siempre requerida; default "main" si no se indica.', 'text');

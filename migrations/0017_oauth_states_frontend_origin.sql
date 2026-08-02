-- FEATURE-042: el callback de /auth/github/callback nunca redirigia de vuelta al frontend --
-- devolvia el JSON crudo (hallazgo real de prueba manual, Vercel preview). Para redirigir hace
-- falta saber a que origen volver: production (aio.asdru.space) o el preview de Vercel que inicio
-- el flujo -- son dominios distintos y ORCHESTRATOR_WEB_ORIGIN es fijo a uno solo.
alter table oauth_states
  add column frontend_origin text not null default 'https://aio.asdru.space';

alter table oauth_states
  alter column frontend_origin drop default;

# FEATURE-010 — Resultados de implementación: Users, Projects y login del CLI

Fecha de cierre: 2026-07-19
Commits en `main`: `e3a39f596f` (implementación), `b790c0b441` (cierre en roadmap + Stage 3 del
Playbook v1.2)

> **Nota de proceso**: este documento, igual que `FEATURE-010-users-projects-login.md`, se redacta
> retroactivamente. Faltaba por completo en `docs/features/` pese a que la Feature ya estaba
> cerrada en el Roadmap — error detectado y corregido durante el cierre de Feature 09.

## Resumen

Tablas `users` y `projects` creadas, `runs.owner_id`/`project_id` migrados a FK real con 19/19
runs backfilleados, comandos `login`/`logout`/`seed:user` con `bcryptjs`, sesión local de 30 días
en `~/.orquestador/session.json`. El trabajo real se hizo en dos checkouts distintos (VPS y
notebook) sin coordinación de git clara entre ambos, lo que generó una serie de errores de
secuenciación evitables — documentados abajo sin maquillar el rodeo, siguiendo el mismo criterio
que ya se usó en `FEATURE-008-implementation-results.md`.

## Qué se implementó

- `migrations/0002_users_projects_phase_a.sql`: tablas `users`/`projects`, columnas nuevas
  nullable en `runs` (`owner_id_new`, `project_id`).
- `migrations/0003_users_projects_phase_b.sql`: validación explícita de `owner_id` históricos
  contemplados, backfill real, segunda validación de nulls, y eliminación de la columna
  `owner_id` vieja. **Precisión** (detectada por Codex al revisar el documento, verificada
  independientemente): el constraint `not null` a nivel de schema se aplicó solo a `owner_id`
  (`alter table runs alter column owner_id set not null`) — `project_id` quedó sin ese constraint,
  protegido únicamente por la validación de la migración en el momento del backfill, no por la
  base de datos misma hacia adelante.
- Comandos CLI `login` / `logout` / `seed:user`, con `bcryptjs` para el hash.
- Sesión local en `~/.orquestador/session.json`, expiración de 30 días (modo desarrollo).
- `docs/ROADMAP.md`: Feature 10 movida a ✅ Ejecutado, 3 ítems nuevos agregados en Tentativo
  (bajar expiración de sesión a 48h en producción, limpieza de `artifacts.commit_ref`, revaluar
  validación server-side de sesión).
- `docs/playbook/06-DELIVERY-WORKFLOW.md`: v1.1 → v1.2, declaración de rama/checkout de origen
  movida de Stage 6 a Stage 3 (aplicada en la misma sesión, verificada contra `main` real).

## Lecciones aprendidas — errores de secuenciación real, para no repetir

**Regla operativa central que esta sesión reforzó con dureza**: un reporte de "implementado y
validado" no es evidencia de que el código esté persistido. En esta sesión se aceptó un reporte de
"Feature 10 implementada y validada por 4 cortes" que resultó prematuro — nada estaba commiteado
todavía, el trabajo real vivía sin versionar en dos checkouts distintos (VPS y notebook), y recién
se detectó al bajar el tarball fresco de `main` y no encontrar nada de lo reportado. A partir de
acá: verificar el estado de git explícitamente (`git status`, `git log origin/X..HEAD`) es
obligatorio, no basta con que algo "haya funcionado" en una ejecución puntual.

Errores concretos de esta sesión, en orden:

1. **Pedir `git checkout main` sin haber chequeado antes si había cambios locales sin commitear
   que lo bloquearían.** Pasó dos veces seguidas. Antes de cualquier `checkout`, `merge` o `pull`,
   primero pedir `git status` y mirarlo — no asumir working tree limpio.
2. **Pedir aplicar un patch que nunca se había generado** — se saltó el paso previo que lo creaba.
   Repasar la secuencia completa antes de mandarla, no solo el siguiente paso en aislado.
3. **No cruzar información que ya se tenía.** El primer `git fetch origin` de la sesión ya
   mostraba que el remoto estaba adelante en una rama puntual — esa misma información explicaba,
   turnos después, un rechazo de push por "non-fast-forward" que se trató como sorpresa. Antes de
   reaccionar a un error de git, revisar si ya había evidencia de la causa más atrás en la misma
   sesión.
4. **Pedir un `git stash apply` de contenido ya verificado como idéntico al de la rama destino.**
   Generó conflictos innecesarios (LF/CRLF, mismo contenido en ambos lados) evitables verificando
   primero contra GitHub (`codeload`, nunca `raw`, por el caché) si la rama publicada ya tenía todo
   lo necesario.
5. **Verificar un commit divergente a medias** — se revisó un commit puntual y se asumió que ese
   era todo el rango a mergear, sin revisar el rango completo (`HEAD..origin/rama`). Salió bien de
   casualidad, no por verificación completa.

**Error adicional, de interpretación de lenguaje, no de git**: una frase del owner con "si"/"sí"
sin tilde se leyó como condicional cuando en realidad era una afirmación — retrasó la aplicación
de un cambio ya decidido. Ante una frase ambigua de ese tipo, conviene preguntar explícitamente en
vez de asumir la lectura más cauta por defecto.

**Regla concreta adoptada para sesiones siguientes**: antes de dar cualquier instrucción de git a
un ambiente remoto o pedirle a la persona que ejecute algo en su propia máquina:
(a) pedir `git status` primero si no está ya en el contexto inmediato,
(b) revisar el propio historial de la conversación por señales de estado ya mostradas antes,
(c) verificar independientemente contra GitHub (`codeload`) cuando sea posible, antes de mandar un
paso que dependa de un supuesto no confirmado, y
(d) dar los pasos de a poco, sin encadenar operaciones irreversibles (`push`, `merge`, `drop`,
`clean` sin `-n`) sin pausa para que la persona confirme la salida del paso anterior.

## Hallazgo adicional detectado al cerrar Feature 09 (no de esta sesión, pero sobre esta Feature)

Esta Feature quedó cerrada en `docs/ROADMAP.md` sin que existiera nunca un archivo
`FEATURE-010-*.md` en `docs/features/` — inconsistente con el patrón de todas las Features
anteriores (001 a 009), que sí tienen su documento de diseño y, cuando corresponde, su documento
de resultados. Este documento y `FEATURE-010-users-projects-login.md` corrigen esa omisión.

## Validación

- 19/19 runs backfilleados sin nulls remanentes, verificado contra la base real de la VPS.
- Comandos `login`/`logout`/`seed:user` ejecutados y confirmados contra la sesión real.
- `docs/ROADMAP.md` y `docs/playbook/06-DELIVERY-WORKFLOW.md` (v1.2) verificados por tarball
  fresco de `codeload`, no solo por reporte de terminal.
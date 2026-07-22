# FEATURE-014 — Resultados de Implementación (Autenticación unificada CLI + Web)

Versión: v1.0
Fecha: 2026-07-22
Implementación: Codex, commit `91e1dd5` (`feat: unify CLI and web sessions`)
Validación en vivo: owner, directamente en la VPS del proyecto

Este documento cierra FEATURE-014 y registra tanto la validación automatizada como la evidencia
operativa real exigida por el diseño.

---

## 0. Entorno y alcance de la validación

La implementación se desarrolló y validó primero en el checkout local con tests automatizados y
build completo. Después de que el commit quedó en `main`, el owner ejecutó directamente en la VPS
el flujo CLI real contra Postgres real. La evidencia en vivo no fue simulada ni reemplazada por
mocks.

No se agregaron migraciones: FEATURE-014 reutiliza la tabla `sessions` introducida por
FEATURE-013B.

---

## 1. Qué se implementó

Commit de implementación: `91e1dd5`.

1. **Núcleo de sesión compartido**: `src/auth/sessionCore.ts` centraliza TTL de 48 horas,
   generación de `rawToken` y hash SHA-256 para CLI y web.
2. **Repositorio agnóstico de canal**: rename de `createWebSession`/`getWebSessionById`/
   `revokeWebSession` a `createSessionRow`/`getSessionById`/`revokeSession`, conservando el mismo
   SQL y schema.
3. **CLI con validación server-side**: `readValidSession()` valida formato local, fila existente,
   revocación, expiración y hash; la identidad utilizada proviene de `sessions.user_id`, no del
   archivo editable.
4. **Nuevo contrato local**: `{sessionId, rawToken, userId, createdAt, expiresAt}`, escrito con
   permisos `0600` mediante temporal + reemplazo atómico.
5. **Re-login compensado**: crea y escribe la sesión nueva antes de revocar best-effort la
   anterior; si falla la escritura, intenta revocar la fila nueva.
6. **Logout con revocación real**: revoca primero en DB y borra después el archivo, distinguiendo
   fallos de DB, fallos de filesystem y ausencia de sesión local.
7. **Regresión web preservada**: `webSession.ts` consume el núcleo y repositorio compartidos sin
   alterar cookies, rate limiting ni comportamiento observable.
8. **Tests dirigidos nuevos**: cobertura para formato antiguo/corrupto, token alterado, identidad
   local manipulada, fila revocada/inexistente, fallos parciales, orden del re-login y password
   inválida sin mutaciones.

---

## 2. Validación cruzada contra los criterios de la Feature

### 2.1 Validación automatizada

- `npm test`: **24/24 tests exitosos**.
- `npm run build`: TypeScript backend, TypeScript web y build Vite exitosos.
- `git diff --check`: sin errores de whitespace.

| Criterio | Resultado |
|---|---|
| Formato viejo, JSON corrupto, `null`, arrays, primitivos y fechas inválidas | ✅ Rechazados con el mensaje estándar |
| Identidad local manipulada | ✅ Se usa `sessions.user_id` |
| Token alterado, fila revocada o inexistente | ✅ Sesión rechazada |
| DB no disponible durante validación/logout | ✅ Error operativo distinto; archivo preservado en logout |
| Revocación exitosa + borrado local fallido | ✅ Mensaje parcial explícito |
| Escritura nueva fallida | ✅ Revocación compensatoria de la fila nueva |
| Password inválida con sesión previa | ✅ No crea ni reemplaza sesión |
| Doble logout sin archivo | ✅ Idempotente, sin acceso innecesario a DB/filesystem |
| Regresión web | ✅ Tests existentes y build completo en verde |

### 2.2 Evidencia real en la VPS

El owner verificó directamente:

1. **Login CLI real**: login exitoso y `expiresAt` confirmado en exactamente **48 horas**.
2. **Comando protegido con sesión válida**: `run:status` ejecutó normalmente. El caso real
   incluía contexto de escalamiento y `originatedFromRunId`, evidencia adicional de que la
   migración de autenticación no rompió el flujo existente de runs/escalamientos.
3. **Logout CLI real**: revocación y eliminación local completadas.
4. **Prueba central de revocación server-side**: antes del logout se guardó una copia del
   `session.json`; después del logout se restauró esa copia y se reintentó el mismo comando. El
   comando fue rechazado con **"Sesión expirada o inexistente"**. El secreto local seguía siendo
   el mismo, pero la fila revocada ya no autenticaba: esta es la garantía nueva que no existía
   antes de FEATURE-014.
5. **Doble logout**: una ejecución posterior sin archivo local respondió **"No había sesión local
   para cerrar."**, sin error.

---

## 3. Hallazgos

**Ningún hallazgo funcional bloqueante.** La implementación cumplió el diseño y la validación
en vivo confirmó el objetivo de seguridad central.

- El archivo local deja de ser autoridad: conservar o restaurar una copia no permite evadir una
  revocación server-side.
- La reutilización de `sessions` fue suficiente; no apareció ninguna necesidad de cambiar schema.
- Un `run:status` real con `originatedFromRunId` confirmó compatibilidad con el circuito de
  escalamiento ya implementado.
- Se conserva el riesgo residual aceptado en diseño: un crash entre reemplazar el archivo nuevo y
  revocar best-effort la sesión anterior puede dejar ambas filas activas hasta el TTL.

---

## 4. Lecciones Aprendidas (`06-DELIVERY-WORKFLOW.md`, Stage 6)

### Conocimiento específico de esta Feature/implementación

- **Desviación real de proceso**: el commit `91e1dd5` se hizo directamente sobre `main`, sin una
  rama propia de FEATURE-014. Esto viola explícitamente la Secuencia de Branching y Merge de
  `docs/playbook/06-DELIVERY-WORKFLOW.md`: todo el trabajo de una Feature debe permanecer en su
  rama y nunca commitearse directamente en `main`.
- Causa operativa: el agente de desarrollo no verificó la Secuencia de Branching al pasar del
  Approval Gate a implementación y continuó trabajando sobre la rama que ya estaba activa.
- Corrección esperada: para la próxima Feature, crear la rama desde `main` como parte del Stage 3
  (Approval Gate), **antes** de iniciar cualquier implementación, y declarar el checkout de
  origen. No intentar corregir esta Feature reescribiendo historia: el código ya fue aprobado,
  validado y mergeado en la práctica.
- La prueba de restaurar una copia del archivo después del logout fue la evidencia operativa más
  directa del beneficio de seguridad; complementó los tests sin duplicarlos.

### Decisiones de arquitectura del proyecto

- CLI y web quedan sobre una única tabla, TTL y contrato criptográfico. La diferencia entre ambos
  canales se limita al transporte del secreto (archivo local vs. cookie HTTP-only).
- No se requiere ADR adicional: esta arquitectura fue aprobada en el diseño de FEATURE-014 y esta
  entrega la implementa sin introducir una decisión nueva.

### Candidato a conocimiento reusable del AI-Playbook Base

- **Ninguno.** La regla de branching ya era explícita y suficiente; el problema fue no seguirla,
  no una carencia del Playbook. La desviación se conserva en el contexto de FEATURE-014 y no
  justifica modificar el baseline.

---

## 5. Conclusión

FEATURE-014 queda cerrada y ejecutada. CLI y web usan sesiones server-side compartidas con TTL de
48 horas; logout revoca realmente la credencial y una copia local restaurada no puede recuperar
acceso. La regresión automatizada y la validación real en VPS pasaron. No quedan acciones
funcionales pendientes para esta Feature; la desviación de branching queda registrada con su
corrección obligatoria para el siguiente ciclo.

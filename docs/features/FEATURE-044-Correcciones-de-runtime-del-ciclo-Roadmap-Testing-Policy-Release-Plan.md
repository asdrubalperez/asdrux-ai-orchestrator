# FEATURE-044 — Correcciones de runtime del ciclo Roadmap / Testing Policy / Release Plan

Versión: v1.0 (cierre)
Origen: bloque correctivo descubierto durante la validación E2E real de un release con dos
Features (`calculateTip`/`calculateSplitTip`), con Roadmap y Testing Policy ya configurados —
mismo patrón que los bloques correctivos de FEATURE-019/020/021: no una Feature de producto nueva,
sino una serie de bugs reales encontrados al ejercitar por primera vez un camino de ejecución que
las Features anteriores (F035/F037/F038) dejaron sin cubrir end-to-end.

## Motivación

Todo surgió de un mismo objetivo de prueba: validar que un release con **más de una Feature**,
donde la segunda tiene una ambigüedad de contrato real que se resuelve a mitad de camino, corre de
punta a punta sin intervención manual innecesaria. Ese escenario nunca se había ejercitado
completo — cada bug encontrado bloqueaba el siguiente hasta corregirlo.

## Hallazgos y fixes (orden cronológico de descubrimiento)

1. **Architect re-escalaba la aprobación de un Roadmap ya aprobado.** Dos causas distintas,
   corregidas en dos pasadas:
   - Reingreso por escalamiento ajeno (Architect pasa por el circuito sin que el escalamiento sea
     suyo, corrige algo real de paso): no tenía excepción para "el Roadmap resultante es idéntico
     al ya aprobado".
   - Reingreso corrigiendo su propia ambigüedad (Regla 2): no tenía ninguna señal de que el
     proyecto ya tuviera un Roadmap aprobado.
   - Fix final: `existingRoadmapApproval` — el Roadmap vigente real (no un mensaje a interpretar)
     se le entrega a Architect en **cualquier** invocación; la Regla 4 compara estructura (releases
     por id, estado, `activeReleaseId`) contra ese dato, ignorando redacción, en vez de depender de
     que el LLM infiera de la conversación si algo "ya fue aprobado".

2. **Testing Policy nunca se persistía ni llegaba resuelta a Planning.** La sección "⚙️ PROJECT
   CONFIGURATION" de `04-TESTING-POLICY.md` llegaba a Planning siempre como el template estático
   sin completar (placeholders `[Editable por producto]` literales) — ningún código la persistía
   nunca. Fix: nuevo contrato `TESTING_POLICY_CONFIG` que Architect declara junto con el Roadmap,
   persistido en `project_config_versions` en el mismo momento de la aprobación humana, entregado
   a Planning como `governance.testingPolicyConfig` ya resuelto.

3. **Documentos canónicos fallaban con `EEXIST`** al materializarse en un worktree cuyo branch
   base ya tenía el documento commiteado de un run anterior — el flag de escritura (`"w"` vs
   `"wx"`) se decidía según `document_hash` de la fila en DB, que describe el ciclo de vida de la
   fila, no el del archivo en el filesystem del worktree (dos ciclos de vida independientes). Fix:
   los 4 lifecycles (Feature/Project Brief/Architecture/Release Plan) siempre sobrescriben.

4. **Planning perdía la finalización de una Feature cuando escalaba por la siguiente.**
   `persistReleasePlanIfDeclared` solo persistía algo cuando Planning terminaba con
   `ESTADO: completed` — si recibía `featureJustCompleted` pero escalaba por una ambigüedad real de
   la Feature siguiente, esa finalización se perdía en silencio hasta que Planning lograra, en
   algún turno futuro, declarar un `RELEASE_PLAN` íntegro con ambas resueltas. Causa raíz confirmada
   de un loop de "Feature ya activada" y del ícono de Feature que nunca pasaba a completado en la
   UI. Fix: marcado determinístico de la Feature completada directamente sobre el `inputReleasePlan`
   de entrada, sin depender de que el LLM lo redeclare.

5. **SSE — dos hallazgos independientes:**
   - El indicador "SSE activo" estaba hardcodeado (no leía `EventSource.readyState`).
   - Cada notificación de Postgres disparaba su propio snapshot sin serializar por `runId` — un
     escalamiento dispara dos notificaciones casi seguidas (insert de evento, luego update de
     status) sin garantía de orden entre sus queries concurrentes, dejando a veces el último
     snapshot desactualizado.

6. **Extracción de JSON en texto plano truncaba valores con saltos de línea reales.** El regex de
   una sola línea (`[^\n]+`) usado para extraer cualquier tag de la salida de Codex cortaba en
   silencio cualquier valor JSON que el modelo terminara emitiendo con un salto de línea real
   adentro (payloads grandes tienen más superficie para esto pese a la instrucción de "una sola
   línea") — síntoma: `JSON.parse` fallando con "Expected ',' or '}'" justo al final del texto
   capturado. Fix: extracción consciente de llaves/corchetes balanceados antes de caer al regex de
   una sola línea.

7. **Auto-navegación al run hijo — dos iteraciones:**
   - Primero: cuando el reingreso cross-pipeline resuelve un escalamiento y crea un run hijo sin
     ninguna acción humana, el usuario quedaba viendo el run viejo ya resuelto sin ninguna señal de
     a qué run seguir.
   - Regresión real del fix anterior: navegaba siempre que hubiera `childRunId`, sin distinguir
     "el hijo apareció mientras miraba esta página" de "abrí a propósito un run viejo del historial"
     — hacía imposible revisar cualquier run histórico. Fix: función pura (`nextChildRunFollowState`,
     con tests) que solo navega ante una transición en vivo, no ante la primera observación de un
     run ya resuelto.

8. **Condición de carrera: el run padre se marcaba terminado antes de que el run hijo existiera.**
   En los dos caminos de continuación automática (reingreso a Architect, continuación Auto tras
   merge), el estado terminal del padre se marcaba ANTES de crear el hijo — el notify de Postgres
   sobre el padre podía dispararse (y el frontend reconsultar `childRunId`) antes de que la fila del
   hijo terminara de commitearse (crear el worktree es trabajo real de git). Como nada vuelve a
   tocar la fila del padre después, esa era la única oportunidad y a veces se perdía. Fix: el hijo
   se crea primero, el padre se marca terminado después.

9. **Functional redeclaraba Features ya activadas al recibir la propuesta de Architect por el
   camino normal.** Cuando el reingreso a Architect resuelve una ambigüedad de Regla 2 y Architect
   declara `completed` con una propuesta fresca, Functional la recibe por el camino normal
   (`functionalArtifact`), no por reingreso con `escalationReason`/`targetAgentRole` — su Regla 4
   ("primera invocación, batch completo") no distinguía esto de un release genuinamente nuevo, y
   redeclaraba todas las Features del release, incluidas las ya activadas e implementadas en un run
   anterior. Fix: `existingFeatures` (Features ya activadas del release vigente) entregado a
   Functional en cualquier invocación, mismo criterio que `existingRoadmapApproval`.

## Principio común a todos los fixes

Cada uno reemplaza una dependencia de que el LLM infiera/recuerde algo de la conversación por un
dato determinístico que el backend le entrega explícitamente (`existingRoadmapApproval`,
`existingTestingPolicyConfig`, `existingFeatures`, `childRunId`) o por una corrección de orden de
operaciones que elimina la ventana de carrera en sí (documentos canónicos, notify del run padre).
Ninguno depende de que el modelo "se acuerde" de algo — todos mueven la fuente de verdad al backend.

## Validación

E2E real en VPS, múltiples corridas hasta agotar el catálogo de bugs: ciclo completo de dos
Features del mismo release (`calculateTip`/`calculateSplitTip`), incluida una ambigüedad de
contrato funcional real resuelta a mitad de camino (regla de negocio no cubierta por el caso
original), aprobación de Roadmap y Testing Policy una sola vez, cierre de release propuesto
correctamente al agotar las Features. Cobertura automatizada: 336/336 tests (incluye 12 tests
nuevos específicos de esta Feature — extracción balanceada de JSON con reproducción exacta del
bug, y navegación de `childRunId` con reproducción exacta de la regresión).

Cada fix individual está documentado con su hallazgo, causa raíz y verificación en los commits de
la rama `fix/testing-policy-persistence-y-reescalacion-roadmap` (mergeada a `main`).

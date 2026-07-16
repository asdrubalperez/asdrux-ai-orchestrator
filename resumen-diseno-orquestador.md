# Orquestador de workflow para desarrollo asistido por IA — resumen de diseño

## 1. Objetivo del sistema

Automatizar el ciclo completo de trabajo que hoy se hace manualmente con el playbook (00-README a 08-CODE-SYSTEM-PROMPT): desde un caso de negocio ya relevado hasta una PR probada y lista para mergear — con intervención humana **solo** en los puntos donde hay ambigüedad real, no en cada paso.

No es un sistema autónomo sin supervisión. Es un pipeline de fases con **gates humanos obligatorios**, más liviano y auditable que alternativas tipo Piper/Pied-Piper.

## 2. Arquitectura en 3 capas

- **UI** — portal web donde se dispara el pipeline y se visualiza el progreso en vivo. No contiene lógica de negocio, solo muestra estado.
- **Orquestador** — máquina de estados que invoca cada fase, persiste el estado, decide transiciones (avanzar, rechazar, escalar). Es el único componente que conoce la secuencia completa (modelo de **orquestación**, no de coreografía).
- **Executor** — capa de adaptador que traduce las invocaciones del Orquestador hacia la herramienta de código real (Claude Code, Codex). Intercambiable sin tocar las otras dos capas.

Cada capa se diseñó para no conocer los detalles internos de la siguiente — el Orquestador no sabe qué hay detrás del Executor, y la UI no sabe cómo se decide una transición, solo la refleja.

## 3. Agentes del pipeline

Secuencia: **Architect → Functional → Planning → Developer ↔ QA → Finalización**

- **Architect** — entiende la arquitectura y el sistema existente, diseña cómo integrar lo nuevo.
- **Functional** — descompone el pedido en funcionalidades, identifica subsistemas y dependencias.
- **Planning** — arma el plan de trabajo y casos de prueba; actúa como un PM — no ejecuta ni prueba, pero secuencia el trabajo y gatea el avance de una unidad a la siguiente.
- **Developer** — implementa contra el plan aprobado.
- **QA** — valida contra los casos de prueba. Si rechaza, vuelve a Developer con feedback (con límite de reintentos, ver sección 6).
- **Governor** — no es un agente separado, es un **protocolo de escalamiento** incorporado a cada rol: ante ambigüedad o una decisión que no le corresponde, el sistema para y pregunta al humano en vez de asumir.

## 4. Modelo de coordinación: orquestación

El Orquestador **invoca activamente** a cada agente (nunca los agentes se autoconvocan). El ciclo por fase:

1. Invoca al agente actual con contexto y tarea
2. El Executor lo ejecuta (Claude Code / Codex)
3. El Orquestador evalúa el resultado contra criterios de salida
4. Si requiere validación humana → pausa y notifica
5. Si no → avanza al siguiente agente según la definición del pipeline

La secuencia (incluyendo ramas condicionales, como el rechazo de QA) vive como **datos versionados**, no como código embebido — se puede ajustar el flujo sin tocar el motor.

## 5. Persistencia

Cuatro tablas cubren el estado del sistema:

- **pipeline_definitions** — la "receta": secuencia de fases y reglas de transición, versionada.
- **runs** — una corrida concreta: en qué fase está, quién es el dueño (`owner_id`), contra qué versión de la receta corre.
- **run_events** — log append-only de todo lo ocurrido; sirve de auditoría y permite reconectar el portal sin perder eventos (`Last-Event-ID`).
- **artifacts** — lo que produce cada agente. Artefactos de diseño (specs, planes) se guardan como texto/JSON directo; artefactos de código no se duplican en la base — se referencian por commit/PR, dejando a git como fuente de verdad.

**Multiusuario**: cada run tiene un dueño; el canal de eventos (SSE) se filtra por run y por dueño. Un rol admin puede consultar runs de cualquier usuario — mismo dato, distinto alcance de consulta. No hace falta un broker de mensajes (Redis, etc.) mientras el sistema sea de un equipo chico — un emisor en memoria alcanza.

**Tiempo real**: Server-Sent Events (no WebSockets — el tráfico es asimétrico: el Orquestador empuja muchos eventos, el usuario manda pocas acciones). Al abrir el portal: snapshot inicial (`GET /runs/{id}`) + stream de deltas incrementales.

## 6. Reglas de negocio clave

- **Límite de reintentos QA ↔ Developer: 3.** Rechazo 1 y 2 dan a Developer dos oportunidades reales de corregir; al tercer rechazo, el sistema escala en vez de reintentar — no converge solo.
- **Retención de runs escalados sin retomar: 21 días** (dos semanas, más margen para que alguien que volvió de vacaciones lo retome en la tercera semana). Pasado ese plazo, el run se archiva/limpia.

## 7. Contrato Executor

Interfaz uniforme entre Orquestador y cualquier herramienta de código:

```typescript
interface Executor {
  runPhase(
    invocation: PhaseInvocation,
    options: { signal?: AbortSignal; onEvent?: (e: ExecutorEvent) => void; timeoutMs?: number }
  ): Promise<PhaseResult>;
}

interface PhaseInvocation {
  agentRole: "architect" | "functional" | "planning" | "developer" | "qa";
  roleInstructions: string;   // system prompt fijo del playbook, por rol
  context: unknown;           // artefactos de fases anteriores que esa fase necesita
  permissions: {
    filesystem: "read-only" | "workspace-write";
    writableRoots?: string[];
    allowedCommands?: string[];
  };
}

interface PhaseResult {
  status: "completed" | "rejected" | "failed" | "interrupted" | "escalated";
  outputArtifact: unknown;
  summary: string;             // narrativa curada, no el log crudo de herramienta
  escalationReason: string | null;
}
```

Puntos verificados contra documentación oficial (Claude Code y Codex, julio 2026): ambas herramientas soportan invocación headless, streaming de progreso, permisos configurables por invocación y system prompt/rol distinto por invocación. El timeout de fase completa lo impone el Orquestador/Executor, no el proveedor. Términos propios de cada proveedor (`permissionMode`, `sandboxPolicy`, `developer_instructions`, etc.) quedan encapsulados dentro de cada adaptador — nunca se filtran al contrato común.

**"Solo lectura" no puede depender solo del prompt** — se impone combinando prompt de rol + herramientas habilitadas + sandbox de filesystem + política de comandos.

## 8. Aislamiento por run

Dos problemas distintos, dos mecanismos:

- **Aislamiento de código** — cada run crea su propia rama y su propio `git worktree` al iniciar. Corridas concurrentes no se pisan; liviano porque comparte el mismo repositorio de objetos git.
- **Aislamiento de ejecución** — Developer y QA corren en contenedor, con acceso limitado al worktree de ese run únicamente. El `writableRoots` del contrato Executor siempre apunta ahí, nunca al repo principal.

Fases de diseño (Architect, Functional, Planning) trabajan en modo solo lectura sobre ese mismo worktree. Al finalizar: push, PR y limpieza del worktree. Si un run escala, el worktree se mantiene vivo hasta que el humano lo resuelve (no se limpia mientras espera validación).

## 9. Capa UI — tres pantallas

1. **Disparo** — lista los casos de negocio ya relevados (desde la app de business case existente) listos para iniciar un run con un click; opción de pegar input manual como salida alternativa.
2. **Run en curso** — avatar por agente con estado en vivo (completado, trabajando, escalado), panel de actividad con narrativa curada (no logs crudos), banner de validación cuando el protocolo de escalamiento se dispara.
3. **Historial / admin** — lista de runs propios (o de todo el equipo, si el rol es admin), con estado, dueño, fase actual y tiempo transcurrido — la base de la auditoría del punto 5.

## 10. Pendientes / próximos pasos

- Elegir stack técnico concreto (lenguaje/framework del Orquestador, SQLite vs Postgres para arrancar)
- Definir el mecanismo exacto de invocación headless en la práctica (Agent SDK vs CLI para Claude Code; App Server vs `codex exec` para Codex)
- Diseñar la política de limpieza automática de worktrees/branches abandonados (disparada por el vencimiento de 21 días)
- Validar el primer flujo end-to-end con un caso de negocio real, antes de sumar al resto del equipo

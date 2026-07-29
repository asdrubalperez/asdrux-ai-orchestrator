# FEATURE-023 — Diagnóstico del fallo E2E y del Roadmap/Release Plan precargado

Fecha: 2026-07-28

Run analizado: `f1cd4011-4c0d-4b00-be92-28c516cbd7b7`

Rama del Orquestador: `codex/feature-023-lifecycle`

SHA analizado: `9daaa7e7ca1d9c1405ad96ab1caa87deb80e1010`

## Resumen ejecutivo

La ejecución falló por un defecto nuevo y bloqueante de FEATURE-023: el runtime busca
`docs/runbook/07-FEATURE-TEMPLATE.md` dentro del repositorio gestionado. El run trabaja sobre
`tempo-auto-planner`, que no contiene el Runbook interno del Orquestador, por lo que la
persistencia posterior a Functional termina con `ENOENT`.

El Roadmap y el Release Plan precargados responden a dos deudas ya registradas:

1. FEATURE-028: `release_plan` no está asociado de forma inequívoca al Release activo.
2. FEATURE-030: el proyecto persistido puede ser el proyecto más antiguo del usuario aunque el
   caso de negocio use otro repositorio.

En este run el Roadmap visible es la versión aprobada por el run raíz actual; no es una versión
histórica anterior. El Release Plan sí es anterior y quedó combinado con el Roadmap nuevo porque
ambos usan el identificador genérico de release `r1`.

## 1. Evidencia del fallo

El run quedó así:

```text
status: failed
current_phase: functional
branch: run/f1cd4011-4c0d-4b00-be92-28c516cbd7b7
worktree:
/home/asdru/ai-orchestrator-case-clones/ai-orchestrator-worktrees/
f1cd4011-4c0d-4b00-be92-28c516cbd7b7
```

El worktree es un clon real de:

```text
git@github.com:asdrubalperez/tempo-auto-planner.git
```

En ese repositorio no existe:

```text
docs/runbook/07-FEATURE-TEMPLATE.md
```

FEATURE-023 construye actualmente la ruta de esta forma:

```ts
const templatePath = path.join(
  params.worktreePath,
  "docs",
  "runbook",
  "07-FEATURE-TEMPLATE.md"
);
```

Por ello intentó abrir:

```text
/home/asdru/ai-orchestrator-case-clones/ai-orchestrator-worktrees/
f1cd4011-4c0d-4b00-be92-28c516cbd7b7/docs/runbook/07-FEATURE-TEMPLATE.md
```

La lectura falla antes de abrir la transacción de lifecycle.

## 2. Secuencia exacta observada

1. Architect completó.
2. Functional completó y produjo correctamente el lote de tres Features.
3. El runtime registró `phase_finished` y el artifact de Functional.
4. El postprocesamiento de FEATURE-023 intentó cargar el template desde el repositorio gestionado.
5. `readFile` devolvió `ENOENT`.
6. El run pasó a `failed`; Planning no fue invocado.

La salida funcional no causó el error. El fallo está en la resolución del template posterior a la
fase.

## 3. Causa raíz de FEATURE-023

Se confundieron dos repositorios con responsabilidades distintas:

- Repositorio del Orquestador: contiene la definición operativa versionada del Runbook.
- Repositorio gestionado: recibe el documento materializado en `docs/features/`.

El template debe provenir de una fuente versionada y confiable del Orquestador. El worktree del
caso debe utilizarse como destino del documento, no como fuente obligatoria del Runbook.

### Clarificación de ownership y disponibilidad del Runbook

El repositorio que el usuario proporciona para desarrollar su caso de negocio y los activos
internos de Asdrux AI Orchestrator son dominios distintos.

El Runbook es un activo del producto Orquestador. Actualmente vive en
`asdrubalperez/asdrux-ai-orchestrator/docs/runbook/` porque el producto todavía se ejecuta desde su
checkout de desarrollo. Ese detalle no constituye un contrato válido para producción.

En una instalación productiva, el Orquestador debe poder resolver siempre una versión íntegra,
compatible y verificable del Runbook aunque:

- el repositorio gestionado no tenga `docs/runbook/`;
- el proceso no se ejecute desde un clon Git del Orquestador;
- el directorio de trabajo sea el worktree aislado de un caso;
- el producto se distribuya como servicio, imagen, paquete o instalación desplegada.

La decisión pendiente no es si el Runbook debe estar disponible — eso es obligatorio — sino cuál
es su contrato de distribución y resolución en runtime.

### Estado real de la documentación y del Roadmap

La documentación ya expresa parcialmente la intención:

- `docs/runbook/00-README.md` llama a `docs/runbook/` la copia de referencia del Orquestador.
- `docs/runbook/03-AI-CONSTITUTION.md` define una plantilla de referencia única que evoluciona con
  el propio Orquestador.
- `docs/runbook/BOOTSTRAP.md` indica que el producto debe copiar o inicializar el Runbook de
  referencia para cada producto gestionado.

Sin embargo, `BOOTSTRAP.md` también afirma que la ubicación técnica exacta de la copia del Runbook
y de los artefactos por producto es “un pendiente de diseño ya registrado en el Roadmap”. La
revisión del Roadmap actual no encontró un ítem explícito que cubra:

- empaquetado del Runbook con el producto;
- ruta o mecanismo de lookup en runtime;
- manifiesto de versión y compatibilidad;
- validación de integridad al iniciar;
- actualización del Runbook al desplegar una nueva versión del Orquestador;
- separación entre baseline del producto y configuración/artefactos por proyecto.

Los ítems existentes no sustituyen esta definición:

- `Deployment Strategy y separación dev/staging/prod` es tentativo, amplio y está sin diseñar.
- FEATURE-033, FEATURE-034 y FEATURE-035 definen lifecycle de entregables concretos, no
  distribución del Runbook base.
- FEATURE-009 creó el contenido del Runbook, pero no implementó su packaging productivo.

Por tanto, existe una contradicción documental: el Runbook dice que el pendiente está registrado,
pero el Roadmap no lo identifica inequívocamente.

### Brecha de pruebas

La suite automatizada pasó porque no ejercitó este contrato con un repositorio gestionado externo
que careciera de `docs/runbook/07-FEATURE-TEMPLATE.md`. El E2E real pendiente de FEATURE-023 era la
primera validación que combinaba:

- runtime del Orquestador;
- clon independiente de otro repositorio;
- persistencia real del lote Functional.

## 4. Roadmap mostrado

El run está ligado en DB a:

```text
project_id: 8413e8e3-7de5-44e6-b380-d8e131027259
project_name: asdrux-ai-orchestrator
project_repo_path: /home/asdru/ai-orchestrator
```

Sin embargo, su repositorio de trabajo real es `tempo-auto-planner`.

El Roadmap vigente mostrado en UI fue creado por el run raíz actual:

```text
changed_in_run_id: 0737009e-a8d0-4216-ba11-1cf14689a59a
valid_from: 2026-07-29T00:01:08.681Z
activeReleaseId: r1
nombre: MVP - Optimización de equipo uno por uno
```

Por tanto, en este caso concreto el Roadmap no es una versión histórica previa: es el Roadmap que
Architect mantuvo y que el usuario aprobó en el circuito raíz inmediatamente anterior al child
run fallido.

## 5. Release Plan stale mostrado

El `release_plan` vigente sí precede al run actual:

```text
changed_in_run_id: 7b5ec7ac-ae53-4e0d-a589-f6030fc86522
valid_from: 2026-07-28T03:46:58.767Z
featureActualId: f2
ramaBaseTrabajo: tempo-auto-planner-e2e-test-2
```

Contiene las Features visibles en la captura:

- Descubrimiento de contrato Tempo.
- TeamRosterGateway.
- Extensión de CLI.
- Reutilización del flujo individual.
- Manejo de errores por colaborador.

El runtime mantiene un único `release_plan` vigente por `project_id`. La UI reconstruye la
asociación con un release usando el `activeReleaseId` del Roadmap fijado al run que escribió el
plan. Como tanto el Roadmap anterior como el nuevo usan `r1`, el plan anterior queda presentado
dentro del Roadmap nuevo.

## 6. Deuda ya documentada

### FEATURE-028 — Release Plan asociado al Release activo

El Roadmap registra expresamente:

> Hoy existe un único `release_plan` vigente por proyecto y, al avanzar de Release, Planning puede
> recibir temporalmente el plan anterior.

Este run confirma el problema también en UI y en el snapshot entregado al run.

### FEATURE-030 — Proyecto asociado correctamente al repositorio gestionado

El fallback actual de `getProjectForUser` selecciona el proyecto más antiguo del usuario cuando no
recibe un `projectId` explícito. El Roadmap ya registra que esto puede mezclar Roadmaps, Release
Plans y estado persistido entre repositorios.

El run constituye evidencia directa: proyecto persistido `asdrux-ai-orchestrator`, repositorio
real `tempo-auto-planner`.

## 7. Clasificación

| Hallazgo | Clasificación | Relación con FEATURE-023 |
|---|---|---|
| Template leído desde el repositorio gestionado | Defecto bloqueante nuevo | Debe corregirse antes del merge |
| Release Plan anterior bajo el Roadmap nuevo | Deuda confirmada FEATURE-028 | Preexistente; no conviene absorberla implícitamente |
| Proyecto DB distinto del repositorio real | Deuda confirmada FEATURE-030 | Preexistente; contamina la validación |
| Functional figura completado antes del fallo técnico | Consecuencia del orden actual de persistencia | Debe cubrirse al corregir el flujo o su observabilidad |

## 8. Recomendación

Antes de corregir FEATURE-023, fijar un contrato mínimo de runtime para el Runbook. Debe decidir:

1. cuál es la fuente autoritativa instalada junto al producto;
2. cómo se obtiene su ruta sin depender del `cwd` ni del repositorio gestionado;
3. cómo se identifica y valida la versión activa;
4. qué contenido es baseline inmutable y qué contenido se persiste o personaliza por proyecto;
5. qué comportamiento fail-closed corresponde si el Runbook no está disponible o está
   incompleto.

Con ese contrato fijado, aplicar en FEATURE-023 el cambio mínimo:

1. resolver el template mediante el proveedor de Runbook del Orquestador, independiente del
   repositorio gestionado;
2. mantener el worktree gestionado únicamente como destino de `docs/features/`;
3. agregar un test de integración con un repositorio externo sin carpeta `docs/runbook`;
4. repetir el E2E real antes del merge.

El contrato productivo completo merece un ítem explícito y confirmado en el Roadmap, con un nombre
como “Distribución, versionado y disponibilidad del Runbook en runtime”. Debido a que el fallo
actual bloquea FEATURE-023, su contrato mínimo de resolución debe definirse ahora; los aspectos de
deploy y actualización operacional pueden completarse en esa Feature específica sin ampliar
implícitamente FEATURE-023.

FEATURE-028 y FEATURE-030 deben conservarse como Features separadas. Para una nueva validación E2E
limpia puede prepararse un proyecto correctamente asociado y sin configuración histórica, pero
alterar o borrar los datos actuales sería una operación de entorno, no una corrección del producto,
y requiere decisión explícita del owner.

## 9. Acciones no realizadas

- No se modificó código.
- No se modificó la base de datos.
- No se borraron Roadmaps ni Release Plans.
- No se reintentó el run.
- No se creó commit ni se hizo push.

## 10. Decisión posterior del owner

El owner suspendió las pruebas de FEATURE-023 Parte 1. Se crea FEATURE-023 Parte 2, sin renumerar
las Features posteriores, para diseñar la distribución, versionado y disponibilidad del Runbook en
runtime.

La siguiente prueba funcional será conjunta y cubrirá FEATURE-022, FEATURE-023 Parte 1 y
FEATURE-023 Parte 2.

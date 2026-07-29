# FEATURE-023 — Parte 2 — Distribución, versionado y disponibilidad del Runbook en runtime

## 1. Feature Identity

* **Name:** FEATURE-023 — Parte 2 — Distribución, versionado y disponibilidad del Runbook en
  runtime
* **Type:** Arquitectura / Runtime / Distribución de assets
* **Owner:** Asdru — Product Owner
* **Design Owner:** DAIA
* **Implementation Owner:** DAIA
* **Status:** Implementada en rama — pendiente de validación del owner
* **Priority:** P0
* **Playbook Mode:** Full
* **Approval Gate:** Aprobado por el owner el 2026-07-28
* **Implementation:** Completada en la rama autorizada
* **Branch de implementación:** `codex/feature-023-runbook-runtime-part-2`
* **Checkout de origen:** `main` en `639426e`

---

# 2. Problem Statement

Asdrux AI Orchestrator trabaja sobre un repositorio proporcionado por el usuario. Ese repositorio
gestionado es distinto del código y de los activos internos del Orquestador.

El Runbook es la guía de ejecución propia de Asdrux AI Orchestrator. Hoy vive en
`docs/runbook/` del repositorio del Orquestador porque el producto todavía se ejecuta desde un
checkout de desarrollo. Esto no define cómo estará disponible en una instalación productiva.

La primera prueba E2E de FEATURE-023 Parte 1 intentó leer
`docs/runbook/07-FEATURE-TEMPLATE.md` desde el worktree de `tempo-auto-planner`. La ruta no existía
y el run falló con `ENOENT`.

El defecto inmediato es:

> El Orquestador debe resolver y leer su propio Runbook desde una ubicación perteneciente a la
> instalación del producto, independientemente del `cwd`, del worktree y del repositorio
> gestionado.

La v1 no debe convertirse en una plataforma genérica de distribución, un sistema remoto de
Runbooks ni un framework de upgrades.

---

# 3. Functional Goal

Asdrux AI Orchestrator debe distribuir su Runbook como assets read-only del producto y consumirlos
mediante un único proveedor interno.

El runtime debe:

* localizar los assets respecto de la instalación;
* validar disponibilidad, lectura, path seguro y versión;
* calcular SHA-256 sobre el template realmente leído;
* entregar contenido y metadata validada a FEATURE-023 Parte 1;
* fallar sin buscar copias alternativas en el repositorio gestionado.

El repositorio del usuario debe contener únicamente los documentos propios del producto gestionado
en las rutas canónicas definidas por esta Feature.

---

# 4. Scope

## Included

* Runbook empaquetado como assets read-only de Asdrux AI Orchestrator.
* Resolución respecto de la instalación, independiente del `cwd` y del worktree.
* Una única abstracción interna `RunbookProvider`.
* Validación de archivos obligatorios, legibilidad, path seguro y versión explícita.
* Hash del asset efectivamente leído.
* Integración mínima con FEATURE-023 Parte 1.
* Persistencia existente de `template_version`, `template_hash` y `template_snapshot`.
* Pertenencia, cardinalidad y rutas canónicas iniciales de documentos gestionados.
* Validación completa de los assets obligatorios durante el startup del servidor.
* Validación transversal del template antes de toda transacción documental.
* Pruebas proporcionales y E2E conjunto de FEATURE-022 y ambas partes de FEATURE-023.
* Actualización de `docs/runbook/BOOTSTRAP.md` como parte de la implementación de esta Feature.

## Excluded

* Distribución remota o descarga dinámica.
* Múltiples fuentes, fallbacks u overrides complejos.
* Firmas criptográficas y almacenamiento administrado.
* Manifiesto general con hashes de todos los archivos.
* Rangos sofisticados de compatibilidad.
* Framework de upgrades, rollback o migración de runs activos.
* Health checks avanzados.
* Nuevos mounts o permisos para workers.
* Lifecycle de Project Brief, Architecture o Release Plan.
* FEATURE-028, FEATURE-030 y el diseño completo de deployment.
* Reanudación del E2E antes de aprobar e implementar esta Parte 2.

## Future Ideas

* Firma del paquete.
* Distribución remota y descarga dinámica.
* Múltiples fuentes, fallbacks y overrides operativos.
* Manifiesto completo y rangos de compatibilidad.
* Upgrades coordinados, rollback y pinning general.
* Health checks avanzados.
* Acceso directo de workers, solo ante una necesidad futura demostrada.

Estas ideas no forman parte de la v1.

## Mapa canónico de assets y documentos

### Activos de Asdrux AI Orchestrator

Pertenecen a la instalación del Orquestador:

* Runbook;
* templates;
* descriptores estructurales;
* instrucciones internas de los roles.

No se buscan en el repositorio gestionado, no se resuelven respecto del `cwd` y no pueden ser
reemplazados por archivos homónimos externos.

### Documentos del producto gestionado

| Documento | Ruta canónica | Cardinalidad | Lifecycle |
|---|---|---|---|
| Project Brief | `docs/project/PROJECT-BRIEF.md` | Uno por proyecto | FEATURE-033 |
| Architecture, incluido el Roadmap | `docs/architecture/ARCHITECTURE.md` | Uno por proyecto | FEATURE-034 |
| Release Plan | `docs/releases/<release-key>/RELEASE-PLAN.md` | Uno por release | FEATURE-035 |
| Feature | `docs/features/<feature-code>-<slug>.md` | Múltiples por proyecto | FEATURE-023 Parte 1 |

El Roadmap de Releases forma parte de `ARCHITECTURE.md`; no es un documento independiente.

Esta Parte 2 fija pertenencia y rutas. No absorbe los lifecycles de FEATURE-033, FEATURE-034 o
FEATURE-035.

---

# 5. Functional Rules

## Rule 1 — Fuente autoritativa

La fuente v1 son los assets read-only distribuidos con la instalación del Orquestador. El
repositorio gestionado nunca es fuente del Runbook.

## Rule 2 — Raíz confiable

La raíz del Runbook puede inyectarse por composición para tests, desarrollo, empaquetado, VPS o
producción, pero debe provenir exclusivamente de configuración confiable del proceso o de la
instalación.

No puede provenir de:

* agentes;
* repositorio gestionado;
* configuración editable del proyecto;
* business case;
* headers o payloads de usuario;
* `process.cwd()`.

## Rule 3 — Proveedor único

Toda lectura usa `RunbookProvider`. FEATURE-023 Parte 1 no puede construir una ruta de template
sobre `worktreePath`.

## Rule 4 — API mínima

El proveedor ofrece operaciones equivalentes a:

```text
readText(relativeAssetPath)
assertAvailable(requiredAssetPaths)
getRunbookVersion()
```

La lectura entrega:

```text
runbookVersion
assetRelativePath
assetHash
content
```

El hash se calcula sobre los bytes realmente leídos.

## Rule 5 — Path seguro

Solo se aceptan paths relativos dentro de la raíz del Runbook. Paths absolutos, `..`, traversal o
resolución fuera de la raíz deben rechazarse.

## Rule 6 — Versionado mínimo

La v1 usa una versión explícita, por ejemplo `RUNBOOK_VERSION = "1.0"`, implementada como
constante, archivo pequeño de metadata o metadata generada durante build.

No se requiere un manifiesto general.

## Rule 7 — Catálogo obligatorio por funcionalidad

Solo son obligatorios los assets consumidos por funcionalidades implementadas y habilitadas.

El catálogo cerrado v1 incluye como mínimo:

```text
VERSION
07-FEATURE-TEMPLATE.md
```

Debe agregar cualquier otro asset realmente consumido durante la validación conjunta de
FEATURE-022 y ambas partes de FEATURE-023. Archivos futuros no bloquean el startup solo porque
existan en `docs/runbook/`.

Cuando se implementen FEATURE-033, FEATURE-034 y FEATURE-035, sus templates se incorporarán al
catálogo obligatorio.

## Rule 8 — Validación completa en startup

Antes de considerar operativo el servidor, `RunbookProvider` debe validar:

1. raíz válida y segura;
2. `VERSION` existente, legible y soportada;
3. catálogo obligatorio actual completo;
4. todos los assets obligatorios legibles y dentro de la raíz;
5. SHA-256 calculable para cada asset obligatorio.

Si falla cualquier punto, el servidor no queda operativo ni acepta nuevos runs. No se requiere un
sistema avanzado de health checks: esta validación forma parte del startup normal.

## Rule 9 — Validación previa a persistencia documental

Todo template debe resolverse y validarse antes de abrir la transacción que persiste Project Brief,
Architecture, Release Plan o Features.

La validación previa:

* obtiene contenido, versión, path relativo y hash exactos;
* evita usar un asset desaparecido o alterado después del startup;
* entrega metadata confiable a la transacción.

FEATURE-033, FEATURE-034 y FEATURE-035 deberán heredar este contrato cuando implementen sus
lifecycles.

## Rule 10 — Fail-closed

Raíz inválida, versión ausente o no soportada, asset ausente o ilegible, path inválido, resolución
fuera de raíz o fallo de hash detienen el startup o la operación correspondiente.

No existe búsqueda respecto del `cwd`, fallback, contenido vacío, default, template alternativo,
persistencia parcial ni fase completada si dependía del asset.

Los errores deben seguir la convención existente o distinguir conceptualmente:

```text
RUNBOOK_ROOT_INVALID
RUNBOOK_VERSION_NOT_FOUND
RUNBOOK_ASSET_NOT_FOUND
RUNBOOK_ASSET_UNREADABLE
RUNBOOK_VERSION_UNSUPPORTED
RUNBOOK_ASSET_PATH_INVALID
```

## Rule 11 — Caso concreto de FEATURE-023 Parte 1

Antes de abrir la transacción del lote Functional:

1. solicitar `07-FEATURE-TEMPLATE.md`;
2. validar raíz, path, versión y lectura;
3. calcular SHA-256;
4. obtener `runbookVersion`, `assetRelativePath`, `assetHash` y `content`;
5. construir el descriptor o snapshot requerido por Parte 1.

Solo entonces se abre la transacción que persiste identities, revisions y artifacts.

Si falla la resolución, no se crean filas en `features` o `feature_revisions`, no se crean
artifacts canónicos y Functional no se registra como completado de forma engañosa. El error usa los
estados y eventos existentes.

`worktreePath` queda limitado a colisiones, destino documental, materialización y operaciones Git.
Nunca localiza el template.

Debe seguir persistiendo `template_version`, `template_hash` y `template_snapshot`.

## Rule 12 — Actualización

El Runbook cambia únicamente con una actualización explícita del producto, nunca silenciosamente
durante un run. Features existentes conservan snapshot, versión y hash.

No hay descarga remota, fallback de versión, rollback, migración de runs activos ni pinning
general en v1.

## Rule 13 — Workers

El host confiable resuelve el Runbook. La v1 no agrega mounts, permisos ni acceso directo a
workers.

## Rule 14 — BOOTSTRAP

La implementación debe actualizar `docs/runbook/BOOTSTRAP.md` para indicar:

* Runbook distribuido con la instalación;
* consumo mediante `RunbookProvider`;
* independencia del `cwd` y del repositorio gestionado;
* rutas canónicas de documentos del usuario;
* startup bloqueado solo por assets de funcionalidades habilitadas.

No debe quedar como una corrección futura ni como ubicación pendiente.

## Rule 15 — Validación conjunta

El E2E de Parte 1 continúa suspendido. La próxima validación funcional cubre FEATURE-022,
FEATURE-023 Parte 1 y FEATURE-023 Parte 2.

---

# 6. Estrategia Algorítmica

No aplica como algoritmo de optimización.

La resolución es determinista:

```text
runtime
  → RunbookProvider
  → raíz de assets de la instalación
  → versión y path validados
  → lectura
  → SHA-256
  → contenido y metadata
```

No existen fallbacks hacia el `cwd`, el worktree o el repositorio gestionado.

---

# 7. Technical Considerations

## 7.1 Distribución

El build o deployment incluye una copia read-only equivalente a:

```text
<installation-root>/
└── assets/
    └── runbook/
        ├── VERSION
        ├── BOOTSTRAP.md
        ├── 07-FEATURE-TEMPLATE.md
        └── demás archivos obligatorios
```

La ruta física puede adaptarse al empaquetado. El contrato estable es:

```text
RunbookProvider → asset interno de la instalación
```

## 7.2 Resolución

La raíz se deriva desde una referencia confiable del producto, no desde `process.cwd()`. Puede
inyectarse en composición para tests y empaquetado, pero no ser controlada por agentes, usuarios,
business cases, proyectos ni repositorios gestionados.

## 7.3 Metadata y catálogo mínimos

La opción preferida es `assets/runbook/VERSION`. Una constante o metadata de build es aceptable si
preserva el mismo contrato observable.

El catálogo obligatorio se mantiene cerrado en código y refleja únicamente funcionalidades
habilitadas. Inicialmente contiene `VERSION`, `07-FEATURE-TEMPLATE.md` y cualquier otro asset
realmente consumido por la validación conjunta.

No se introduce un manifest extensible.

## 7.4 Startup y operación

El servidor ejecuta `assertAvailable` sobre el catálogo obligatorio antes de quedar operativo. Los
assets distribuidos pero todavía no consumidos no bloquean startup.

Cada operación documental vuelve a leer y validar su template antes de abrir la transacción. La
validación de startup no sustituye esta lectura porque el asset podría haber desaparecido o
cambiado después del arranque.

## 7.5 Integración con Parte 1

`persistFunctionalFeatureBatch` deja de leer
`<worktreePath>/docs/runbook/07-FEATURE-TEMPLATE.md` y consume el asset del proveedor. El resto del
lifecycle de Parte 1 no se rediseña.

La resolución debe ocurrir antes de la transacción Functional y antes de registrar la fase como
completada.

## 7.6 Contrato heredable

FEATURE-033, FEATURE-034 y FEATURE-035 implementarán sus propios lifecycles, pero deberán resolver
y validar el template correspondiente antes de cada transacción documental.

## 7.7 BOOTSTRAP

Development actualizará `docs/runbook/BOOTSTRAP.md` dentro de esta Feature. La documentación deberá
reflejar el proveedor, los assets de instalación, el catálogo por funcionalidad y el mapa canónico
de documentos.

## 7.8 Observabilidad

Errores y mecanismos existentes pueden incluir código, `assetRelativePath`, versión, etapa y causa
técnica. No incluyen business cases, templates completos, contenido generado, secretos, tokens ni
credenciales.

Desarrollo, VPS y producción usan el mismo proveedor; solo cambia la ubicación física instalada.
Esta Feature no diseña el deployment completo.

---

# 8. Validation Criteria

## Startup

**Input:** iniciar el servidor con distintas instalaciones del Runbook.

**Expected output:**

1. raíz válida y segura;
2. `VERSION` existente, legible y soportada;
3. catálogo obligatorio completo;
4. todos sus assets legibles y dentro de raíz;
5. SHA-256 calculable;
6. startup bloqueado si falla cualquiera;
7. archivos distribuidos pero no consumidos no bloquean startup.

## Resolución

**Input:** resolver assets bajo condiciones normales y adversas.

**Expected output:**

8. mismo resultado desde distintos `cwd`;
9. repo gestionado sin `docs/runbook/` no afecta la lectura;
10. archivo homónimo externo no reemplaza el asset;
11. path absoluto rechazado;
12. `..` rechazado;
13. traversal codificado o normalizado rechazado;
14. resolución final fuera de raíz rechazada;
15. asset ilegible produce error controlado.

## Operaciones documentales

**Input:** ejecutar persistencia documental con template válido o inválido.

**Expected output:**

16. template de Feature validado antes de abrir la transacción Functional;
17. fallo de template no crea Feature, revisión o artifact canónico parcial ni completa Functional;
18. Project Brief hereda el contrato previo a transacción;
19. Architecture hereda el contrato previo a transacción;
20. Release Plan hereda el contrato previo a transacción;
21. FEATURE-033, FEATURE-034 y FEATURE-035 siguen siendo responsables de implementar esos
    lifecycles.

## Metadata

**Input:** leer y usar un template distribuido.

**Expected output:**

22. versión persistida correcta;
23. hash correspondiente a los bytes leídos;
24. snapshot correspondiente al template validado;
25. lecturas sin cambios producen el mismo hash.

## Rutas canónicas

**Input:** validar el destino declarado para cada documento gestionado.

**Expected output:**

26. Project Brief: `docs/project/PROJECT-BRIEF.md`;
27. Architecture y Roadmap: `docs/architecture/ARCHITECTURE.md`;
28. Release Plan: `docs/releases/<release-key>/RELEASE-PLAN.md`;
29. Feature: `docs/features/<feature-code>-<slug>.md`;
30. el Roadmap no se materializa en un archivo independiente.

Esta Parte 2 valida el mapa y la ruta de Feature existente, pero no ejecuta los lifecycles de
Project Brief, Architecture o Release Plan.

## Documentación

**Input:** documentación resultante de Development.

**Expected output:**

31. `docs/runbook/BOOTSTRAP.md` actualizado;
32. sin afirmaciones de que la ubicación del Runbook sigue pendiente;
33. separación Orquestador/repositorio gestionado preservada.

## E2E conjunto

**Input:** caso real controlado sobre un repositorio externo sin Runbook.

**Expected output:**

34. FEATURE-022 operativa;
35. FEATURE-023 Parte 1 operativa;
36. FEATURE-023 Parte 2 operativa;
37. repositorio externo sin Runbook;
38. template leído desde la instalación;
39. Feature materializada;
40. artifact leído desde otro rol;
41. commit y push;
42. SHA remoto;
43. recuperación UI;
44. continuidad según modo `manual` o `auto`.

### Validation Evidence

La evidencia combina tests unitarios de `RunbookProvider`, integración de startup y resolución,
atomicidad documental, validación de rutas y un E2E real conjunto con un provider real.

No se ejecutan todavía los lifecycles completos de Project Brief, Architecture o Release Plan.

---

# 9. Risks

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Acoplamiento al checkout | Falla al desplegar | Assets empaquetados y test con otro `cwd` |
| Raíz controlada por input externo | Sustitución del Runbook | Configuración exclusiva de la instalación/composición |
| Traversal | Lectura fuera del Runbook | Paths relativos y raíz cerrada |
| Fuente externa accidental | Reglas reemplazadas por el repo gestionado | Proveedor único sin fallback |
| Catálogo sobredimensionado | Assets futuros bloquean startup | Incluir solo funcionalidades habilitadas |
| Persistencia parcial | Fase engañosa o Feature incompleta | Validación antes de efectos |
| Expansión de alcance | Plataforma innecesaria | Mantener Future Ideas fuera de v1 |
| Absorber lifecycles posteriores | Duplica FEATURE-033/034/035 | Parte 2 solo fija pertenencia y rutas |

---

# 10. Approval Gate

## Estado

**APROBADO POR EL OWNER — 2026-07-28**

La v1 queda definida por:

1. assets read-only distribuidos con el producto;
2. raíz proveniente solo de configuración confiable;
3. `RunbookProvider` único;
4. versión mínima explícita;
5. hash calculado al leer;
6. catálogo cerrado según funcionalidades habilitadas;
7. validación completa en startup;
8. validación previa a toda transacción documental;
9. fail-closed sin fallback;
10. mapa canónico de documentos;
11. integración concreta con Parte 1;
12. actualización de `docs/runbook/BOOTSTRAP.md` durante Development;
13. validación conjunta con FEATURE-022.

No queda una decisión arquitectónica bloqueante dentro del alcance v1. El owner autorizó
Development sobre `codex/feature-023-runbook-runtime-part-2`, con checkout de origen `main` en
`639426e`, y confirmó el alcance documentado.

La autorización no incluye:

* merge ni push de `main` antes de la validación del owner;
* modificación de DB o Roadmap;
* expansión hacia FEATURE-028, FEATURE-030, FEATURE-033, FEATURE-034 o FEATURE-035.

---

# Design Principle

Runbook del Orquestador

↓

Assets read-only de la instalación

↓

`RunbookProvider`

↓

Versión, path, lectura y SHA-256

↓

Lifecycle documental

Nunca invertir este orden.

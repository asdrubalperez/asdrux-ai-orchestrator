# FEATURE-023 — Parte 2 — Distribución, versionado y disponibilidad del Runbook en runtime

## 1. Feature Identity

* **Name:** FEATURE-023 — Parte 2 — Distribución, versionado y disponibilidad del Runbook en
  runtime
* **Type:** Arquitectura / Runtime / Distribución de assets
* **Owner:** Asdru — Product Owner
* **Design Owner:** DAIA
* **Implementation Owner:** Pendiente de Approval Gate
* **Status:** Diseño en elaboración
* **Priority:** P0
* **Playbook Mode:** Full
* **Approval Gate:** Pendiente
* **Implementation:** Prohibida hasta aprobación explícita del owner
* **Branch de diseño:** `codex/feature-023-runbook-runtime-part-2`
* **Checkout de origen:** `main` en `639426e`

---

# 2. Problem Statement

## Separación de responsabilidades

Asdrux AI Orchestrator opera sobre un repositorio que el usuario proporciona para desarrollar su
caso de negocio. Ese repositorio gestionado es distinto del código y de los activos internos del
Orquestador.

El Runbook es la guía de ejecución propia de Asdrux AI Orchestrator. Actualmente su copia de
referencia vive en:

```text
docs/runbook/
```

dentro de `asdrubalperez/asdrux-ai-orchestrator`, porque el producto todavía se desarrolla y
ejecuta desde un checkout Git.

Ese detalle de desarrollo no define cómo el producto encontrará el Runbook cuando se distribuya o
ejecute en producción.

## Fallo observado

La primera prueba E2E de FEATURE-023 Parte 1 intentó leer:

```text
docs/runbook/07-FEATURE-TEMPLATE.md
```

desde el worktree de `tempo-auto-planner`, el repositorio gestionado. La ruta no existía y el run
falló después de Functional con `ENOENT`.

## Limitación estructural

Hoy no existe un contrato explícito y verificable que determine:

* cómo se distribuye el Runbook con el producto;
* cuál es su fuente autoritativa en una instalación;
* cómo se resuelve su ubicación sin depender del `cwd`;
* cómo se identifica su versión;
* cómo se valida su integridad y compatibilidad;
* cómo evoluciona al desplegar una nueva versión;
* qué parte es baseline global y qué parte corresponde a configuración o artifacts por proyecto.

`docs/runbook/BOOTSTRAP.md` declara esta ubicación técnica como pendiente ya registrado en el
Roadmap, pero antes de esta Parte 2 no existía un ítem inequívoco que lo cubriera.

---

# 3. Functional Goal

Asdrux AI Orchestrator debe poder resolver y consumir siempre un Runbook completo, compatible,
versionado y verificable como activo propio del producto, independientemente:

* del repositorio gestionado;
* de la rama o worktree del caso;
* del directorio actual del proceso;
* de si el runtime se ejecuta desde un checkout, paquete, imagen o instalación desplegada.

Cuando el Runbook requerido no esté disponible, esté incompleto o sea incompatible, el
Orquestador debe fallar de forma controlada antes de invocar agentes o persistir resultados
parciales dependientes de ese Runbook.

---

# 4. Scope

## Included

* Definir la fuente autoritativa del Runbook instalada con Asdrux AI Orchestrator.
* Definir el mecanismo único de resolución de assets del Runbook en runtime.
* Eliminar dependencias del `cwd` y del repositorio gestionado.
* Definir versionado, manifiesto, integridad y compatibilidad.
* Definir el contrato para desarrollo local, VPS y futura instalación productiva.
* Definir el comportamiento fail-closed cuando el Runbook no pueda validarse.
* Separar baseline global, configuraciones versionadas por proyecto y documentos materializados.
* Integrar el proveedor del Runbook con FEATURE-023 Parte 1.
* Corregir la contradicción de `docs/runbook/BOOTSTRAP.md`.
* Definir pruebas automatizadas y evidencia E2E conjunta para FEATURE-022 y ambas partes de
  FEATURE-023.

## Excluded

* Lifecycle de Project Brief, Architecture y Release Plan, reservado para FEATURE-033,
  FEATURE-034 y FEATURE-035.
* Rediseño del contenido funcional del Runbook.
* Solución de FEATURE-028 sobre Release Plan stale.
* Solución de FEATURE-030 sobre asociación entre proyecto y repositorio gestionado.
* Diseño completo de CI/CD o separación dev/staging/prod.
* Edición del baseline del Runbook por usuarios finales.
* Sincronización bidireccional entre Runbook global y documentos de repositorios gestionados.
* Reanudación del E2E antes de completar diseño, implementación y Approval Gate de esta Parte 2.

## Future ideas

* Firma criptográfica de paquetes del Runbook.
* Distribución remota centralizada para múltiples instalaciones.
* Política de upgrade coordinado entre runtime y Runbook.

Estas ideas no forman parte automáticamente de la primera versión.

---

# 5. Functional Rules

## Rule 1 — Ownership

El Runbook pertenece a Asdrux AI Orchestrator. Ningún repositorio gestionado es su fuente
autoritativa.

## Rule 2 — Disponibilidad

Toda operación que dependa del Runbook debe resolverlo mediante un componente propio del runtime,
nunca concatenando rutas sobre el worktree del caso.

## Rule 3 — Independencia del directorio de ejecución

La resolución debe producir el mismo resultado para cualquier `cwd`.

## Rule 4 — Versión explícita

El runtime debe conocer la versión del Runbook que consume. No se admite una carpeta sin identidad
de versión verificable.

## Rule 5 — Integridad

Los archivos obligatorios y su integridad deben poder validarse antes del uso.

## Rule 6 — Compatibilidad

La relación entre versión del runtime, versión del Runbook y versión de cada template debe tener
un contrato cerrado.

## Rule 7 — Fail-closed

Si falta un archivo obligatorio, el manifiesto es inválido o la versión es incompatible, el run no
debe continuar con defaults implícitos ni buscar el archivo en el repositorio gestionado.

## Rule 8 — Validación temprana

El error debe detectarse antes de invocar el primer rol que requiera el asset y, cuando sea
posible, durante el arranque o health check del servicio.

## Rule 9 — Baseline y estado por proyecto

El baseline global del Runbook no se mezcla con:

* configuraciones editables persistidas en `project_config_versions`;
* artifacts inmutables del proyecto;
* documentos materializados dentro del repositorio gestionado.

## Rule 10 — Destino documental

FEATURE-023 Parte 1 puede escribir el documento final de Feature en `docs/features/` del
repositorio gestionado. Esa escritura no convierte al repositorio gestionado en fuente del
template.

## Rule 11 — Desarrollo y producción

Desarrollo local, VPS y producción deben usar el mismo contrato de resolución. Puede variar la
ubicación física, pero no la semántica ni las validaciones.

## Rule 12 — Actualización controlada

Una nueva versión del Runbook se activa como parte de una actualización explícita del producto; no
se descarga ni cambia silenciosamente durante un run.

## Rule 13 — Observabilidad sin contenido sensible

Los errores y logs deben identificar versión, asset y causa técnica sin registrar business cases,
contenido generado por agentes ni secretos.

## Rule 14 — Pruebas suspendidas

El E2E de FEATURE-023 Parte 1 permanece suspendido hasta que esta Parte 2 sea aprobada e
implementada.

## Rule 15 — Validación conjunta

La siguiente validación funcional debe cubrir conjuntamente:

1. FEATURE-022;
2. FEATURE-023 Parte 1;
3. FEATURE-023 Parte 2.

---

# 6. Estrategia Algorítmica

No aplica como algoritmo de optimización.

El diseño sí deberá fijar una secuencia determinista de resolución:

```text
runtime
  → proveedor de Runbook
  → manifiesto y versión
  → validación de compatibilidad
  → validación de archivos e integridad
  → entrega de asset solicitado
```

No se permiten fallbacks implícitos hacia el `cwd`, el worktree del run o una ruta relativa
aportada por un agente.

---

# 7. Technical Considerations

## Decisiones de diseño pendientes

### 7.1 Forma de distribución

Evaluar y decidir entre:

* assets empaquetados con la aplicación o imagen;
* directorio absoluto instalado y configurado por deployment;
* almacenamiento persistente administrado por el producto;
* combinación acotada con una fuente primaria y un override operativo explícito.

### 7.2 Resolución de ubicación

Definir una API única, por ejemplo un `RunbookProvider`, que evite lecturas directas mediante
`path.join(worktreePath, "docs", "runbook", ...)`.

### 7.3 Manifiesto

Definir si el Runbook requiere un manifiesto con:

* versión del Runbook;
* versión mínima/máxima compatible del runtime;
* catálogo cerrado de archivos obligatorios;
* hash por archivo;
* versión de templates individuales.

### 7.4 Lifecycle de actualización

Definir cuándo se instala una nueva versión, cómo se valida antes de activarla y qué ocurre con
runs ya iniciados.

### 7.5 Contenedores y workers

Definir si los workers necesitan acceso directo a archivos del Runbook o si el host confiable debe
inyectar únicamente instrucciones/assets ya validados. No se ampliarán mounts ni permisos sin
necesidad demostrada.

### 7.6 Modelo de amenazas

El repositorio gestionado es contenido externo al Orquestador. Un archivo con el mismo nombre que
un asset del Runbook no debe poder reemplazar el baseline autoritativo.

### 7.7 Compatibilidad con FEATURE-023 Parte 1

`persistFunctionalFeatureBatch` deberá recibir el template ya resuelto o depender del proveedor de
Runbook. `worktreePath` continuará sirviendo para descubrir colisiones y materializar documentos,
no para localizar el template fuente.

## Criterios para elegir arquitectura

La alternativa elegida deberá priorizar:

1. determinismo;
2. independencia del repositorio gestionado;
3. compatibilidad con despliegue productivo;
4. validación temprana;
5. operación simple;
6. cambios mínimos sobre el runtime actual;
7. capacidad de versionar y auditar.

---

# 8. Validation Criteria

## Scenario 1 — Repositorio gestionado sin Runbook

**Input**

Run sobre un repositorio externo que no contiene `docs/runbook/`.

**Expected output**

El runtime obtiene el template desde el Runbook instalado del Orquestador y Functional puede
persistir el lote sin `ENOENT`.

## Scenario 2 — `cwd` arbitrario

**Input**

El mismo runtime se inicia desde dos directorios de trabajo distintos.

**Expected output**

Resuelve exactamente la misma versión y los mismos hashes del Runbook.

## Scenario 3 — Asset obligatorio ausente

**Input**

La fuente configurada no contiene `07-FEATURE-TEMPLATE.md`.

**Expected output**

Fallo técnico controlado y temprano; no se invoca el rol dependiente ni se persiste un
`phase_finished` engañoso.

## Scenario 4 — Hash inválido

**Input**

El contenido de un archivo no coincide con el manifiesto.

**Expected output**

El Runbook se rechaza y el error identifica el asset afectado sin exponer contenido.

## Scenario 5 — Versión incompatible

**Input**

Runtime y Runbook declaran versiones incompatibles.

**Expected output**

El servicio o run falla de forma explícita; no aplica fallback silencioso.

## Scenario 6 — Archivo homónimo en el repositorio gestionado

**Input**

El repositorio externo contiene su propio `docs/runbook/07-FEATURE-TEMPLATE.md`.

**Expected output**

Ese archivo no reemplaza ni modifica el asset autoritativo del Orquestador.

## Scenario 7 — Snapshot documental

**Input**

Functional crea una Feature usando el template activo.

**Expected output**

`template_version`, `template_hash` y `template_snapshot` corresponden exactamente al asset
validado por el proveedor del Runbook.

## Scenario 8 — Actualización del producto

**Input**

Se instala una nueva versión compatible del Runbook.

**Expected output**

Nuevos runs usan la versión activada; el comportamiento de runs ya fijados queda definido y es
auditable.

## Scenario 9 — Validación conjunta

**Input**

Caso real controlado sobre un repositorio externo.

**Expected output**

El E2E demuestra FEATURE-022 + FEATURE-023 Parte 1 + FEATURE-023 Parte 2: lectura universal de
artifacts, lifecycle documental, resolución propia del Runbook, materialización, commit, push, SHA
remoto, recuperación UI y continuidad según el modo configurado.

### Validation Evidence

La evidencia deberá incluir:

* tests unitarios del proveedor, manifiesto, hashes y compatibilidad;
* tests de integración con `cwd` arbitrario;
* repositorio externo sin Runbook;
* repositorio externo con archivo homónimo malicioso o incompatible;
* instalación o montaje equivalente al entorno productivo elegido;
* logs de fallo temprano sin contenido sensible;
* snapshot/version/hash persistidos en FEATURE-023 Parte 1;
* un E2E real conjunto con un provider real.

---

# 9. Risks

## Riesgo — Acoplar la solución al checkout actual

**Impacto:** funciona en desarrollo y vuelve a fallar al empaquetar o desplegar.

**Mitigación requerida:** validar la alternativa elegida fuera de un checkout Git.

## Riesgo — Duplicar fuentes autoritativas

**Impacto:** runtime, VPS y repositorios gestionados consumen versiones diferentes.

**Mitigación requerida:** una fuente primaria explícita y reglas cerradas para cualquier override.

## Riesgo — Upgrade incompatible

**Impacto:** una actualización del Runbook cambia contratos durante runs activos.

**Mitigación requerida:** versionado, compatibilidad y semántica de pinning definidas.

## Riesgo — Ampliar permisos de workers

**Impacto:** agentes acceden a más filesystem del host del necesario.

**Mitigación requerida:** preferir resolución e inyección desde el host confiable.

## Riesgo — Confundir baseline con configuración por proyecto

**Impacto:** se sobrescriben reglas globales o se pierde personalización durable.

**Mitigación requerida:** modelo explícito de capas y ownership.

## Riesgo — Absorber deuda no relacionada

**Impacto:** la Parte 2 crece hacia deployment completo, FEATURE-028 o FEATURE-030.

**Mitigación requerida:** respetar Included/Excluded y abrir decisiones separadas cuando
corresponda.

---

# 10. Approval Gate

## Estado

**PENDIENTE**

Antes de habilitar Development deben quedar aprobados explícitamente:

1. arquitectura de distribución elegida;
2. fuente autoritativa y mecanismo de lookup;
3. manifiesto, versión, integridad y compatibilidad;
4. modelo baseline/configuración/artifacts por proyecto;
5. semántica de actualización y pinning;
6. comportamiento fail-closed;
7. alcance exacto de la integración con FEATURE-023 Parte 1;
8. plan de validación conjunta;
9. nombre de la rama de implementación y checkout de origen;
10. autorización explícita del owner.

Hasta ese momento:

* no implementar;
* no reanudar el E2E;
* no aplicar cambios de DB;
* no ampliar mounts o permisos;
* no absorber FEATURE-028, FEATURE-030 ni Deployment Strategy completo.

---

# Design Principle

Runbook propio del producto

↓

Distribución y versión verificables

↓

Resolución independiente del repositorio gestionado

↓

Validación fail-closed

↓

Consumo por el runtime

↓

Evidencia conjunta

Nunca invertir este orden.

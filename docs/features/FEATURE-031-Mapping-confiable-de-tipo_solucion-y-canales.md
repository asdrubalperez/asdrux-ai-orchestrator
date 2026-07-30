# FEATURE-031 — Mapping confiable de `tipo_solucion` y simplificación de `canales`

Versión de plantilla usada: v2.1 (`docs/playbook/07-FEATURE-TEMPLATE.md`)

> **Nota de proceso**: diseño original de ARIA (AI Product Architect), revisado y validado
> técnicamente contra el código real antes de aprobar la implementación. El Scope de `canales` se
> ajustó antes de implementar — ver sección 7, "Corrección aplicada".

---

## 1. Feature Identity

- **Name**: Mapping confiable de `tipo_solucion` y simplificación de `canales`
- **Type**: Backend de intake asistido por IA + ajustes menores de persistencia y UI
- **Owner**: asdru
- **Status**: ✅ Implementada e integrada en `main`
- **Priority**: P2

---

## 2. Problem Statement

El intake asistido por IA (FEATURE-017) mapea texto libre contra doce campos predeterminados. Dos
campos necesitaban corrección:

**`tipo_solucion`** (selección simple: `nueva` / `mejora_existente`): el mapping podía clasificar
incorrectamente la iniciativa al interpretar palabras aisladas ("existe") sin considerar el
sentido completo de la oración — en particular negaciones ("no existe una solución" debe
clasificarse `nueva`, no `mejora_existente`), y menciones de soluciones de terceros o sistemas
relacionados que no son el objeto de la iniciativa.

**`canales`**: definido como `field_type = list`, pero funcionalmente es texto descriptivo libre,
igual que otros campos del intake. Mantenerlo como `list` introducía una diferencia innecesaria en
el contrato de mapping, validación y presentación sin necesidad funcional confirmada.

---

## 3. Functional Goal

1. `tipo_solucion` se clasifica mediante reglas conservadoras que consideran el significado
   completo de la entrada.
2. Expresiones de inexistencia se clasifican `nueva`; expresiones de existencia + modificación se
   clasifican `mejora_existente`; casos ambiguos dejan el campo vacío.
3. `canales` se mapea, persiste y edita como texto descriptivo.
4. El mapper continúa sin inventar información no presente en la entrada.

---

## 4. Scope

### Included

1. Reglas explícitas de clasificación de `tipo_solucion`: negación, distinción entre la solución
   objeto de la iniciativa y soluciones de terceros/sistemas relacionados, ambigüedad → vacío.
2. Validación de dominio en código para `tipo_solucion` (`nueva`/`mejora_existente`/vacío
   únicamente, sin importar lo que devuelva el modelo).
3. Cambiar `canales` de `field_type = list` a `textarea`.
4. Pruebas de regresión para ambos campos.
5. Mantener sin cambios el comportamiento de los otros diez campos del intake.

### Excluded

- Rediseñar los doce campos del intake, o crear un motor genérico de clasificación.
- Puntuaciones de confianza, evidencia por campo, o varias llamadas al modelo.
- Catálogo estructurado de canales o normalización contra valores predefinidos.
- Cambiar el cálculo general de completitud, el flujo de revisión/confirmación, o versionar las
  definiciones de campos.
- **Migración masiva de datos históricos de `canales`** (ver sección 7, "Corrección aplicada" —
  removido del alcance original tras confirmar que no hay casos reales que lo requieran).

---

## 5. Functional Rules

1. **Valores permitidos para `tipo_solucion`**: `nueva`, `mejora_existente`, o vacío. Ningún otro
   valor.
2. **Clasificación como `nueva`**: cuando la entrada indique que la solución objeto de la
   iniciativa todavía no existe. Una negación debe interpretarse junto con lo que modifica — "no
   existe una solución" significa que la solución no existe, nunca se lee la palabra "existe"
   aislada como evidencia de lo contrario.
3. **Clasificación como `mejora_existente`**: exige simultáneamente que (a) ya exista una
   solución/sistema/herramienta que sea el objeto de la iniciativa, y (b) la iniciativa busque
   modificarla, ampliarla, corregirla, reemplazarla o mejorarla.
4. **Prohibición de clasificar por palabras aisladas**: no decidir únicamente por detectar
   "existe", "actual", "sistema", "reemplazo", etc. — debe analizarse el sentido completo.
5. **La solución mencionada debe ser objeto de la iniciativa**: la existencia de una solución de
   terceros, competidor, o sistema relacionado no implica por sí sola que la iniciativa sea una
   mejora de algo existente.
6. **Casos ambiguos**: cuando no se pueda determinar con claridad si la iniciativa crea algo
   inexistente o modifica algo existente, `tipo_solucion` queda vacío. El mapper no elige el valor
   más probable.
7. **Reglas de `canales`**: tratado como texto descriptivo; extraer la información presente,
   conservar múltiples canales en el mismo texto, no agregar canales no mencionados, dejar vacío
   si no hay información.
8. **Prioridad de clasificación**: identificar la solución objeto de la iniciativa → determinar si
   no existe → determinar si existe y será modificada → ignorar soluciones de terceros como
   criterio → vacío si no hay conclusión clara.

---

## 6. Estrategia Algorítmica

**Salidas**: `{ "tipo_solucion": "nueva | mejora_existente | null", "canales": "string | null" }`.

**Restricciones obligatorias**: `tipo_solucion` no puede contener valores fuera de dominio; la
clasificación se refiere a la solución principal; una negación se interpreta junto con lo que
modifica; no se clasifica por palabras clave aisladas; casos ambiguos producen `null`; `canales`
contiene únicamente información presente en la entrada.

**Sin desempate probabilístico**: ante más de una interpretación razonable sin respaldo claro, el
resultado es vacío.

---

## 7. Technical Considerations

Reglas de clasificación de `tipo_solucion` hardcodeadas en `src/intake/mapBusinessCase.ts`
(`TIPO_SOLUCION_CLASSIFICATION_RULES`), inyectadas al prompt del mapper solo cuando el campo
`tipo_solucion` está presente entre los campos definidos — no en la columna `description` de
`intake_field_definitions` (que es puramente descriptiva), siguiendo el mismo criterio de
especialización por `field_key` que ya usa `web/src/intake/ReviewModal.tsx` para el `<select>` de
este campo.

Validación de dominio agregada en `parseMappingResponse`: descarta cualquier valor de
`tipo_solucion` fuera de `nueva`/`mejora_existente`, sin importar lo que el modelo haya devuelto —
la garantía de dominio es del código, no queda librada a que el prompt se respete siempre.

`canales`: migración `0014_canales_field_type_textarea.sql` (`field_type: 'list' → 'textarea'`),
más el seed de `0009_intake_field_definitions.sql` actualizado para instalaciones nuevas.

### Corrección aplicada antes de implementar

El diseño original de ARIA incluía una capa de compatibilidad para leer `canales` histórico como
`string | string[]`, previendo que casos persistidos pudieran tener el campo como array. Se
verificó contra el código (`parseMappingResponse` trata todo campo como `string | null` sin
excepción; `ReviewModal.tsx` renderiza `textarea` y `list` en la misma rama — ningún camino de
código produce ni produjo nunca un array para `canales`) y se confirmó contra la base de datos real
(`select business_case->'canales' from runs where jsonb_typeof(business_case->'canales') =
'array'` → 0 filas) que no existe ningún caso real con esa forma. Se removió del Scope toda la
lógica de compatibilidad histórica — el cambio quedó acotado a la migración de metadata.

---

## 8. Validation Criteria

13 escenarios (inexistencia explícita, inexistencia sin la palabra "existe", existencia + mejora,
reemplazo, negación con "existe", soluciones externas, sistema relacionado no objeto de la
iniciativa, ambigüedad, canales explícitos, ausencia de canales, uso interno como canal,
compatibilidad histórica — descartado, ver corrección arriba —, regresión sobre el resto del
intake).

### Validation Evidence

11 tests nuevos en `mapBusinessCase.test.ts` (prompt incluye/excluye las reglas de
`tipo_solucion` según presencia del campo; validación de dominio acepta los dos valores válidos y
descarta cualquier otro; `canales` se mapea como texto plano). Suite completa: 177 tests, 168 pass,
9 skip, 0 fail.

---

## 9. Risks

- **Clasificación semántica incorrecta**: el modelo podría seguir clasificando por señales
  débiles — mitigado con instrucciones explícitas, prioridad de reglas y ejemplos concretos en el
  prompt.
- **Sobreinterpretación de una integración**: mitigado exigiendo que la solución existente
  mencionada sea la solución objeto de la iniciativa, no cualquier sistema relacionado.
- **Diferencias menores de redacción del modelo en `canales`**: se valida presencia y fidelidad de
  contenido, no coincidencia literal completa.
- **Ampliación innecesaria del alcance**: limitado a `tipo_solucion`, `canales`, y pruebas
  directas — sin rediseño general del intake.

---

## 10. Approval Gate

Aprobada por el owner tras confirmar contra la base real que no había casos de `canales` como
array (ver sección 7).

---

## Estado de la implementación

**Implementada** (rama `feature/031-tipo-solucion-canales-mapping`, mergeada a `main` en
`43c3c7e`; commits principales `a810289` implementación, `0ac8260` cierre de Roadmap, `43c3c7e`
merge). `tsc --noEmit` y la suite completa verificados antes y después del merge.

**Validación manual del owner en VPS (2026-07-30)**: confirmada además de la suite automatizada
(la clasificación semántica de `tipo_solucion` depende del comportamiento real del modelo, no es
testeable con una unidad determinística — los tests automatizados verifican que el prompt y el
parser estén correctos, no que el modelo clasifique perfecto cada oración real).

import assert from "node:assert/strict";
import test from "node:test";
import { completenessPercent, pickBranchSeed, withDefaults } from "./ReviewModal";
import type { IntakeFieldDefinition } from "./types";

function field(field_key: string, field_type: IntakeFieldDefinition["field_type"] = "textarea"): IntakeFieldDefinition {
  return { id: field_key, field_key, field_order: 1, label: field_key, description: "", field_type };
}

// FEATURE-043, sección 5.9: el porcentaje descriptivo ya no debe contar la rama base -- antes de
// esta Feature, `rama_base_trabajo` viajaba en la misma lista de campos que el resto del caso.
test("completenessPercent no cuenta rama_base_trabajo -- solo se le pasan campos descriptivos", () => {
  const descriptiveFields = [field("vision"), field("necesidad_problema")];
  const values = { vision: "algo", necesidad_problema: null, rama_base_trabajo: "feature/x" };
  assert.equal(completenessPercent(values, descriptiveFields), 50);
});

test("completenessPercent devuelve 100 cuando todos los campos descriptivos están completos, sin importar la rama", () => {
  const descriptiveFields = [field("vision")];
  assert.equal(completenessPercent({ vision: "algo", rama_base_trabajo: null }, descriptiveFields), 100);
});

// FEATURE-043 hallazgo previo: pickBranchSeed prioriza "vision" sobre el primer campo genérico.
test("pickBranchSeed prioriza 'vision' sobre otros campos descriptivos", () => {
  const descriptiveFields = [field("tipo_solucion", "select"), field("vision"), field("necesidad_problema")];
  const values = { tipo_solucion: "nueva", vision: "Módulo de cálculo de propinas", necesidad_problema: "otra cosa" };
  assert.equal(pickBranchSeed(values, descriptiveFields), "Módulo de cálculo de propinas");
});

test("pickBranchSeed cae al valor no vacío más largo cuando 'vision' está vacía", () => {
  const descriptiveFields = [field("tipo_solucion", "select"), field("necesidad_problema")];
  const values = { tipo_solucion: "nueva", necesidad_problema: "Descripción bastante más larga del problema real" };
  assert.equal(pickBranchSeed(values, descriptiveFields), "Descripción bastante más larga del problema real");
});

test("withDefaults no pisa una rama ya presente en los valores iniciales", () => {
  const descriptiveFields = [field("vision")];
  const values = { vision: "algo", rama_base_trabajo: "feature/ya-elegida" };
  assert.equal(withDefaults(values, descriptiveFields)["rama_base_trabajo"], "feature/ya-elegida");
});

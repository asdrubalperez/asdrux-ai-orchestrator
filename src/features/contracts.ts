export const FEATURE_PRIORITIES = ["P0", "P1", "P2"] as const;
export type FeaturePriority = (typeof FEATURE_PRIORITIES)[number];

export interface ValidationCriterion {
  scenario: string;
  input: string;
  expectedOutput: string;
}

export interface FunctionalFeatureDocument {
  problemStatement: string;
  functionalGoal: string;
  scope: {
    included: string[];
    excluded: string[];
    futureIdeas: string[];
  };
  functionalRules: string[];
  algorithmicStrategy: {
    objective: string;
    inputs: string[];
    outputs: string[];
    constraints: string[];
    tieBreakers: string[];
    regressions: ValidationCriterion[];
  } | null;
  validationCriteria: ValidationCriterion[];
  validationEvidence: string;
  risks: string[];
}

export interface FunctionalFeature {
  id: string;
  nombre: string;
  resumen: string;
  prioridad: FeaturePriority;
  documento: FunctionalFeatureDocument;
}

export interface FeaturesPayload {
  features: FunctionalFeature[];
}

export interface FeatureUpdatePayload {
  sourceKey: string;
  technicalConsiderations: {
    affectedComponents: string[];
    approach: string;
    dependencies: string[];
  };
  validationPlan: {
    testCommand: string;
    scenarios: Array<{ scenario: string; action: string; expected: string }>;
    evidenceRequired: string[];
  };
  technicalRisks: string[];
}

export interface DeveloperImplementationPayload {
  implementationSummary: string;
  filesChanged: string[];
  decisions: string[];
  technicalEvidence: string[];
}

export interface QaResultPayload {
  testStatus: "passed" | "failed";
  testsExecuted: string[];
  evidence: string;
  defects: string[];
  observations: string[];
  qualityRisks: string[];
}

export interface DeveloperReadinessPayload {
  readiness: "ready" | "not_ready" | "ready_with_known_risks";
  summary: string;
  knownRisks: string[];
  requiresCodeChanges: boolean;
  finalNotes: string[];
}

export function parseFeaturesPayload(outputArtifact: unknown): FeaturesPayload {
  const value = extractStructuredValue(outputArtifact, "FEATURES", "features");
  assertClosedObject(value, ["features"], "FEATURES");
  if (!Array.isArray(value.features) || value.features.length === 0) {
    throw new Error("FEATURES.features debe contener al menos una Feature.");
  }
  const features = value.features.map(parseFunctionalFeature);
  const sourceKeys = new Set(features.map((feature) => feature.id));
  if (sourceKeys.size !== features.length) throw new Error("FEATURES contiene source keys duplicados.");
  return { features };
}

export function parseFeatureUpdatePayload(outputArtifact: unknown): FeatureUpdatePayload {
  const value = extractStructuredValue(outputArtifact, "FEATURE_UPDATE", "featureUpdate");
  assertClosedObject(value, ["sourceKey", "technicalConsiderations", "validationPlan", "technicalRisks"], "FEATURE_UPDATE");
  const technicalConsiderations = objectAt(value.technicalConsiderations, "FEATURE_UPDATE.technicalConsiderations");
  assertClosedObject(
    technicalConsiderations,
    ["affectedComponents", "approach", "dependencies"],
    "FEATURE_UPDATE.technicalConsiderations"
  );
  const validationPlan = objectAt(value.validationPlan, "FEATURE_UPDATE.validationPlan");
  assertClosedObject(validationPlan, ["testCommand", "scenarios", "evidenceRequired"], "FEATURE_UPDATE.validationPlan");
  const scenarios = arrayAt(validationPlan.scenarios, "FEATURE_UPDATE.validationPlan.scenarios").map((item, index) => {
    const scenario = objectAt(item, `FEATURE_UPDATE.validationPlan.scenarios[${index}]`);
    assertClosedObject(scenario, ["scenario", "action", "expected"], `FEATURE_UPDATE.validationPlan.scenarios[${index}]`);
    return {
      scenario: stringAt(scenario.scenario, "scenario"),
      action: stringAt(scenario.action, "action"),
      expected: stringAt(scenario.expected, "expected"),
    };
  });
  return {
    sourceKey: stringAt(value.sourceKey, "FEATURE_UPDATE.sourceKey"),
    technicalConsiderations: {
      affectedComponents: stringArrayAt(technicalConsiderations.affectedComponents, "affectedComponents"),
      approach: stringAt(technicalConsiderations.approach, "approach"),
      dependencies: stringArrayAt(technicalConsiderations.dependencies, "dependencies"),
    },
    validationPlan: {
      testCommand: stringAt(validationPlan.testCommand, "testCommand"),
      scenarios,
      evidenceRequired: stringArrayAt(validationPlan.evidenceRequired, "evidenceRequired"),
    },
    technicalRisks: stringArrayAt(value.technicalRisks, "FEATURE_UPDATE.technicalRisks"),
  };
}

export function parseDeveloperImplementation(outputArtifact: unknown): DeveloperImplementationPayload {
  const value = extractStructuredValue(outputArtifact, "IMPLEMENTATION", "implementation");
  assertClosedObject(
    value,
    ["implementationSummary", "filesChanged", "decisions", "technicalEvidence"],
    "IMPLEMENTATION"
  );
  return {
    implementationSummary: stringAt(value.implementationSummary, "implementationSummary"),
    filesChanged: stringArrayAt(value.filesChanged, "filesChanged"),
    decisions: stringArrayAt(value.decisions, "decisions"),
    technicalEvidence: stringArrayAt(value.technicalEvidence, "technicalEvidence"),
  };
}

export function parseQaResult(outputArtifact: unknown): QaResultPayload {
  const value = extractStructuredValue(outputArtifact, "QA_RESULT", "qaResult");
  assertClosedObject(
    value,
    ["testStatus", "testsExecuted", "evidence", "defects", "observations", "qualityRisks"],
    "QA_RESULT"
  );
  if (value.testStatus !== "passed" && value.testStatus !== "failed") {
    throw new Error("QA_RESULT.testStatus debe ser passed o failed.");
  }
  const testsExecuted = stringArrayAt(value.testsExecuted, "testsExecuted");
  if (testsExecuted.length === 0) throw new Error("QA_RESULT.testsExecuted no puede quedar vacío.");
  return {
    testStatus: value.testStatus,
    testsExecuted,
    evidence: stringAt(value.evidence, "evidence"),
    defects: stringArrayAt(value.defects, "defects"),
    observations: stringArrayAt(value.observations, "observations"),
    qualityRisks: stringArrayAt(value.qualityRisks, "qualityRisks"),
  };
}

export function parseDeveloperReadiness(outputArtifact: unknown): DeveloperReadinessPayload {
  const value = extractStructuredValue(outputArtifact, "READINESS", "readiness");
  assertClosedObject(value, ["readiness", "summary", "knownRisks", "requiresCodeChanges", "finalNotes"], "READINESS");
  if (
    value.readiness !== "ready" &&
    value.readiness !== "not_ready" &&
    value.readiness !== "ready_with_known_risks"
  ) {
    throw new Error("READINESS.readiness inválido.");
  }
  if (typeof value.requiresCodeChanges !== "boolean") {
    throw new Error("READINESS.requiresCodeChanges debe ser boolean.");
  }
  if (value.readiness !== "not_ready" && value.requiresCodeChanges) {
    throw new Error("READINESS ready no puede requerir cambios de código.");
  }
  return {
    readiness: value.readiness,
    summary: stringAt(value.summary, "summary"),
    knownRisks: stringArrayAt(value.knownRisks, "knownRisks"),
    requiresCodeChanges: value.requiresCodeChanges,
    finalNotes: stringArrayAt(value.finalNotes, "finalNotes"),
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function parseFunctionalFeature(value: unknown, index: number): FunctionalFeature {
  const feature = objectAt(value, `FEATURES.features[${index}]`);
  assertClosedObject(feature, ["id", "nombre", "resumen", "prioridad", "documento"], `FEATURES.features[${index}]`);
  if (!FEATURE_PRIORITIES.includes(feature.prioridad as FeaturePriority)) {
    throw new Error(`FEATURES.features[${index}].prioridad debe ser P0, P1 o P2.`);
  }
  const document = objectAt(feature.documento, `FEATURES.features[${index}].documento`);
  assertClosedObject(
    document,
    [
      "problemStatement",
      "functionalGoal",
      "scope",
      "functionalRules",
      "algorithmicStrategy",
      "validationCriteria",
      "validationEvidence",
      "risks",
    ],
    `FEATURES.features[${index}].documento`
  );
  const scope = objectAt(document.scope, "documento.scope");
  assertClosedObject(scope, ["included", "excluded", "futureIdeas"], "documento.scope");
  return {
    id: stringAt(feature.id, "id"),
    nombre: stringAt(feature.nombre, "nombre"),
    resumen: stringAt(feature.resumen, "resumen"),
    prioridad: feature.prioridad as FeaturePriority,
    documento: {
      problemStatement: stringAt(document.problemStatement, "problemStatement"),
      functionalGoal: stringAt(document.functionalGoal, "functionalGoal"),
      scope: {
        included: stringArrayAt(scope.included, "scope.included"),
        excluded: stringArrayAt(scope.excluded, "scope.excluded"),
        futureIdeas: stringArrayAt(scope.futureIdeas, "scope.futureIdeas"),
      },
      functionalRules: stringArrayAt(document.functionalRules, "functionalRules"),
      algorithmicStrategy:
        document.algorithmicStrategy === null ? null : parseAlgorithmicStrategy(document.algorithmicStrategy),
      validationCriteria: arrayAt(document.validationCriteria, "validationCriteria").map(parseValidationCriterion),
      validationEvidence: stringAt(document.validationEvidence, "validationEvidence"),
      risks: stringArrayAt(document.risks, "risks"),
    },
  };
}

function parseAlgorithmicStrategy(value: unknown): NonNullable<FunctionalFeatureDocument["algorithmicStrategy"]> {
  const strategy = objectAt(value, "algorithmicStrategy");
  assertClosedObject(
    strategy,
    ["objective", "inputs", "outputs", "constraints", "tieBreakers", "regressions"],
    "algorithmicStrategy"
  );
  return {
    objective: stringAt(strategy.objective, "objective"),
    inputs: stringArrayAt(strategy.inputs, "inputs"),
    outputs: stringArrayAt(strategy.outputs, "outputs"),
    constraints: stringArrayAt(strategy.constraints, "constraints"),
    tieBreakers: stringArrayAt(strategy.tieBreakers, "tieBreakers"),
    regressions: arrayAt(strategy.regressions, "regressions").map(parseValidationCriterion),
  };
}

function parseValidationCriterion(value: unknown, index: number): ValidationCriterion {
  const criterion = objectAt(value, `criterion[${index}]`);
  assertClosedObject(criterion, ["scenario", "input", "expectedOutput"], `criterion[${index}]`);
  return {
    scenario: stringAt(criterion.scenario, "scenario"),
    input: stringAt(criterion.input, "input"),
    expectedOutput: stringAt(criterion.expectedOutput, "expectedOutput"),
  };
}

/**
 * FEATURE-033: exportada (antes privada de FEATURE-023) para que `projectBriefContracts.ts` la
 * reutilice sin duplicar el parseo de outputArtifact estructurado/texto plano — es un helper
 * genérico sin lógica de dominio Feature, candidato real de reuso (segundo consumidor: Project
 * Brief) según la investigación de convergencia documental.
 */
export function extractStructuredValue(
  outputArtifact: unknown,
  tag: string,
  property: string
): Record<string, unknown> {
  if (isRecord(outputArtifact)) {
    if (tag === "FEATURES" && Array.isArray(outputArtifact.features)) {
      return { features: outputArtifact.features };
    }
    if (tag === "FEATURE_UPDATE" && typeof outputArtifact.sourceKey === "string") return outputArtifact;
    if (tag === "IMPLEMENTATION" && typeof outputArtifact.implementationSummary === "string") return outputArtifact;
    if (tag === "QA_RESULT" && typeof outputArtifact.testStatus === "string") return outputArtifact;
    if (
      tag === "READINESS" &&
      typeof outputArtifact.readiness === "string" &&
      "requiresCodeChanges" in outputArtifact
    ) {
      return outputArtifact;
    }
    const candidate = outputArtifact[property] ?? outputArtifact[tag] ?? outputArtifact[tag.toLowerCase()];
    if (candidate !== undefined) return parseJsonObject(candidate, tag);
  }
  if (typeof outputArtifact === "string") {
    // Fix (2026-08-17), causa raíz confirmada en vivo con RELEASE_PLAN_DOCUMENT: el regex de una
    // sola línea (`[^\n]+`) trunca en silencio cualquier valor JSON que el modelo termine emitiendo
    // con un salto de línea real adentro -- payloads grandes (RELEASE_PLAN_DOCUMENT, PROJECT_BRIEF,
    // ARCHITECTURE) tienen más superficie para que Codex, pese a la instrucción de "una sola línea",
    // rompa el JSON en más de una línea física. El síntoma observado ("Expected ',' or '}' after
    // property value" justo al final del texto capturado) es JSON.parse recibiendo un objeto
    // incompleto por el corte del regex, no basura real del modelo. Antes de la captura de una sola
    // línea, se prueba una extracción consciente de llaves/corchetes balanceados desde el primer
    // `{`/`[` después de la etiqueta -- mismo helper que `escalation.ts` (duplicado deliberadamente,
    // mismo criterio que ya usa el resto de este archivo/`escalation.ts` para esta misma extracción).
    const balanced = extractBalancedJsonAfterTag(outputArtifact, tag);
    if (balanced !== undefined) return parseJsonObject(balanced, tag);
    const match = outputArtifact.match(new RegExp(`(?:^|\\n)${tag}:\\s*([^\\n]+)`, "i"));
    if (match) return parseJsonObject(match[1], tag);
    return parseJsonObject(outputArtifact, tag);
  }
  throw new Error(`${tag} ausente en outputArtifact.`);
}

/** Fix (2026-08-17): ver el comentario gemelo en `src/cli/escalation.ts`. */
function extractBalancedJsonAfterTag(text: string, tag: string): string | undefined {
  const prefixMatch = text.match(new RegExp(`(?:^|\\n)${tag}:\\s*`, "i"));
  if (!prefixMatch || prefixMatch.index === undefined) return undefined;
  const start = prefixMatch.index + prefixMatch[0].length;
  const opener = text[start];
  if (opener !== "{" && opener !== "[") return undefined;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function parseJsonObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? parseJson(value, label) : value;
  return objectAt(parsed, label);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (err) {
    // Hallazgo de validación en vivo (FEATURE-025-Parte-2): el error genérico sin contenido no
    // alcanzaba para diagnosticar sin ir a buscar el texto crudo a mano en la base. V8 reporta la
    // posición exacta del carácter que rompió el parseo ("at position N") -- se muestra una ventana
    // alrededor de esa posición (no el inicio del string, que en un JSON largo suele quedar lejos
    // del problema real) junto con los códigos de carácter, para distinguir a simple vista un
    // carácter invisible/no-ASCII de uno visible.
    const reason = err instanceof Error ? err.message : String(err);
    const positionMatch = reason.match(/position (\d+)/);
    const position = positionMatch ? Number(positionMatch[1]) : null;
    const windowStart = position !== null ? Math.max(0, position - 80) : 0;
    const windowEnd = position !== null ? Math.min(value.length, position + 80) : Math.min(value.length, 300);
    const snippet = value.slice(windowStart, windowEnd);
    const charAtPosition = position !== null && position < value.length ? value[position] : null;
    const charInfo =
      charAtPosition !== null ? ` Carácter en esa posición: ${JSON.stringify(charAtPosition)} (code ${charAtPosition.charCodeAt(0)}).` : "";
    throw new Error(
      `${label} no contiene JSON válido (${reason}).${charInfo} Contexto [${windowStart}:${windowEnd}] de ${value.length} chars: ${JSON.stringify(snippet)}`
    );
  }
}

export function assertClosedObject(value: Record<string, unknown>, keys: string[], label: string): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.some((key) => !expected.has(key)) || keys.some((key) => !(key in value))) {
    throw new Error(`${label} debe usar el schema cerrado: ${keys.join(", ")}.`);
  }
}

export function objectAt(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
}

export function arrayAt(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} debe ser un array.`);
  return value;
}

export function stringAt(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} debe ser string no vacío.`);
  return value;
}

function stringArrayAt(value: unknown, label: string): string[] {
  const values = arrayAt(value, label);
  if (!values.every((item) => typeof item === "string")) throw new Error(`${label} debe contener strings.`);
  return values as string[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

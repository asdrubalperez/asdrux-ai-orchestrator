import type {
  DeveloperImplementationPayload,
  DeveloperReadinessPayload,
  FeatureUpdatePayload,
  FunctionalFeature,
  QaResultPayload,
} from "./contracts.js";
import type { RunbookTextAsset } from "../runbook/runbookProvider.js";
import { normalizeLf, sha256 } from "./canonicalDocument.js";

/** FEATURE-034: re-exportadas desde `canonicalDocument.ts` -- mantiene sin cambios a todo lo que ya importaba estos símbolos desde acá. */
export { normalizeLf, sha256 };

export const FEATURE_TEMPLATE_KEY = "runbook-feature";
export const FEATURE_TEMPLATE_VERSION = "v1.0";

const FEATURE_DESCRIPTOR_SECTIONS = Object.freeze([
  "identity",
  "problem_statement",
  "functional_goal",
  "scope",
  "functional_rules",
  "algorithmic_strategy",
  "technical_considerations",
  "validation_criteria",
  "risks",
  "approval_gate",
]);

export function functionalTemplateMetadata(templateAsset: RunbookTextAsset) {
  return {
    templateVersion: templateAsset.runbookVersion,
    templateHash: templateAsset.assetHash,
    templateSnapshot: {
      template: templateAsset.content,
      runbookVersion: templateAsset.runbookVersion,
      assetRelativePath: templateAsset.assetRelativePath,
      descriptor: {
        key: FEATURE_TEMPLATE_KEY,
        version: templateAsset.runbookVersion,
        sections: FEATURE_DESCRIPTOR_SECTIONS,
      },
    },
  };
}

export interface FeatureIdentityView {
  id: string;
  feature_code: string;
  name: string;
  priority: string;
  release_key: string;
  template_key: string;
  template_version: string;
}

export interface FeatureRevisionView {
  sequence: number | string;
  section_key: string;
  operation: "replace_section" | "append_entry" | "record_qa_result" | "record_readiness";
  content: unknown;
  producer_role: string;
  attempt: number | null;
}

export interface FeatureProjection {
  markdown: string;
  revisionSequence: number;
  summary: string;
}

export function renderFeatureDocument(
  identity: FeatureIdentityView,
  revisions: FeatureRevisionView[],
  approvalMode: "manual" | "auto"
): FeatureProjection {
  const ordered = [...revisions].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  const latest = new Map<string, unknown>();
  const implementations: DeveloperImplementationPayload[] = [];
  const qaResults: Array<{ attempt: number | null; value: QaResultPayload }> = [];
  const readiness: Array<{ attempt: number | null; value: DeveloperReadinessPayload }> = [];

  for (const revision of ordered) {
    if (revision.operation === "replace_section") latest.set(revision.section_key, revision.content);
    if (revision.operation === "append_entry" && revision.section_key === "developer_implementation") {
      implementations.push(revision.content as DeveloperImplementationPayload);
    }
    if (revision.operation === "record_qa_result") {
      qaResults.push({ attempt: revision.attempt, value: revision.content as QaResultPayload });
    }
    if (revision.operation === "record_readiness") {
      readiness.push({ attempt: revision.attempt, value: revision.content as DeveloperReadinessPayload });
    }
  }

  const functional = latest.get("functional_definition") as FunctionalFeature | undefined;
  const planning = latest.get("planning_update") as FeatureUpdatePayload | undefined;
  if (!functional) throw new Error(`Feature ${identity.feature_code} sin definición Functional.`);
  const document = functional.documento;
  const lines: string[] = [
    `# ${identity.feature_code} — ${identity.name}`,
    "",
    "## 1. Feature Identity",
    "",
    `- **Feature:** ${identity.feature_code}`,
    `- **Name:** ${identity.name}`,
    `- **Release:** ${identity.release_key}`,
    `- **Priority:** ${identity.priority}`,
    `- **Template:** ${identity.template_key}@${identity.template_version}`,
    "",
    "# 2. Problem Statement",
    "",
    document.problemStatement,
    "",
    "# 3. Functional Goal",
    "",
    document.functionalGoal,
    "",
    "# 4. Scope",
    "",
    "## Included",
    "",
    ...bullets(document.scope.included),
    "",
    "## Excluded",
    "",
    ...bullets(document.scope.excluded),
    "",
    "## Future Ideas",
    "",
    ...bullets(document.scope.futureIdeas),
    "",
    "# 5. Functional Rules",
    "",
    ...numbered(document.functionalRules),
    "",
    "# 6. Estrategia Algorítmica",
    "",
    ...renderAlgorithmicStrategy(document.algorithmicStrategy),
    "",
    "# 7. Technical Considerations",
    "",
    ...renderPlanning(planning),
    ...renderImplementations(implementations),
    ...renderReadiness(readiness),
    "",
    "# 8. Validation Criteria",
    "",
    ...renderValidationCriteria(document.validationCriteria),
    "",
    "## Validation Evidence",
    "",
    document.validationEvidence,
    ...renderValidationPlan(planning),
    ...renderQaResults(qaResults),
    "",
    "# 9. Risks",
    "",
    "## Functional Risks",
    "",
    ...bullets(document.risks),
    "",
    "## Technical Risks",
    "",
    ...bullets(planning?.technicalRisks ?? []),
    "",
    "## Quality and Readiness Risks",
    "",
    ...bullets([
      ...qaResults.flatMap((item) => item.value.qualityRisks),
      ...readiness.flatMap((item) => item.value.knownRisks),
    ]),
    "",
    "# 10. Approval Gate",
    "",
    `Approval mode: ${approvalMode}`,
    "Readiness declared by: Developer",
    `QA result: ${qaResults.at(-1)?.value.testStatus === "passed" ? "tests passed" : "pending"}`,
    `Human merge authorization: ${approvalMode === "manual" ? "pending" : "not_required"}`,
    ...(approvalMode === "auto" ? ["Pipeline decision: continue"] : []),
    "",
  ];

  const markdown = normalizeLf(lines.join("\n"));
  return {
    markdown,
    revisionSequence: ordered.length === 0 ? 0 : Number(ordered.at(-1)?.sequence ?? 0),
    summary: functional.resumen,
  };
}

export function featureDocumentPath(featureCode: string, name: string): string {
  const slug = asciiSlug(name);
  if (!/^FEATURE-\d{3,}$/.test(featureCode) || !slug) throw new Error("Ruta de Feature inválida.");
  return `docs/features/${featureCode}-${slug}.md`;
}

export function asciiSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function bullets(items: string[]): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : ["- None."];
}

function numbered(items: string[]): string[] {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`) : ["No rules declared."];
}

function renderAlgorithmicStrategy(strategy: FunctionalFeature["documento"]["algorithmicStrategy"]): string[] {
  if (!strategy) return ["Not applicable."];
  return [
    "## Objective",
    "",
    strategy.objective,
    "",
    "## Inputs",
    "",
    ...bullets(strategy.inputs),
    "",
    "## Outputs",
    "",
    ...bullets(strategy.outputs),
    "",
    "## Constraints",
    "",
    ...bullets(strategy.constraints),
    "",
    "## Tie Breakers",
    "",
    ...bullets(strategy.tieBreakers),
    "",
    "## Deterministic Regressions",
    "",
    ...renderValidationCriteria(strategy.regressions),
  ];
}

function renderPlanning(planning: FeatureUpdatePayload | undefined): string[] {
  if (!planning) return ["Planning contribution: pending.", ""];
  return [
    "## Planning Contribution",
    "",
    planning.technicalConsiderations.approach,
    "",
    "### Affected Components",
    "",
    ...bullets(planning.technicalConsiderations.affectedComponents),
    "",
    "### Dependencies",
    "",
    ...bullets(planning.technicalConsiderations.dependencies),
    "",
  ];
}

function renderImplementations(items: DeveloperImplementationPayload[]): string[] {
  if (items.length === 0) return ["## Developer Implementation", "", "Pending.", ""];
  return items.flatMap((item, index) => [
    `## Developer Implementation ${index + 1}`,
    "",
    item.implementationSummary,
    "",
    "### Files Changed",
    "",
    ...bullets(item.filesChanged),
    "",
    "### Decisions",
    "",
    ...bullets(item.decisions),
    "",
    "### Technical Evidence",
    "",
    ...bullets(item.technicalEvidence),
    "",
  ]);
}
function renderReadiness(items: Array<{ attempt: number | null; value: DeveloperReadinessPayload }>): string[] {
  if (items.length === 0) return ["## Developer Readiness", "", "Pending.", ""];
  return items.flatMap(({ attempt, value }) => [
    `## Developer Readiness${attempt ? ` — Attempt ${attempt}` : ""}`,
    "",
    `Status: ${value.readiness}`,
    "",
    value.summary,
    "",
    `Requires code changes: ${String(value.requiresCodeChanges)}`,
    "",
    "### Known Risks",
    "",
    ...bullets(value.knownRisks),
    "",
    "### Final Notes",
    "",
    ...bullets(value.finalNotes),
    "",
  ]);
}

function renderValidationCriteria(
  criteria: Array<{ scenario: string; input?: string; expectedOutput?: string; action?: string; expected?: string }>
): string[] {
  return criteria.flatMap((criterion, index) => [
    `## Scenario ${index + 1} — ${criterion.scenario}`,
    "",
    "**Input / Action**",
    "",
    criterion.input ?? criterion.action ?? "",
    "",
    "**Expected output**",
    "",
    criterion.expectedOutput ?? criterion.expected ?? "",
    "",
  ]);
}

function renderValidationPlan(planning: FeatureUpdatePayload | undefined): string[] {
  if (!planning) return [];
  return [
    "",
    "## Planning Validation Plan",
    "",
    `Test command: \`${planning.validationPlan.testCommand}\``,
    "",
    ...renderValidationCriteria(planning.validationPlan.scenarios),
    "### Evidence Required",
    "",
    ...bullets(planning.validationPlan.evidenceRequired),
  ];
}

function renderQaResults(items: Array<{ attempt: number | null; value: QaResultPayload }>): string[] {
  if (items.length === 0) return ["", "## QA Results", "", "Pending."];
  return items.flatMap(({ attempt, value }, index) => [
    "",
    `## QA Result ${index + 1}${attempt ? ` — Attempt ${attempt}` : ""}`,
    "",
    `Test status: ${value.testStatus}`,
    "",
    `Evidence: ${value.evidence}`,
    "",
    "### Tests Executed",
    "",
    ...bullets(value.testsExecuted),
    "",
    "### Defects",
    "",
    ...bullets(value.defects),
    "",
    "### Observations",
    "",
    ...bullets(value.observations),
  ]);
}

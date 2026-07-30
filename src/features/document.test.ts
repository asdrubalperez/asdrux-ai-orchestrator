import assert from "node:assert/strict";
import test from "node:test";
import {
  asciiSlug,
  featureDocumentPath,
  functionalTemplateMetadata,
  renderFeatureDocument,
  sha256,
} from "./document.js";

const identity = {
  id: "feature-id",
  feature_code: "FEATURE-036",
  name: "Autenticación y recuperación de contraseña",
  priority: "P0",
  release_key: "release-1",
  template_key: "runbook-feature",
  template_version: "v1.0",
};

const functional = {
  id: "f1",
  nombre: identity.name,
  resumen: "Acceso seguro.",
  prioridad: "P0",
  documento: {
    problemStatement: "Falta autenticación.",
    functionalGoal: "Acceso observable.",
    scope: { included: ["Login"], excluded: [], futureIdeas: [] },
    functionalRules: ["Validar credenciales."],
    algorithmicStrategy: null,
    validationCriteria: [{ scenario: "Login", input: "válido", expectedOutput: "sesión" }],
    validationEvidence: "Sesión persistida.",
    risks: ["Ataques"],
  },
};

test("slug translitera sólo la ruta y preserva Unicode en el documento", () => {
  assert.equal(asciiSlug(identity.name), "autenticacion-y-recuperacion-de-contrasena");
  assert.equal(
    featureDocumentPath(identity.feature_code, identity.name),
    "docs/features/FEATURE-036-autenticacion-y-recuperacion-de-contrasena.md"
  );
  const projection = renderFeatureDocument(
    identity,
    [{
      sequence: 1,
      section_key: "functional_definition",
      operation: "replace_section",
      content: functional,
      producer_role: "functional",
      attempt: null,
    }],
    "manual"
  );
  assert.match(projection.markdown, /Autenticación y recuperación de contraseña/);
  assert.ok(projection.markdown.endsWith("\n"));
  assert.doesNotMatch(projection.markdown, /\r/);
});

test("proyección es determinista por sequence, no por orden de entrada", () => {
  const revisions = [
    {
      sequence: 2,
      section_key: "planning_update",
      operation: "replace_section" as const,
      content: {
        sourceKey: "f1",
        technicalConsiderations: { affectedComponents: ["b.ts"], approach: "Local", dependencies: [] },
        validationPlan: { testCommand: "node --test b.test.js", scenarios: [], evidenceRequired: [] },
        technicalRisks: [],
      },
      producer_role: "planning",
      attempt: null,
    },
    {
      sequence: 1,
      section_key: "functional_definition",
      operation: "replace_section" as const,
      content: functional,
      producer_role: "functional",
      attempt: null,
    },
  ];
  const a = renderFeatureDocument(identity, revisions, "auto").markdown;
  const b = renderFeatureDocument(identity, [...revisions].reverse(), "auto").markdown;
  assert.equal(a, b);
  assert.equal(sha256(a), sha256(b));
  assert.match(a, /Approval mode: auto/);
  assert.doesNotMatch(a, /automatic|automático/);
});

test("metadata Functional conserva versión, hash y snapshot del asset distribuido", () => {
  const metadata = functionalTemplateMetadata({
    runbookVersion: "v1.0",
    assetRelativePath: "07-FEATURE-TEMPLATE.md",
    assetHash: "abc123",
    content: "# Template\n",
  });

  assert.equal(metadata.templateVersion, "v1.0");
  assert.equal(metadata.templateHash, "abc123");
  assert.deepEqual(metadata.templateSnapshot, {
    template: "# Template\n",
    runbookVersion: "v1.0",
    assetRelativePath: "07-FEATURE-TEMPLATE.md",
    descriptor: {
      key: "runbook-feature",
      version: "v1.0",
      sections: [
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
      ],
    },
  });
});

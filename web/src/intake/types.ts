export type IntakeFieldType = "text" | "textarea" | "select" | "list";

export interface IntakeFieldDefinition {
  id: string;
  field_key: string;
  field_order: number;
  label: string;
  description: string;
  field_type: IntakeFieldType;
}

export type BusinessCaseValues = Record<string, string | null>;

export interface RunCaseSummary {
  id: string;
  status: string;
  current_phase: string | null;
  branch_name: string | null;
  created_at: string;
  updated_at: string;
}

// FEATURE-045: espejo del DTO que arma `buildCaseTrees` (src/cases/caseTree.ts). El backend
// resuelve toda la jerarquía -- este frontend no reconstruye root_run_id/ancestry/Release
// ownership, solo representa lo que ya viene resuelto (Regla 13).
export type CaseRunKind = "run" | "reentry";

export interface CaseTreeRun {
  id: string;
  status: string;
  currentPhase: string | null;
  createdAt: string;
  kind: CaseRunKind;
  children: CaseTreeRun[];
}

export interface CaseTreeFeature {
  id: string;
  featureCode: string;
  name: string;
  runs: CaseTreeRun[];
}

export interface CaseTreeRelease {
  id: string;
  nombre: string;
  estado: string;
  alcanceResumen: string;
  features: CaseTreeFeature[];
  runs: CaseTreeRun[];
}

export interface CaseTree {
  caseKey: string;
  displayName: string;
  createdAt: string;
  releases: CaseTreeRelease[];
  runs: CaseTreeRun[];
}

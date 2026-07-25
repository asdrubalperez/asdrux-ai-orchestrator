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

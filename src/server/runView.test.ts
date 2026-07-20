import assert from "node:assert/strict";
import test from "node:test";
import type { RunRow } from "../db/repository.js";
import { buildRunViewModel, buildTimeline, type RunEventRow } from "./runView.js";

const baseRun: RunRow = {
  id: "11111111-1111-1111-1111-111111111111",
  pipeline_definition_id: "22222222-2222-2222-2222-222222222222",
  owner_id: "33333333-3333-3333-3333-333333333333",
  project_id: "44444444-4444-4444-4444-444444444444",
  current_phase: "architect",
  status: "running",
  branch_name: "run/test",
  worktree_path: "/tmp/run",
  originated_from_run_id: null,
  created_at: "2026-07-20T10:00:00.000Z",
  updated_at: "2026-07-20T10:00:00.000Z",
};

test("mantiene timeline fijo de 6 nodos para un pipeline corto", () => {
  const timeline = buildTimeline(
    { ...baseRun, status: "completed", current_phase: "architect" },
    [
      event(1, "run_started", {}),
      event(2, "phase_started", { agentRole: "architect" }),
      event(3, "phase_finished", {
        agentRole: "architect",
        result: { status: "completed", summary: "Architect aprobó.", outputArtifact: {}, escalationReason: null },
      }),
    ]
  );

  assert.deepEqual(
    timeline.map((node) => [node.id, node.status]),
    [
      ["user", "iniciado"],
      ["architect", "completado"],
      ["functional", "pendiente"],
      ["planning", "pendiente"],
      ["developer", "pendiente"],
      ["qa", "pendiente"],
    ]
  );
});

test("marca una fase en curso cuando existe phase_started sin phase_finished posterior", () => {
  const timeline = buildTimeline(baseRun, [
    event(1, "run_started", {}),
    event(2, "phase_started", { agentRole: "architect" }),
    event(3, "phase_finished", {
      agentRole: "architect",
      result: { status: "completed", summary: "Architect listo.", outputArtifact: {}, escalationReason: null },
    }),
    event(4, "phase_started", { agentRole: "functional" }),
  ]);

  assert.equal(timeline.find((node) => node.id === "functional")?.status, "en_curso");
  assert.equal(timeline.find((node) => node.id === "architect")?.status, "completado");
});

test("el snapshot de vista refleja cambios de runs aunque no haya eventos nuevos", () => {
  const view = buildRunViewModel({
    run: { ...baseRun, status: "retrying", current_phase: "architect" },
    events: [event(10, "run_started", {})],
    artifacts: [],
  });

  assert.equal(view.run.status, "retrying");
  assert.equal(view.run.current_phase, "architect");
  assert.equal(view.narrative.length, 1);
});

test("usa summary de phase_finished como bitacora narrativa y muestra escalamiento", () => {
  const view = buildRunViewModel({
    run: { ...baseRun, status: "escalated", current_phase: "planning" },
    events: [
      event(1, "run_started", {}),
      event(2, "phase_started", { agentRole: "planning" }),
      event(3, "phase_finished", {
        agentRole: "planning",
        result: {
          status: "escalated",
          summary: "Planning necesita una decisión humana.",
          outputArtifact: { finding: "ambiguedad" },
          escalationReason: "Requisito ambiguo.",
        },
      }),
    ],
    artifacts: [
      {
        id: "55555555-5555-5555-5555-555555555555",
        phase: "planning",
        kind: "escalation",
        content: { escalationReason: "Requisito ambiguo." },
        created_at: "2026-07-20T10:00:03.000Z",
      },
    ],
  });

  assert.equal(view.narrative.at(-1)?.text, "Planning necesita una decisión humana.");
  assert.deepEqual(view.escalation, {
    isEscalated: true,
    agentRole: "planning",
    reason: "Requisito ambiguo.",
  });
  assert.equal(view.timeline.find((node) => node.id === "planning")?.status, "escalado");
});

function event(id: number, eventType: string, payload: unknown): RunEventRow {
  return {
    id,
    event_type: eventType,
    payload,
    created_at: `2026-07-20T10:00:${String(id).padStart(2, "0")}.000Z`,
  };
}

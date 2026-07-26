import assert from "node:assert/strict";
import test from "node:test";
import type { RunRow } from "../db/repository.js";
import { buildRunViewModel, buildTimeline, toReleaseRoadmapView, type RunEventRow } from "./runView.js";

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
  business_case: null,
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
      event(4, "escalation_exhausted", { agentRole: "planning", attempts: 3 }),
    ],
    artifacts: [
      {
        id: "55555555-5555-5555-5555-555555555555",
        phase: "planning",
        kind: "escalation",
        content: { escalationReason: "Requisito ambiguo.", outputArtifact: { finding: "ambiguedad" } },
        created_at: "2026-07-20T10:00:03.000Z",
      },
    ],
  });

  assert.equal(
    view.narrative.find((entry) => entry.eventType === "phase_finished")?.text,
    "Planning necesita una decisión humana."
  );
  assert.deepEqual(view.escalation, {
    isEscalated: true,
    agentRole: "planning",
    reason: "Requisito ambiguo.",
    outputArtifact: { finding: "ambiguedad" },
    motive: "exhausted",
  });
  assert.equal(view.timeline.find((node) => node.id === "planning")?.status, "escalado");
});

test("FEATURE-017: cancelación por usuario mid-fase usa el agentRole registrado en el evento forzado", () => {
  const view = buildRunViewModel({
    run: { ...baseRun, status: "escalated", current_phase: "planning" },
    events: [
      event(1, "run_started", {}),
      event(2, "phase_started", { agentRole: "planning" }),
      event(3, "escalation_forced_by_user", { reason: "user_cancel_requested", agentRole: "planning" }),
    ],
    artifacts: [],
  });

  assert.equal(view.escalation.motive, "user_cancel_requested");
  assert.equal(view.escalation.agentRole, "planning");
  assert.equal(view.escalation.isEscalated, true);
});

test("FEATURE-018: releaseRoadmap es null por default, sin necesidad de DB en el test", () => {
  const view = buildRunViewModel({
    run: { ...baseRun, status: "running" },
    events: [event(1, "run_started", {})],
    artifacts: [],
  });

  assert.equal(view.releaseRoadmap, null);
});

test("FEATURE-018: releaseRoadmap refleja el valor ya resuelto que se le pasa", () => {
  const roadmap = {
    releases: [{ id: "r1", nombre: "MVP", alcanceResumen: "Alcance mínimo.", estado: "Activo" }],
    activeReleaseId: "r1",
  };
  const view = buildRunViewModel(
    { run: { ...baseRun, status: "running" }, events: [event(1, "run_started", {})], artifacts: [] },
    roadmap
  );

  assert.deepEqual(view.releaseRoadmap, roadmap);
});

test("FEATURE-018: toReleaseRoadmapView rechaza valores que no tienen la forma esperada", () => {
  assert.equal(toReleaseRoadmapView(null), null);
  assert.equal(toReleaseRoadmapView({ foo: "bar" }), null);
  assert.equal(toReleaseRoadmapView("texto plano"), null);
});

function event(id: number, eventType: string, payload: unknown): RunEventRow {
  return {
    id,
    event_type: eventType,
    payload,
    created_at: `2026-07-20T10:00:${String(id).padStart(2, "0")}.000Z`,
  };
}

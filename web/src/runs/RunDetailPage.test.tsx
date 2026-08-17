import assert from "node:assert/strict";
import test from "node:test";
import { nextChildRunFollowState } from "./RunDetailPage";

// Fix (2026-08-17), regresión reportada en vivo con captura de pantalla: el primer intento de
// auto-seguimiento navegaba siempre que `childRunId` estuviera presente, sin importar si el usuario
// había entrado a propósito -- desde la lista de Casos -- a revisar un run viejo ya resuelto (que
// por definición YA tiene un childRunId). Resultado: era imposible abrir ningún run histórico, cada
// uno rebotaba en cadena hasta el más nuevo.

test("abrir un run viejo que ya tiene childRunId (visita deliberada) no navega", () => {
  const { state, shouldNavigateTo } = nextChildRunFollowState(null, {
    runId: "run-viejo",
    currentChildRunId: "run-nuevo",
    arrivedViaAutoFollow: false,
  });

  assert.equal(shouldNavigateTo, null);
  assert.deepEqual(state, { runId: "run-viejo", hadChildAtLoad: true });
});

test("observaciones posteriores del mismo run viejo siguen sin navegar (no solo la primera)", () => {
  const first = nextChildRunFollowState(null, {
    runId: "run-viejo",
    currentChildRunId: "run-nuevo",
    arrivedViaAutoFollow: false,
  });
  const second = nextChildRunFollowState(first.state, {
    runId: "run-viejo",
    currentChildRunId: "run-nuevo",
    arrivedViaAutoFollow: false,
  });

  assert.equal(second.shouldNavigateTo, null);
});

test("transición en vivo (childRunId aparece después de la primera observación) sí navega", () => {
  const first = nextChildRunFollowState(null, {
    runId: "run-en-curso",
    currentChildRunId: null,
    arrivedViaAutoFollow: false,
  });
  assert.equal(first.shouldNavigateTo, null);
  assert.deepEqual(first.state, { runId: "run-en-curso", hadChildAtLoad: false });

  const second = nextChildRunFollowState(first.state, {
    runId: "run-en-curso",
    currentChildRunId: "run-hijo",
    arrivedViaAutoFollow: false,
  });
  assert.equal(second.shouldNavigateTo, "run-hijo");
});

test("llegar vía salto automático (autoFollowed) sigue la cadena de inmediato aunque ya traiga childRunId", () => {
  const { shouldNavigateTo, state } = nextChildRunFollowState(null, {
    runId: "run-intermedio",
    currentChildRunId: "run-siguiente",
    arrivedViaAutoFollow: true,
  });

  assert.equal(shouldNavigateTo, "run-siguiente");
  assert.equal(state.hadChildAtLoad, false);
});

test("cambiar a un runId distinto resetea la base, sin arrastrar el estado del run anterior", () => {
  const onOldRun = nextChildRunFollowState(null, {
    runId: "run-a",
    currentChildRunId: "run-b",
    arrivedViaAutoFollow: false,
  });

  // El usuario navega manualmente (no autoFollowed) a un run distinto que también ya tiene hijo.
  const onDifferentRun = nextChildRunFollowState(onOldRun.state, {
    runId: "run-c",
    currentChildRunId: "run-d",
    arrivedViaAutoFollow: false,
  });

  assert.equal(onDifferentRun.shouldNavigateTo, null);
  assert.deepEqual(onDifferentRun.state, { runId: "run-c", hadChildAtLoad: true });
});

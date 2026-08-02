import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// FEATURE-042: EscalationResponseDialog se movió de main.tsx a runs/RunDetailPage.tsx cuando se
// introdujo el router (sección C del diseño aprobado) -- el contenido de la función es idéntico.
const source = readFileSync(new URL("../../web/src/runs/RunDetailPage.tsx", import.meta.url), "utf8");
const dialogStart = source.indexOf('function EscalationResponseDialog(');
const dialogEnd = source.indexOf("\nfunction escalationMotiveText(", dialogStart);
const dialog = source.slice(dialogStart, dialogEnd);

test("el modal de escalamiento reserva Header y Footer dentro del viewport", () => {
  assert.match(dialog, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(dialog, /grid-rows-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.match(dialog, /<DialogHeader className="min-w-0">/);
  assert.match(dialog, /<DialogFooter className="min-w-0">/);
  assert.ok(dialog.indexOf("<DialogHeader") < dialog.indexOf("overflow-y-auto"));
  assert.ok(dialog.indexOf("overflow-y-auto") < dialog.indexOf("<DialogFooter"));
});

test("solo el Body del modal desplaza verticalmente y puede contraerse", () => {
  assert.match(
    dialog,
    /className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain pr-1 text-sm"/
  );
  assert.doesNotMatch(dialog.match(/<DialogContent[\s\S]*?>/)?.[0] ?? "", /overflow-y-auto/);
  assert.doesNotMatch(dialog.match(/<DialogFooter[\s\S]*?>/)?.[0] ?? "", /overflow-y-auto/);
});

test("el artifact largo queda contenido y corta cadenas sin espacios", () => {
  const artifact = dialog.match(/<pre className="([^"]+)">/)?.[1] ?? "";
  for (const requiredClass of [
    "max-w-full",
    "min-w-0",
    "overflow-auto",
    "whitespace-pre-wrap",
    "break-words",
  ]) {
    assert.ok(artifact.split(/\s+/).includes(requiredClass), `falta ${requiredClass} en el artifact`);
  }
});

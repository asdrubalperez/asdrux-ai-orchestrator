import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReleasePlanPanel } from "./ReleasePlanPanel";

test("ReleasePlanPanel renderiza los tres estados y conserva un release futuro vacío", () => {
  const html = renderToStaticMarkup(
    <ReleasePlanPanel
      releaseRoadmap={{
        activeReleaseId: "r1",
        releases: [
          {
            id: "r1",
            nombre: "Release actual",
            alcanceResumen: "Actual",
            estado: "Activo",
            features: [
              { id: "f1", nombre: "Terminada", estado: "Completada" },
              { id: "f2", nombre: "Trabajando", estado: "En curso" },
              { id: "f3", nombre: "Por hacer", estado: "Pendiente" },
            ],
          },
          {
            id: "r2",
            nombre: "Release futuro",
            alcanceResumen: "Futuro",
            estado: "Pendiente",
            features: [],
          },
        ],
      }}
    />
  );

  assert.match(html, /aria-label="completed"/);
  assert.match(html, /aria-label="in-progress"/);
  assert.match(html, /aria-label="pending"/);
  assert.match(html, /Release futuro/);
});

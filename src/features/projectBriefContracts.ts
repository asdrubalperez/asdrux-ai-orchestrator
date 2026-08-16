import {
  arrayAt,
  assertClosedObject,
  extractStructuredValue,
  objectAt,
  stringAt,
} from "./contracts.js";

/**
 * FEATURE-033: contrato estructurado del Project Brief que Architect declara en la etiqueta
 * PROJECT_BRIEF (mismo mecanismo de outputArtifact estructurado/texto plano que FEATURES para
 * Functional — ver `src/features/contracts.ts`). Los 4 campos declarativos de
 * `01-PROJECT-BRIEF-TEMPLATE.md` §0 son responsabilidad exclusiva del humano: si alguno falta y no
 * es legítimamente "No Aplica", Architect no declara PROJECT_BRIEF (queda null) y escala por la
 * Regla 2 existente de architect.txt — este contrato nunca representa un Project Brief con
 * declarativos inventados.
 */
export const EVALUACION_PRELIMINAR_ITEMS = Object.freeze([
  "Reutiliza componentes o servicios ya existentes en el proyecto",
  "Introduce integraciones nuevas con sistemas externos",
  "Maneja datos sensibles (PII, financieros, credenciales, etc.)",
  "Contiene componentes de IA/ML",
  "Requiere infraestructura nueva o cambios de despliegue",
  "Requiere nueva base de datos o almacenamiento",
  "Impacta procesos críticos / alta disponibilidad requerida",
  "Expone algo nuevo a Internet / superficie de ataque nueva",
]);

export const EVALUACION_ESTADOS = ["Sí", "No", "Parcial", "No Aplica"] as const;
export type EvaluacionEstado = (typeof EVALUACION_ESTADOS)[number];

export const COMPLEJIDAD_NIVELES = ["Alta", "Media", "Baja"] as const;
export type ComplejidadNivel = (typeof COMPLEJIDAD_NIVELES)[number];

export interface ProjectBriefDeclarativos {
  identidadSistema: string;
  accesoCodigoFuente: string;
  restriccionesNegocio: string;
  intencionNegocio: string;
}

export interface ProjectBriefEvaluacionItem {
  item: string;
  estado: EvaluacionEstado;
  comentario: string;
}

export interface ProjectBriefPayload {
  declarativos: ProjectBriefDeclarativos;
  contexto: {
    problema: string;
    situacionActual: string;
    valorEsperado: string;
  };
  evaluacionPreliminar: ProjectBriefEvaluacionItem[];
  esquemaPreliminar: {
    flujoEsperado: string;
    sistemasInvolucrados: string;
    integracionesNecesarias: string;
    expuestoInternet: string;
  };
  complejidadTecnica: ComplejidadNivel;
  hallazgos: string;
}

export function parseProjectBriefPayload(outputArtifact: unknown): ProjectBriefPayload {
  const value = extractStructuredValue(outputArtifact, "PROJECT_BRIEF", "projectBrief");
  assertClosedObject(
    value,
    ["declarativos", "contexto", "evaluacionPreliminar", "esquemaPreliminar", "complejidadTecnica", "hallazgos"],
    "PROJECT_BRIEF"
  );

  const declarativos = objectAt(value.declarativos, "PROJECT_BRIEF.declarativos");
  assertClosedObject(
    declarativos,
    ["identidadSistema", "accesoCodigoFuente", "restriccionesNegocio", "intencionNegocio"],
    "PROJECT_BRIEF.declarativos"
  );

  const contexto = objectAt(value.contexto, "PROJECT_BRIEF.contexto");
  assertClosedObject(contexto, ["problema", "situacionActual", "valorEsperado"], "PROJECT_BRIEF.contexto");

  const esquemaPreliminar = objectAt(value.esquemaPreliminar, "PROJECT_BRIEF.esquemaPreliminar");
  assertClosedObject(
    esquemaPreliminar,
    ["flujoEsperado", "sistemasInvolucrados", "integracionesNecesarias", "expuestoInternet"],
    "PROJECT_BRIEF.esquemaPreliminar"
  );

  const evaluacionPreliminar = arrayAt(value.evaluacionPreliminar, "PROJECT_BRIEF.evaluacionPreliminar").map(
    (item, index) => parseEvaluacionItem(item, index)
  );
  const declaredItems = new Set(evaluacionPreliminar.map((item) => item.item));
  if (declaredItems.size !== EVALUACION_PRELIMINAR_ITEMS.length) {
    throw new Error(
      `PROJECT_BRIEF.evaluacionPreliminar debe declarar exactamente los ${EVALUACION_PRELIMINAR_ITEMS.length} ítems del template, sin duplicados.`
    );
  }
  for (const required of EVALUACION_PRELIMINAR_ITEMS) {
    if (!declaredItems.has(required)) {
      throw new Error(`PROJECT_BRIEF.evaluacionPreliminar falta el ítem requerido: "${required}".`);
    }
  }

  if (!COMPLEJIDAD_NIVELES.includes(value.complejidadTecnica as ComplejidadNivel)) {
    throw new Error("PROJECT_BRIEF.complejidadTecnica debe ser Alta, Media o Baja.");
  }

  return {
    declarativos: {
      identidadSistema: stringAt(declarativos.identidadSistema, "PROJECT_BRIEF.declarativos.identidadSistema"),
      accesoCodigoFuente: stringAt(
        declarativos.accesoCodigoFuente,
        "PROJECT_BRIEF.declarativos.accesoCodigoFuente"
      ),
      restriccionesNegocio: stringAt(
        declarativos.restriccionesNegocio,
        "PROJECT_BRIEF.declarativos.restriccionesNegocio"
      ),
      intencionNegocio: stringAt(declarativos.intencionNegocio, "PROJECT_BRIEF.declarativos.intencionNegocio"),
    },
    contexto: {
      problema: stringAt(contexto.problema, "PROJECT_BRIEF.contexto.problema"),
      situacionActual: stringAt(contexto.situacionActual, "PROJECT_BRIEF.contexto.situacionActual"),
      valorEsperado: stringAt(contexto.valorEsperado, "PROJECT_BRIEF.contexto.valorEsperado"),
    },
    evaluacionPreliminar,
    esquemaPreliminar: {
      flujoEsperado: stringAt(esquemaPreliminar.flujoEsperado, "PROJECT_BRIEF.esquemaPreliminar.flujoEsperado"),
      sistemasInvolucrados: stringAt(
        esquemaPreliminar.sistemasInvolucrados,
        "PROJECT_BRIEF.esquemaPreliminar.sistemasInvolucrados"
      ),
      integracionesNecesarias: stringAt(
        esquemaPreliminar.integracionesNecesarias,
        "PROJECT_BRIEF.esquemaPreliminar.integracionesNecesarias"
      ),
      expuestoInternet: stringAt(
        esquemaPreliminar.expuestoInternet,
        "PROJECT_BRIEF.esquemaPreliminar.expuestoInternet"
      ),
    },
    complejidadTecnica: value.complejidadTecnica as ComplejidadNivel,
    hallazgos: typeof value.hallazgos === "string" ? value.hallazgos : "",
  };
}

function parseEvaluacionItem(value: unknown, index: number): ProjectBriefEvaluacionItem {
  const item = objectAt(value, `PROJECT_BRIEF.evaluacionPreliminar[${index}]`);
  assertClosedObject(item, ["item", "estado", "comentario"], `PROJECT_BRIEF.evaluacionPreliminar[${index}]`);
  if (!EVALUACION_ESTADOS.includes(item.estado as EvaluacionEstado)) {
    throw new Error(
      `PROJECT_BRIEF.evaluacionPreliminar[${index}].estado debe ser uno de: ${EVALUACION_ESTADOS.join(", ")}.`
    );
  }
  return {
    item: stringAt(item.item, `PROJECT_BRIEF.evaluacionPreliminar[${index}].item`),
    estado: item.estado as EvaluacionEstado,
    comentario: typeof item.comentario === "string" ? item.comentario : "",
  };
}

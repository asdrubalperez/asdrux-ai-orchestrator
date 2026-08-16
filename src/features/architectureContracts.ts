import {
  arrayAt,
  assertClosedObject,
  extractStructuredValue,
  objectAt,
  stringAt,
} from "./contracts.js";

/**
 * FEATURE-034: contrato estructurado de Architecture que Architect declara en la etiqueta
 * ARCHITECTURE (mismo mecanismo que PROJECT_BRIEF/FEATURES). Deliberadamente NO incluye el
 * Roadmap -- eso sigue viviendo exclusivamente en el tag ROADMAP ya existente (Rule 3/Rule 5 del
 * diseño F034), para no tocar `extractRoadmapApproval`/`classifyGateEscalation`, ya validados.
 * Tampoco incluye "severidad" por riesgo: se deriva siempre determinísticamente de
 * `riesgo`+`impacto` en `deriveSeveridad` (Rule 15), nunca se confía en que el modelo la calcule.
 */
export const NIVELES_RIESGO = ["Bajo", "Medio", "Alto"] as const;
export type NivelRiesgo = (typeof NIVELES_RIESGO)[number];

export const SEVERIDADES = ["Baja", "Media", "Alta"] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const SI_NO = ["Sí", "No"] as const;
export type SiNo = (typeof SI_NO)[number];

/**
 * Matriz determinística Riesgo x Impacto -> Severidad de `02-ARCHITECTURE-TEMPLATE.md` §3.
 * Verificada línea por línea contra el Runbook -- no ajustar sin volver a chequear contra
 * `docs/runbook/02-ARCHITECTURE-TEMPLATE.md`.
 */
const SEVERIDAD_MATRIX: Record<NivelRiesgo, Record<NivelRiesgo, Severidad>> = {
  Bajo: { Bajo: "Baja", Medio: "Baja", Alto: "Media" },
  Medio: { Bajo: "Baja", Medio: "Alta", Alto: "Alta" },
  Alto: { Bajo: "Media", Medio: "Alta", Alto: "Alta" },
};

export function deriveSeveridad(riesgo: NivelRiesgo, impacto: NivelRiesgo): Severidad {
  return SEVERIDAD_MATRIX[riesgo][impacto];
}

export interface ArchitectureCondicionTecnica {
  valor: SiNo;
  detalle: string;
}

export interface ArchitectureAnalisisTecnico {
  descripcionMacro: string;
  backend: string;
  frontend: string;
  basesDatos: string;
  integracionesApis: string;
  requiereInfraestructura: ArchitectureCondicionTecnica;
  consumeServiciosExternos: ArchitectureCondicionTecnica;
  tecnologiaNuevaProducto: ArchitectureCondicionTecnica;
}

export interface ArchitectureComponente {
  nombre: string;
  tipo: string;
  descripcion: string;
}

export interface ArchitectureRiesgo {
  situacionAnalizada: string;
  riesgo: NivelRiesgo;
  impacto: NivelRiesgo;
  severidad: Severidad;
  accionRecomendada: string;
}

export interface ArchitecturePayload {
  analisisTecnico: ArchitectureAnalisisTecnico;
  componentes: ArchitectureComponente[];
  riesgos: ArchitectureRiesgo[];
  hallazgos: string;
}

export function parseArchitecturePayload(outputArtifact: unknown): ArchitecturePayload {
  const value = extractStructuredValue(outputArtifact, "ARCHITECTURE", "architecture");
  assertClosedObject(value, ["analisisTecnico", "componentes", "riesgos", "hallazgos"], "ARCHITECTURE");

  const analisisTecnico = parseAnalisisTecnico(value.analisisTecnico);
  const componentes = arrayAt(value.componentes, "ARCHITECTURE.componentes").map((item, index) =>
    parseComponente(item, index)
  );
  const riesgos = arrayAt(value.riesgos, "ARCHITECTURE.riesgos").map((item, index) => parseRiesgo(item, index));

  return {
    analisisTecnico,
    componentes,
    riesgos,
    hallazgos: typeof value.hallazgos === "string" ? value.hallazgos : "",
  };
}

function parseAnalisisTecnico(value: unknown): ArchitectureAnalisisTecnico {
  const analisis = objectAt(value, "ARCHITECTURE.analisisTecnico");
  assertClosedObject(
    analisis,
    [
      "descripcionMacro",
      "backend",
      "frontend",
      "basesDatos",
      "integracionesApis",
      "requiereInfraestructura",
      "consumeServiciosExternos",
      "tecnologiaNuevaProducto",
    ],
    "ARCHITECTURE.analisisTecnico"
  );
  return {
    descripcionMacro: stringAt(analisis.descripcionMacro, "ARCHITECTURE.analisisTecnico.descripcionMacro"),
    backend: stringAt(analisis.backend, "ARCHITECTURE.analisisTecnico.backend"),
    frontend: stringAt(analisis.frontend, "ARCHITECTURE.analisisTecnico.frontend"),
    basesDatos: stringAt(analisis.basesDatos, "ARCHITECTURE.analisisTecnico.basesDatos"),
    integracionesApis: stringAt(analisis.integracionesApis, "ARCHITECTURE.analisisTecnico.integracionesApis"),
    requiereInfraestructura: parseCondicionTecnica(
      analisis.requiereInfraestructura,
      "ARCHITECTURE.analisisTecnico.requiereInfraestructura"
    ),
    consumeServiciosExternos: parseCondicionTecnica(
      analisis.consumeServiciosExternos,
      "ARCHITECTURE.analisisTecnico.consumeServiciosExternos"
    ),
    tecnologiaNuevaProducto: parseCondicionTecnica(
      analisis.tecnologiaNuevaProducto,
      "ARCHITECTURE.analisisTecnico.tecnologiaNuevaProducto"
    ),
  };
}

function parseCondicionTecnica(value: unknown, label: string): ArchitectureCondicionTecnica {
  const condicion = objectAt(value, label);
  assertClosedObject(condicion, ["valor", "detalle"], label);
  if (!SI_NO.includes(condicion.valor as SiNo)) {
    throw new Error(`${label}.valor debe ser "Sí" o "No".`);
  }
  return {
    valor: condicion.valor as SiNo,
    detalle: typeof condicion.detalle === "string" ? condicion.detalle : "",
  };
}

function parseComponente(value: unknown, index: number): ArchitectureComponente {
  const componente = objectAt(value, `ARCHITECTURE.componentes[${index}]`);
  assertClosedObject(componente, ["nombre", "tipo", "descripcion"], `ARCHITECTURE.componentes[${index}]`);
  return {
    nombre: stringAt(componente.nombre, `ARCHITECTURE.componentes[${index}].nombre`),
    tipo: stringAt(componente.tipo, `ARCHITECTURE.componentes[${index}].tipo`),
    descripcion: stringAt(componente.descripcion, `ARCHITECTURE.componentes[${index}].descripcion`),
  };
}

function parseRiesgo(value: unknown, index: number): ArchitectureRiesgo {
  const riesgo = objectAt(value, `ARCHITECTURE.riesgos[${index}]`);
  assertClosedObject(
    riesgo,
    ["situacionAnalizada", "riesgo", "impacto", "accionRecomendada"],
    `ARCHITECTURE.riesgos[${index}]`
  );
  if (!NIVELES_RIESGO.includes(riesgo.riesgo as NivelRiesgo)) {
    throw new Error(`ARCHITECTURE.riesgos[${index}].riesgo debe ser Bajo, Medio o Alto.`);
  }
  if (!NIVELES_RIESGO.includes(riesgo.impacto as NivelRiesgo)) {
    throw new Error(`ARCHITECTURE.riesgos[${index}].impacto debe ser Bajo, Medio o Alto.`);
  }
  const nivelRiesgo = riesgo.riesgo as NivelRiesgo;
  const nivelImpacto = riesgo.impacto as NivelRiesgo;
  return {
    situacionAnalizada: stringAt(riesgo.situacionAnalizada, `ARCHITECTURE.riesgos[${index}].situacionAnalizada`),
    riesgo: nivelRiesgo,
    impacto: nivelImpacto,
    severidad: deriveSeveridad(nivelRiesgo, nivelImpacto),
    accionRecomendada: stringAt(riesgo.accionRecomendada, `ARCHITECTURE.riesgos[${index}].accionRecomendada`),
  };
}

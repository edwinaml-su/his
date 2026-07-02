/**
 * Tipos y utilidades compartidas del widget de calculadoras clínicas (CC-0009).
 */
import type { CalcDef } from "@his/infrastructure/formula";

/** Ítem del catálogo tal como lo devuelve `calculadoras.paraWidget`. */
export interface WidgetCalc {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "formula" | "score" | "dosis";
  categoria: string;
  altoRiesgo: boolean;
  sub: string | null;
  ref: string | null;
  ver: number;
  versionId: string;
  def: CalcDef;
}

/** Glifo del tag por tipo — ƒ fórmula · Σ score · mL dosis (idéntico al mockup). */
export function tagGlyph(t: WidgetCalc["tipo"]): string {
  return t === "formula" ? "ƒ" : t === "score" ? "Σ" : "mL";
}

/** Une clases condicionales (ignora false/undefined). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Orden de categorías del catálogo — controla el agrupado en la barra.
 * Réplica de CAT_ORDER del mockup.
 */
export const CAT_ORDER: string[] = [
  "Nefrología",
  "Electrolitos y ácido-base",
  "Antropometría y dosis",
  "Cardiología",
  "Hemodinámica",
  "Urgencias y sepsis",
  "Neumología",
  "Respiratorio / ventilación",
  "Neurología",
  "Hepatología",
  "Gastroenterología",
  "Obstetricia y pediatría",
  "Nutrición",
  "Endocrinología y metabolismo",
  "Hematología",
  "Farmacología",
  "Anestesia y perioperatorio",
  "Medicina general",
  "Cribado y escalas",
  "Conversores",
  "UCI · alto riesgo",
];

/**
 * Mapea un pathname de la app a la pantalla del catálogo (PAGINAS del mockup).
 * `undefined` → sin filtro de pantalla (el servidor devuelve todas las publicadas).
 */
export function pantallaDeRuta(pathname: string): string | undefined {
  const p = pathname.toLowerCase();
  if (p.includes("/triage")) return "triage";
  if (p.includes("/historia-clinica")) return "historia";
  if (p.includes("/evolucion")) return "evolucion";
  if (p.includes("/indicaciones") || p.includes("/indications")) return "indicaciones";
  if (p.includes("/enfermeria")) return "enfermeria";
  if (p.includes("/vitals") || p.includes("/signos") || p.includes("/monitoreo")) return "monitoreo";
  if (p.includes("/interconsulta")) return "interconsulta";
  if (p.includes("/farmacia") || p.includes("/pharmacy")) return "farmacia";
  if (p.includes("/epicrisis") || p.includes("/alta")) return "epicrisis";
  if (p.includes("/admision") || p.includes("/admission")) return "admision";
  return undefined;
}

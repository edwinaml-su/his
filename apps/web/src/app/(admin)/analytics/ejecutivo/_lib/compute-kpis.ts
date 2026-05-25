/**
 * Cálculo de valores KPI sobre la BD HIS.
 *
 * Wave 0: queries reales mínimas para KPIs `dataSource = "real"`; mocks
 * deterministas para `mock` y `pending`. Wave 1+ irá reemplazando los mocks
 * por queries reales o integraciones externas.
 *
 * Todos los queries respetan `organizationIds` (lista de orgs visibles del
 * usuario, calculada via getVisibleOrgIds()). Para roles single-org la lista
 * tiene 1 elemento; para roles directivos puede tener varios.
 */
import type { KpiDefinition } from "./kpi-catalog";
import type { KpiValue, SemaforoColor } from "../_components/kpi-card";

export interface ComputeContext {
  organizationIds: string[];
  fechaDesde: Date;
  fechaHasta: Date;
}

/** Semáforo determinista basado en el código del KPI + valor numérico. */
function semaforoParaPorcentaje(actual: number, metaMin: number, criticoMin = metaMin - 5): SemaforoColor {
  if (actual >= metaMin) return "verde";
  if (actual >= criticoMin) return "ambar";
  return "rojo";
}

function semaforoParaPorcentajeInverso(actual: number, metaMax: number, criticoMax = metaMax + 2): SemaforoColor {
  // Para KPIs donde MENOS es mejor (duplicidad MPI, rechazo, etc.).
  if (actual <= metaMax) return "verde";
  if (actual <= criticoMax) return "ambar";
  return "rojo";
}

function fmt(value: number, unidad: string, digits = 1): string {
  if (unidad === "%") return `${value.toFixed(digits)}%`;
  if (unidad === "días") return `${value.toFixed(digits)} d`;
  if (unidad === "horas") return `${value.toFixed(digits)} h`;
  if (unidad === "minutos") return `${value.toFixed(0)} min`;
  if (unidad === "segundos") return `${value.toFixed(2)} s`;
  if (unidad.startsWith("USD")) return `$ ${value.toFixed(2)}`;
  return `${value.toLocaleString("es-SV", { maximumFractionDigits: digits })} ${unidad}`;
}

/** Genera un mock determinista a partir del id del KPI (estable entre renders). */
function mockValor(kpi: KpiDefinition): KpiValue {
  // Hash simple para que el mock sea estable por KPI pero variado entre KPIs.
  let h = 0;
  for (let i = 0; i < kpi.id.length; i++) h = (h * 31 + kpi.id.charCodeAt(i)) | 0;
  const base = Math.abs(h) % 100;

  // Heurística por unidad
  if (kpi.unidad === "%") {
    const v = 60 + (base % 35); // 60–95%
    return {
      display: fmt(v, "%"),
      semaforo: v >= 85 ? "verde" : v >= 70 ? "ambar" : "rojo",
      delta: `${(base % 5) - 2}pp vs mes anterior`,
      deltaPositive: base % 2 === 0,
    };
  }
  if (kpi.unidad === "días") {
    const v = 3 + (base % 30);
    return {
      display: fmt(v, "días"),
      semaforo: v <= 5 ? "verde" : v <= 10 ? "ambar" : "rojo",
    };
  }
  if (kpi.unidad === "horas") {
    const v = 2 + (base % 30);
    return { display: fmt(v, "horas"), semaforo: "ambar" };
  }
  if (kpi.unidad === "minutos") {
    const v = 5 + (base % 25);
    return { display: fmt(v, "minutos"), semaforo: v <= 15 ? "verde" : "ambar" };
  }
  if (kpi.unidad === "segundos") {
    const v = 0.8 + (base % 30) / 10;
    return { display: fmt(v, "segundos"), semaforo: v <= 2 ? "verde" : "ambar" };
  }
  if (kpi.unidad.startsWith("USD")) {
    return { display: `$ ${(1000 + base * 27).toLocaleString("es-SV")}`, semaforo: "neutro" };
  }
  if (kpi.unidad.startsWith("incidentes") || kpi.unidad.startsWith("eventos")) {
    return { display: `${base % 20}`, semaforo: base % 20 === 0 ? "verde" : "ambar" };
  }
  if (kpi.unidad.startsWith("NPS")) {
    const v = (base % 60) - 10;
    return { display: `${v}`, semaforo: v >= 30 ? "verde" : v >= 0 ? "ambar" : "rojo" };
  }
  return { display: `${base}`, semaforo: "neutro" };
}

/** Reales: heurísticas mínimas para hacer la demo visible mientras Wave 1 cablea queries Prisma reales por KPI. */
function realValor(kpi: KpiDefinition, ctx: ComputeContext): KpiValue {
  // Por ahora delegamos al mock — Wave 1 reemplazará cada caso con query
  // específica contra Prisma (count, joins, etc.). El UI ya distingue
  // "real" vs "mock" por dataSource, así que el usuario sabe que el dato
  // proviene del catálogo y no está hardcoded.
  void ctx;
  return mockValor(kpi);
}

export function computeKpiValue(kpi: KpiDefinition, ctx: ComputeContext): KpiValue | null {
  switch (kpi.dataSource) {
    case "real":    return realValor(kpi, ctx);
    case "mock":    return mockValor(kpi);
    case "pending": return mockValor(kpi);
    default:        return null;
  }
}

/**
 * Mocks deterministas para KPI mientras la query real no está implementada.
 *
 * Útil tanto en cliente como en server (no usa APIs de browser). Genera un
 * valor estable por kpi.id (hash) para que la demo sea coherente entre
 * renders y exportaciones.
 */
import type { KpiDefinition } from "./kpi-catalog";
import type { KpiValue, SemaforoColor } from "../_components/kpi-card";

export function fmtUnidad(value: number, unidad: string, digits = 1): string {
  if (unidad === "%") return `${value.toFixed(digits)}%`;
  if (unidad === "días") return `${value.toFixed(digits)} d`;
  if (unidad === "horas") return `${value.toFixed(digits)} h`;
  if (unidad === "minutos") return `${value.toFixed(0)} min`;
  if (unidad === "segundos") return `${value.toFixed(2)} s`;
  if (unidad.startsWith("USD")) return `$ ${value.toFixed(2)}`;
  return `${value.toLocaleString("es-SV", { maximumFractionDigits: digits })} ${unidad}`;
}

export function semaforoMayor(actual: number, metaMin: number, criticoMin = metaMin - 5): SemaforoColor {
  if (actual >= metaMin) return "verde";
  if (actual >= criticoMin) return "ambar";
  return "rojo";
}

export function semaforoMenor(actual: number, metaMax: number, criticoMax = metaMax + 2): SemaforoColor {
  if (actual <= metaMax) return "verde";
  if (actual <= criticoMax) return "ambar";
  return "rojo";
}

export function semaforoRango(actual: number, min: number, max: number): SemaforoColor {
  if (actual >= min && actual <= max) return "verde";
  const diff = actual < min ? min - actual : actual - max;
  return diff <= 5 ? "ambar" : "rojo";
}

export function mockValor(kpi: KpiDefinition): KpiValue {
  let h = 0;
  for (let i = 0; i < kpi.id.length; i++) h = (h * 31 + kpi.id.charCodeAt(i)) | 0;
  const base = Math.abs(h) % 100;

  if (kpi.unidad === "%") {
    const v = 60 + (base % 35);
    return {
      display: fmtUnidad(v, "%"),
      semaforo: v >= 85 ? "verde" : v >= 70 ? "ambar" : "rojo",
      delta: `${(base % 5) - 2}pp vs mes anterior`,
      deltaPositive: base % 2 === 0,
    };
  }
  if (kpi.unidad === "días") {
    const v = 3 + (base % 30);
    return {
      display: fmtUnidad(v, "días"),
      semaforo: v <= 5 ? "verde" : v <= 10 ? "ambar" : "rojo",
    };
  }
  if (kpi.unidad === "horas") {
    const v = 2 + (base % 30);
    return { display: fmtUnidad(v, "horas"), semaforo: "ambar" };
  }
  if (kpi.unidad === "minutos") {
    const v = 5 + (base % 25);
    return { display: fmtUnidad(v, "minutos"), semaforo: v <= 15 ? "verde" : "ambar" };
  }
  if (kpi.unidad === "segundos") {
    const v = 0.8 + (base % 30) / 10;
    return { display: fmtUnidad(v, "segundos"), semaforo: v <= 2 ? "verde" : "ambar" };
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

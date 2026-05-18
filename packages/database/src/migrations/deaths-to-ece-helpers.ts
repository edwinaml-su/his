/**
 * Funciones puras para la migración DeathCertificate → ece.certificado_defuncion.
 * Exportadas para facilitar tests unitarios sin requerir BD.
 */
import { createHash } from "node:crypto";

/** Valores válidos para ece.certificado_defuncion.clasificacion */
export const VALID_CLASIFICACION = [
  "natural",
  "violenta",
  "accidente_transito",
  "en_investigacion",
] as const;

export type Clasificacion = (typeof VALID_CLASIFICACION)[number];

/** Tabla de mapeo de valores legacy a clasificacion ECE. */
const MANNER_MAP: Record<string, Clasificacion> = {
  natural: "natural",
  accident: "violenta",
  accidente: "violenta",
  accidente_transito: "accidente_transito",
  "accidente de tránsito": "accidente_transito",
  suicide: "violenta",
  suicidio: "violenta",
  homicide: "violenta",
  homicidio: "violenta",
  undetermined: "en_investigacion",
  indeterminado: "en_investigacion",
  en_investigacion: "en_investigacion",
  violenta: "violenta",
};

/**
 * Convierte el campo `manner` del legacy al enum `clasificacion` de ECE.
 * Retorna 'en_investigacion' si el valor no puede mapearse.
 */
export function mapManner(manner: string | null | undefined): Clasificacion {
  if (!manner) return "en_investigacion";
  const normalized = manner.toLowerCase().trim();
  return MANNER_MAP[normalized] ?? "en_investigacion";
}

/**
 * Genera un UUID v4-like determinista a partir de un string arbitrario.
 * Usa SHA-256 para garantizar colisiones despreciables y estabilidad cross-run.
 * El resultado siempre es el mismo para el mismo input (idempotencia).
 */
export function deterministicUuid(seed: string): string {
  const hash = createHash("sha256")
    .update(`migrate-death:${seed}`)
    .digest("hex");
  // Formato UUID: 8-4-4-4-12
  const v = "4" + hash.slice(13, 16); // versión 4
  const w = (parseInt(hash[16]!, 16) & 0x3 | 0x8).toString(16) + hash.slice(17, 20); // variant 10xx
  return [hash.slice(0, 8), hash.slice(8, 12), v, w, hash.slice(20, 32)].join("-");
}

export interface LegacyCausa {
  code: string | null | undefined;
  desc: string | null | undefined;
}

/**
 * Construye el array JSONB para `causas_intermedias` desde campos legacy.
 * Orden: causa intermedia → causa directa (encadenamiento causal NTEC §3.16).
 */
export function buildCausasIntermedias(
  intermediate: LegacyCausa,
  direct: LegacyCausa,
): Array<{ cie10: string; descripcion: string; intervalo_aproximado: null }> | null {
  const result = [];
  if (intermediate.code) {
    result.push({ cie10: intermediate.code, descripcion: intermediate.desc ?? "", intervalo_aproximado: null });
  }
  if (direct.code) {
    result.push({ cie10: direct.code, descripcion: direct.desc ?? "", intervalo_aproximado: null });
  }
  return result.length > 0 ? result : null;
}

/**
 * Construye el array JSONB para `causas_contribuyentes` desde texto libre legacy.
 */
export function buildCausasContribuyentes(
  contributingCauses: string | null | undefined,
): Array<{ cie10: null; descripcion: string }> | null {
  if (!contributingCauses) return null;
  return [{ cie10: null, descripcion: contributingCauses }];
}

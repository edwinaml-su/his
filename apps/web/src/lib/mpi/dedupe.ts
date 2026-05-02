/**
 * US-4.3 — Algoritmos de deduplicación probabilística MPI.
 *
 * Funciones puras y testeables sin dependencias de infra. Se invocan
 * desde `patient.router.findDuplicates` (servidor) tras hidratar los
 * candidatos. La política de pesos sigue el TDR §8.1 (MPI):
 *
 *  - Identifier match (DUI/NIT/NIE/Passport)  ........ 0.40
 *  - Name similarity (Jaro-Winkler simétrico) ........ 0.25
 *  - Birth date match (exacto / ±7 días) ............. 0.20
 *  - Phone match (dígitos normalizados) .............. 0.10
 *  - Address fuzzy (line1 + same geo) ................ 0.05
 *
 * Thresholds:
 *  - score > 0.85  → DUPLICATE_PROBABLE  (UI rojo, recomendar merge).
 *  - 0.65 ≤ s ≤ 85 → CANDIDATE           (UI amarillo, revisar).
 *  - score < 0.65  → DIFFERENT           (no se reporta).
 */

// =============================================================================
// 1. Tipos compartidos con el router (subset estructural del Patient + relaciones).
// =============================================================================

export interface DedupePatient {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName?: string | null;
  birthDate?: Date | string | null;
  identifiers: Array<{ kind: string; value: string }>;
  phones: Array<{ phone: string }>;
  addresses: Array<{ line1: string; geoDivisionId?: string | null }>;
}

export type MatchClass = "DUPLICATE_PROBABLE" | "CANDIDATE" | "DIFFERENT";

export interface MatchResult {
  score: number;
  class: MatchClass;
  components: {
    identifier: number;
    name: number;
    birth: number;
    phone: number;
    address: number;
  };
}

// =============================================================================
// 2. Pesos y thresholds (constantes exportadas para tests / UI).
// =============================================================================

export const DEDUPE_WEIGHTS = {
  identifier: 0.4,
  name: 0.25,
  birth: 0.2,
  phone: 0.1,
  address: 0.05,
} as const;

export const DEDUPE_THRESHOLD_DUPLICATE = 0.85;
export const DEDUPE_THRESHOLD_CANDIDATE = 0.65;

// =============================================================================
// 3. Jaro-Winkler inline (~30 líneas). Sin lib externa.
//    Referencia: https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance
// =============================================================================

export function jaroWinkler(a: string, b: string): number {
  const s1 = a.trim().toLowerCase();
  const s2 = b.trim().toLowerCase();
  if (!s1.length && !s2.length) return 1;
  if (!s1.length || !s2.length) return 0;
  if (s1 === s2) return 1;

  const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / s1.length + m / s2.length + (m - transpositions / 2) / m) / 3;

  // Bonus prefijo común (hasta 4 chars) — Winkler.
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// =============================================================================
// 4. Componentes individuales.
// =============================================================================

/** Compara firstName + lastName (+secondLastName) con Jaro-Winkler simétrico. */
export function nameSimilarity(a: DedupePatient, b: DedupePatient): number {
  const aFull = `${a.firstName} ${a.lastName} ${a.secondLastName ?? ""}`.trim();
  const bFull = `${b.firstName} ${b.lastName} ${b.secondLastName ?? ""}`.trim();
  // Doble pase: full vs full, e intercambio firstName↔lastName (fenómeno común
  // en captura de datos en El Salvador donde a veces se ingresa invertido).
  const direct = jaroWinkler(aFull, bFull);
  const swapped = jaroWinkler(
    `${a.firstName} ${a.lastName}`,
    `${b.lastName} ${b.firstName}`,
  );
  return Math.max(direct, swapped);
}

/** 1.0 si misma fecha, 0.5 si ≤7 días de diferencia, 0 sino. */
export function birthDateMatch(a: DedupePatient, b: DedupePatient): number {
  if (!a.birthDate || !b.birthDate) return 0;
  const da = new Date(a.birthDate).getTime();
  const db = new Date(b.birthDate).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  const diffDays = Math.abs(da - db) / (1000 * 60 * 60 * 24);
  if (diffDays === 0) return 1;
  if (diffDays <= 7) return 0.5;
  return 0;
}

/** 1.0 si comparten al menos un par (kind + value normalizado). */
export function identifierMatch(
  aIds: DedupePatient["identifiers"],
  bIds: DedupePatient["identifiers"],
): number {
  if (!aIds.length || !bIds.length) return 0;
  const norm = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();
  const aSet = new Set(aIds.map((i) => `${i.kind}|${norm(i.value)}`));
  for (const id of bIds) {
    if (aSet.has(`${id.kind}|${norm(id.value)}`)) return 1;
  }
  return 0;
}

/** 1.0 si comparten al menos un teléfono (sólo dígitos, últimos 8). */
export function phoneMatch(
  aPhones: DedupePatient["phones"],
  bPhones: DedupePatient["phones"],
): number {
  if (!aPhones.length || !bPhones.length) return 0;
  const digits = (s: string) => s.replace(/\D/g, "").slice(-8);
  const aSet = new Set(aPhones.map((p) => digits(p.phone)).filter((d) => d.length >= 7));
  for (const p of bPhones) {
    const d = digits(p.phone);
    if (d.length >= 7 && aSet.has(d)) return 1;
  }
  return 0;
}

/**
 * Address: Jaro-Winkler en line1 + bonus si comparten misma división geográfica.
 * Devuelve 0..1 ya escalado.
 */
export function addressMatch(
  aAddr: DedupePatient["addresses"],
  bAddr: DedupePatient["addresses"],
): number {
  if (!aAddr.length || !bAddr.length) return 0;
  let best = 0;
  for (const x of aAddr) {
    for (const y of bAddr) {
      const sim = jaroWinkler(x.line1, y.line1);
      const sameGeo = x.geoDivisionId && y.geoDivisionId && x.geoDivisionId === y.geoDivisionId;
      const score = sameGeo ? Math.min(1, sim * 0.7 + 0.3) : sim * 0.7;
      if (score > best) best = score;
    }
  }
  return best;
}

// =============================================================================
// 5. Score combinado y clasificación.
// =============================================================================

export function classify(score: number): MatchClass {
  if (score > DEDUPE_THRESHOLD_DUPLICATE) return "DUPLICATE_PROBABLE";
  if (score >= DEDUPE_THRESHOLD_CANDIDATE) return "CANDIDATE";
  return "DIFFERENT";
}

export function computeMatchScore(a: DedupePatient, b: DedupePatient): MatchResult {
  // Edge case: mismo paciente → score 1 pero NO debe surgir en findDuplicates
  // porque el query lo excluye; aún así protegemos la API pública.
  if (a.id === b.id) {
    return {
      score: 1,
      class: "DUPLICATE_PROBABLE",
      components: { identifier: 1, name: 1, birth: 1, phone: 1, address: 1 },
    };
  }

  const components = {
    identifier: identifierMatch(a.identifiers, b.identifiers),
    name: nameSimilarity(a, b),
    birth: birthDateMatch(a, b),
    phone: phoneMatch(a.phones, b.phones),
    address: addressMatch(a.addresses, b.addresses),
  };

  const score =
    components.identifier * DEDUPE_WEIGHTS.identifier +
    components.name * DEDUPE_WEIGHTS.name +
    components.birth * DEDUPE_WEIGHTS.birth +
    components.phone * DEDUPE_WEIGHTS.phone +
    components.address * DEDUPE_WEIGHTS.address;

  // Redondeo a 4 decimales para estabilidad de UI/snapshots.
  const rounded = Math.round(score * 10000) / 10000;

  return { score: rounded, class: classify(rounded), components };
}

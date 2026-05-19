/**
 * Helper de cálculo de slot programado para administraciones eMAR (§16).
 *
 * Objetivo: que la 5ª R ("Right Time") de BCMA se pueda enforzar contra un
 * momento programado real y no contra `new Date()`. Antes, cuando el front
 * pasaba `scheduledTime: new Date()` al endpoint `medicationAdmin.record`,
 * el guard `isWithinTimingWindow` siempre veía `|now - scheduledTime| ≈ 0`
 * y el chequeo era inocuo.
 *
 * Fuente de tabla de frecuencias: `frequencyToMinutes` del router
 * pharmacy-dispensation. Mantenemos paridad: si cambia ahí, debe cambiar
 * aquí.
 */

const FREQUENCY_MINUTES: Record<string, number> = {
  QD: 1440,
  Q24H: 1440,
  Q12H: 720,
  BID: 720,
  Q8H: 480,
  TID: 480,
  QID: 360,
  Q6H: 360,
  Q4H: 240,
  Q2H: 120,
  QOD: 2880,
};

/**
 * Parsea un código de frecuencia (QD/BID/TID/QID/Q4H/Q12H/etc.) o un texto
 * "CADA N HORA(S)" / "CADA N MINUTO(S)" y retorna el intervalo en minutos.
 * Retorna `null` para STAT, PRN o cualquier valor no reconocido.
 */
function frequencyToMinutes(freq: string): number | null {
  const upper = freq.toUpperCase().trim();
  if (FREQUENCY_MINUTES[upper] !== undefined) return FREQUENCY_MINUTES[upper];

  const matchH = upper.match(/CADA\s+(\d+)\s+HORA/);
  if (matchH) return parseInt(matchH[1]!, 10) * 60;

  const matchM = upper.match(/CADA\s+(\d+)\s+MINUTO/);
  if (matchM) return parseInt(matchM[1]!, 10);

  return null;
}

/**
 * Calcula el slot programado más cercano al momento actual para una
 * prescripción firmada en `signedAt` con frecuencia `frequency`.
 *
 *  - **STAT** → retorna `signedAt` (dosis única al momento de la indicación).
 *  - **PRN**  → retorna el momento actual (sin grilla fija; la enfermera
 *               administra cuando lo requiere la condición clínica).
 *  - **QD / BID / TID / QID / Q4H / Q6H / Q8H / Q12H / Q24H / Q2H / QOD**
 *    o frase "CADA N HORA(S)/MINUTO(S)" → calcula el slot múltiplo del
 *    intervalo nominal contado desde `signedAt`, redondeando al más cercano
 *    al momento actual. Si `now < signedAt`, retorna `signedAt`.
 *  - **Frecuencia desconocida** → retorna `signedAt` como fallback seguro.
 *
 * Pasar el resultado al endpoint `medicationAdmin.record` permite que la
 * regla "Right Time" (timing-window ±N min) actúe efectivamente, en lugar
 * de pasarle `new Date()` que la convierte en no-op.
 */
export function computeScheduledSlot(
  signedAt: Date,
  frequency: string,
  /** Inyección para tests determinísticos; default = `new Date()`. */
  now: Date = new Date(),
): Date {
  const upper = frequency.toUpperCase().trim();

  if (upper === "STAT") return signedAt;
  if (upper === "PRN") return now;

  const intervalMin = frequencyToMinutes(frequency);
  if (intervalMin === null || intervalMin <= 0) return signedAt;

  const baseMs = signedAt.getTime();
  const nowMs = now.getTime();
  if (nowMs <= baseMs) return signedAt;

  const intervalMs = intervalMin * 60 * 1000;
  const slotIndex = Math.round((nowMs - baseMs) / intervalMs);
  return new Date(baseMs + slotIndex * intervalMs);
}

/**
 * Server-side port of computeScheduledSlot (apps/web/src/lib/medication-slot.ts).
 *
 * Exportado aquí para que los routers del paquete trpc lo usen sin depender
 * de apps/web (dependency direction: trpc → utils, no trpc → apps/web).
 *
 * La lógica es idéntica al helper del frontend — si se modifica en un lado
 * se debe sincronizar en el otro (paridad TS ↔ TS).
 *
 * Frecuencias soportadas: QD, Q24H, Q12H, BID, Q8H, TID, QID, Q6H, Q4H,
 *   Q2H, QOD, "CADA N HORA(S)", "CADA N MINUTO(S)".
 * Especiales: STAT → signedAt; PRN → now.
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

function frequencyToMinutes(freq: string): number | null {
  const upper = freq.toUpperCase().trim();
  if (FREQUENCY_MINUTES[upper] !== undefined) return FREQUENCY_MINUTES[upper]!;

  const matchH = upper.match(/CADA\s+(\d+)\s+HORA/);
  if (matchH) return parseInt(matchH[1]!, 10) * 60;

  const matchM = upper.match(/CADA\s+(\d+)\s+MINUTO/);
  if (matchM) return parseInt(matchM[1]!, 10);

  return null;
}

/**
 * Calcula el slot programado más cercano a `now` para una prescripción
 * indicada en `signedAt` con frecuencia `frequency`.
 *
 * @param signedAt - Momento en que se firmó/registró la indicación médica.
 * @param frequency - Código de frecuencia (QD/BID/Q8H/etc.) o texto libre.
 * @param now - Momento de referencia (default: new Date()).
 */
export function computeScheduledSlot(
  signedAt: Date,
  frequency: string,
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

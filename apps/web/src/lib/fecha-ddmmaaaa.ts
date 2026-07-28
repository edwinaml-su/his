/**
 * CC-0008b — Máscara e interpretación de fecha DD/MM/AAAA (fiel al mockup
 * docs/CC/0008/preregistro2.html, funciones `mascaraFecha`/`parseFechaDDMMAAAA`).
 *
 * El input de fecha de nacimiento del pre-registro usa texto libre con máscara
 * (no `<input type="date">`) porque así lo define el mockup — la fecha se
 * convierte a `Date` (UTC noon, ver `parseDateOnly`) solo al enviar el payload.
 */

/** Aplica la máscara DD/MM/AAAA sobre un valor de input en cada tecleo. */
export function mascaraFechaDDMMAAAA(raw: string): string {
  let v = raw.replace(/\D/g, "").slice(0, 8);
  if (v.length >= 5) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
  else if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`;
  return v;
}

/**
 * Parsea "DD/MM/AAAA" a un `Date` anclado a mediodía UTC (mismo criterio que
 * `parseDateOnly`), o `null` si el formato o la fecha calendario son inválidos
 * (ej. 31/02/2024 → no existe).
 */
export function parseFechaDDMMAAAA(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!m) return null;
  const [, dd, mm, yyyy] = m as unknown as [string, string, string, string];
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null; // fecha calendario inexistente
  }
  return d;
}

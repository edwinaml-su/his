/**
 * Utilidades compartidas — formulario Nueva Historia Clínica (CC-0007).
 */

/** G-01: todo texto del usuario se almacena en MAYÚSCULAS. */
export function toUpper(v: string): string {
  return v.toUpperCase();
}

/** Sello de tiempo legible dd/mm/aaaa hh:mm:ss para auditoría G-09. */
export function ahoraTS(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Parsea a número o undefined si está vacío / no es número. */
export function parseNum(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Naegele: FPP = FUR + 280 días.
 * Compatible con el helper legacy del page.tsx anterior.
 */
export function calcularFppEg(
  furIso: string,
): { fpp: string; egTexto: string } | null {
  if (!furIso) return null;
  const fur = new Date(`${furIso}T00:00:00Z`);
  if (Number.isNaN(fur.getTime())) return null;
  const fppDate = new Date(fur);
  fppDate.setUTCDate(fppDate.getUTCDate() + 280);
  const fpp = fppDate.toISOString().slice(0, 10);
  const now = new Date();
  const hoy = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const dias = Math.floor((hoy.getTime() - fur.getTime()) / 86_400_000);
  if (dias < 0) return { fpp, egTexto: "—" };
  return { fpp, egTexto: `${Math.floor(dias / 7)} sem ${dias % 7} d` };
}

/** IMC = peso(kg) / talla(m)² */
export function calcImc(
  pesoKg: number | null,
  tallaM: number | null,
): number | null {
  if (!pesoKg || !tallaM || tallaM <= 0) return null;
  return pesoKg / (tallaM * tallaM);
}

export function imcClasificacion(imc: number): { label: string; color: string } {
  if (imc < 18.5) return { label: "Bajo peso", color: "#2563eb" };
  if (imc < 25) return { label: "Normal", color: "#16a34a" };
  if (imc < 30) return { label: "Sobrepeso", color: "#ea580c" };
  return { label: "Obesidad", color: "#dc2626" };
}

/** ICT = cintura(cm) / (talla(m)*100) */
export function calcIct(
  cinturaCm: number | null,
  tallaM: number | null,
): number | null {
  if (!cinturaCm || !tallaM || tallaM <= 0) return null;
  return cinturaCm / (tallaM * 100);
}

export function ictClasificacion(ict: number): { label: string; color: string } {
  if (ict < 0.5) return { label: "Riesgo bajo", color: "#16a34a" };
  if (ict < 0.6) return { label: "Riesgo aumentado", color: "#ea580c" };
  return { label: "Riesgo alto", color: "#dc2626" };
}

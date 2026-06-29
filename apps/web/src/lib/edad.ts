/**
 * CC-0008 §8 — Edad derivada de la fecha de nacimiento.
 *
 * Campo calculado en lectura, NUNCA persistido. La utilidad es pura y testeable.
 * Regla de presentación:
 *   - `≥ 1 año`            → `"{n} año(s)"`
 *   - `< 1 año, ≥ 1 mes`   → `"{n} mes(es)"`
 *   - `< 1 mes`            → `"{n} día(s)"`
 *
 * Las fechas del formulario llegan ancladas a mediodía UTC (ver `parseDateOnly`),
 * por lo que los métodos locales de `Date` devuelven el día calendario correcto
 * en cualquier zona horaria entre ±12h.
 */
export type Edad = { anios: number; meses: number; dias: number; label: string };

export function calcularEdad(nacimiento: Date, ahora: Date = new Date()): Edad {
  let anios = ahora.getFullYear() - nacimiento.getFullYear();
  let meses = ahora.getMonth() - nacimiento.getMonth();
  let dias = ahora.getDate() - nacimiento.getDate();
  if (dias < 0) {
    meses--;
    dias += new Date(ahora.getFullYear(), ahora.getMonth(), 0).getDate();
  }
  if (meses < 0) {
    anios--;
    meses += 12;
  }

  const label =
    anios >= 1
      ? `${anios} ${anios === 1 ? "año" : "años"}`
      : meses >= 1
        ? `${meses} ${meses === 1 ? "mes" : "meses"}`
        : `${dias} ${dias === 1 ? "día" : "días"}`;

  return { anios, meses, dias, label };
}

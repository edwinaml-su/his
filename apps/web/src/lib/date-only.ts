/**
 * Helpers para fechas "solo-día" capturadas vía `<input type="date">`.
 *
 * Problema: `new Date("YYYY-MM-DD")` se interpreta como UTC midnight, lo que
 * en zonas con offset negativo (ej. UTC-6 de El Salvador) resulta en el día
 * anterior cuando se renderiza/persiste como fecha local. Anclar la hora a
 * UTC noon (12:00:00Z) hace al valor inmune a cualquier offset entre ±12h.
 */

/**
 * Parsea un string "YYYY-MM-DD" (formato de `<input type="date">`) a un
 * objeto Date posicionado en mediodía UTC del mismo día calendario. Para
 * `@db.Date` en Postgres esto garantiza que el día persistido coincide con
 * el que el usuario seleccionó, independientemente de la zona horaria.
 *
 * @returns Date anclado a UTC noon, o `null` si la entrada está vacía o
 *          no cumple el formato.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return new Date(`${value}T12:00:00Z`);
}

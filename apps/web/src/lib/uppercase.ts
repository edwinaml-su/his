/**
 * Forzado de MAYÚSCULAS en campos de ingreso de datos (requerimiento Avante).
 *
 * Todo texto editable que el usuario ingresa al sistema se almacena en
 * MAYÚSCULAS. Este módulo solo opera sobre el VALOR de <input> de texto y
 * <textarea>: las etiquetas de la UI (<label>, <span>, etc.) no se tocan.
 *
 * Exclusiones: contraseñas, correos, URLs, campos no textuales (números,
 * fechas, color…), readOnly/disabled y cualquier elemento marcado con
 * `data-no-uppercase` (escape hatch para campos sensibles a may/min).
 */

/** Tipos de <input> que NO se transforman (no son texto libre o son sensibles a may/min). */
const EXCLUDED_INPUT_TYPES = new Set<string>([
  "password",
  "email",
  "url",
  "number",
  "tel",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
  "color",
  "range",
  "file",
  "checkbox",
  "radio",
  "hidden",
  "search",
  "button",
  "submit",
  "reset",
  "image",
]);

/**
 * ¿Es un campo de texto editable sujeto a mayúsculas?
 * Solo <input type=text|""> y <textarea>, no readOnly/disabled, sin opt-out.
 */
export function isUppercaseTarget(
  el: EventTarget | null,
): el is HTMLInputElement | HTMLTextAreaElement {
  if (!(el instanceof HTMLElement)) return false;

  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") return false;

  const field = el as HTMLInputElement | HTMLTextAreaElement;
  if (field.readOnly || field.disabled) return false;

  if (tag === "INPUT") {
    const inp = field as HTMLInputElement;
    if (EXCLUDED_INPUT_TYPES.has(inp.type.toLowerCase())) return false;
    // Una contraseña revelada (type=text) o un PIN de firma se marcan con
    // autocomplete *-password; los códigos OTP con one-time-code. Son
    // credenciales/códigos: nunca se transforman aunque el type sea "text".
    const ac = inp.autocomplete.toLowerCase();
    if (ac.includes("password") || ac === "one-time-code") return false;
  }

  // Opt-out explícito: el propio campo o cualquier ancestro con [data-no-uppercase].
  if (el.closest("[data-no-uppercase]")) return false;

  return true;
}

/**
 * Asigna `value` vía el setter nativo del prototipo, evitando el _valueTracker
 * de React. Así React detecta el cambio en su listener de bubble y dispara
 * onChange con el valor ya en mayúsculas, sin desincronizar el estado.
 */
export function setNativeValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(field, value);
}

/**
 * Pasa el valor del campo a MAYÚSCULAS preservando el cursor.
 * Devuelve true si hubo cambio; no-op si ya estaba en mayúsculas.
 */
export function applyUppercase(
  field: HTMLInputElement | HTMLTextAreaElement,
): boolean {
  const { value } = field;
  const upper = value.toUpperCase();
  if (upper === value) return false;

  const start = field.selectionStart;
  const end = field.selectionEnd;
  setNativeValue(field, upper);
  // toUpperCase preserva la longitud en es-SV (latín) → el cursor se restaura 1:1.
  try {
    if (start !== null && end !== null) field.setSelectionRange(start, end);
  } catch {
    // Algunos navegadores prohíben setSelectionRange en ciertos contextos; ignorar.
  }
  return true;
}

/**
 * CC-0008 §7 — Contrato del lector de documento + simulación de autocompletado.
 *
 * El botón de escaneo lee el portador de datos del documento:
 *   - DUI                → PDF417 al reverso
 *   - Pasaporte          → MRZ ICAO 9303
 *   - Carnet de Residente → portador DGME
 * y entrega un objeto normalizado que mapea 1:1 a los campos del formulario.
 *
 * En PRODUCCIÓN: integrar el SDK del lector (PDF417 / MRZ / DGME) en
 * `parseDocumento`. En esta entrega (mockup): se devuelve una muestra fija por
 * tipo, suficiente para validar el flujo de autocompletado de la UI.
 */

export type TipoDocumento = "DUI" | "PASAPORTE" | "CARNET_RESIDENTE";
export type SexoDocumento = "MASCULINO" | "FEMENINO";

export interface DatosDocumento {
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  primerNombre: string;
  segundoNombre?: string;
  tercerNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  apellidoCasada?: string;
  sexoBiologico: SexoDocumento;
  fechaNacimiento: string; // ISO yyyy-mm-dd
}

/**
 * Patrones de validación de `numeroDocumento` por tipo (§7).
 *   - DUI: 8 dígitos + dígito verificador (p. ej. `04829175-3`).
 *   - Pasaporte: alfanumérico permisivo, 6–9 (varía por país).
 *   - Carnet de Residente: permisivo — confirmar formato oficial DGME (§14).
 */
export const PATRON_DOCUMENTO: Record<TipoDocumento, RegExp> = {
  DUI: /^\d{8}-\d$/,
  PASAPORTE: /^[A-Z0-9]{6,9}$/,
  CARNET_RESIDENTE: /^[A-Z0-9-]{4,20}$/,
};

/** Valida `numeroDocumento` contra el patrón del tipo indicado. */
export function validarNumeroDocumento(tipo: TipoDocumento, numero: string): boolean {
  return PATRON_DOCUMENTO[tipo].test(numero.trim().toUpperCase());
}

/**
 * Muestras fijas por tipo (demostración del autocompletado por escaneo).
 * La muestra DUI coincide con el mockup `preregistro.html`.
 */
const MUESTRAS: Record<TipoDocumento, DatosDocumento> = {
  DUI: {
    tipoDocumento: "DUI",
    // Mismo cuerpo del mockup (04829175) con dígito verificador válido, para que
    // el flujo escaneo→guardar pase la validación de DUI del contrato (§7).
    numeroDocumento: "04829175-0",
    primerNombre: "María",
    segundoNombre: "Fernanda",
    primerApellido: "Hernández",
    segundoApellido: "Portillo",
    apellidoCasada: "de Castellanos",
    sexoBiologico: "FEMENINO",
    fechaNacimiento: "1990-07-14",
  },
  PASAPORTE: {
    tipoDocumento: "PASAPORTE",
    numeroDocumento: "A1234567",
    primerNombre: "Carlos",
    segundoNombre: "Andrés",
    primerApellido: "Gómez",
    segundoApellido: "Rivas",
    sexoBiologico: "MASCULINO",
    fechaNacimiento: "1985-03-22",
  },
  CARNET_RESIDENTE: {
    tipoDocumento: "CARNET_RESIDENTE",
    numeroDocumento: "RES-0098231",
    primerNombre: "Ana",
    segundoNombre: "Lucía",
    primerApellido: "Mendoza",
    sexoBiologico: "FEMENINO",
    fechaNacimiento: "1998-11-05",
  },
};

/**
 * Parsea el portador de datos crudo del documento al objeto normalizado.
 *
 * @param _raw  Carga cruda del lector (PDF417/MRZ/DGME). Ignorada en la
 *              simulación; en producción se decodifica aquí.
 * @param tipo  Tipo de documento escaneado.
 */
export function parseDocumento(_raw: string, tipo: TipoDocumento): DatosDocumento {
  return MUESTRAS[tipo];
}

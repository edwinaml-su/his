/**
 * Fuente de verdad de umbrales, factores de conversión, rangos y cálculos de
 * signos vitales para la Evolución Médica (CC-0006).
 *
 * CC-0012 — la lógica se consolidó en `@his/contracts` (packages/contracts/src/
 * validators/signos-vitales.ts) para que web y trpc consuman la misma fuente
 * (módulo transversal de signos vitales, mockup avante7). Este archivo re-exporta
 * sin cambios para no romper los imports relativos existentes (SignosVitalesCapture,
 * VitalesModal, sus 66 tests) ni su contrato público.
 */
export * from "@his/contracts/validators";

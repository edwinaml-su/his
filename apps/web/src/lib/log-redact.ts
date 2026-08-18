/**
 * Redacción de identificadores en logs — OWASP A09:2025
 * (Security Logging and Alerting Failures).
 *
 * Los logs de Vercel no son un almacén conforme para PHI y se retienen fuera
 * de la cadena de auditoría (`audit.audit_log`, SHA-256, 10 años). Todo lo que
 * se loggee desde la app pasa por aquí para no filtrar identificadores
 * directos del paciente.
 *
 * NO sustituye al scrubbing de Sentry (`sentry.*.config.ts`, Beta.22): esto
 * cubre el `console.*` que va al stdout de la función.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Expediente {NNN}{AA}{NNNNN} (CC-0014) y correlativos numéricos largos. */
const LONG_NUM = /\b\d{6,}\b/g;
/** DUI salvadoreño ########-# y NIT ####-######-###-#. */
const DUI = /\b\d{8}-\d\b/g;
const NIT = /\b\d{4}-\d{6}-\d{3}-\d\b/g;
const EMAIL = /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;

/** Sustituye identificadores directos por marcadores. Idempotente. */
export function redactPhi(input: string): string {
  return input
    .replace(UUID, "<id>")
    .replace(NIT, "<nit>")
    .replace(DUI, "<dui>")
    .replace(EMAIL, "<email>")
    .replace(LONG_NUM, "<num>");
}

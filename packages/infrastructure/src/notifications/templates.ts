/**
 * Plantillas HTML + texto plano por eventType — Beta.15 (US.B15.2.3).
 *
 * Scope MVP intencionalmente austero:
 *   - HTML mínimo (`<h2>` + `<p>` + lista). NO React Email — eso es
 *     US.B15.2.4 (PR separado, scope distinto).
 *   - Texto plano paralelo para fallback en clientes sin HTML.
 *   - Subject en español (es-SV), incluye paciente cuando aplica.
 *   - Subject y body se truncan a los límites de columna del schema
 *     (`subject ≤ 200`, `body ≤ 5000`) en el dispatcher si hace falta.
 *
 * Las plantillas reciben datos ya validados por Zod en `emitDomainEvent`,
 * por lo que NO se re-validan aquí — eso sería defensa duplicada.
 */
import type {
  VitalCriticalPayload,
  LabCriticalValuePayload,
  DrugInteractionPayload,
  AllergyMismatchPayload,
} from "@his/contracts";

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

/** Datos comunes que pueden injectarse en los subjects (nombre paciente, etc). */
export interface TemplateContext {
  /** Nombre legible del paciente (opcional — si null, se omite). */
  patientName?: string | null;
  /** Nombre completo del recipient (opcional, para saludo en el cuerpo). */
  recipientName?: string | null;
}

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// -----------------------------------------------------------------------------
// vital.critical
// -----------------------------------------------------------------------------

export function buildVitalCriticalTemplate(
  payload: VitalCriticalPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const criticalAlerts = payload.alerts.filter((a) => a.severity === "CRITICAL");
  const summary = criticalAlerts.length > 0 ? criticalAlerts : payload.alerts;
  const lines = summary.map((a) => `${a.parameter}=${a.value} (${a.message})`);

  const patientFragment = ctx.patientName ? ` — paciente ${ctx.patientName}` : "";
  const subject = `[CRÍTICO] Signos vitales fuera de rango${patientFragment}`;

  const html = [
    `<h2>Alerta de signos vitales críticos</h2>`,
    ctx.patientName ? `<p><strong>Paciente:</strong> ${escape(ctx.patientName)}</p>` : "",
    `<p>Se detectaron valores fuera de rango en la última toma:</p>`,
    `<ul>`,
    ...summary.map(
      (a) => `<li><strong>${escape(a.parameter)}</strong>: ${a.value} — ${escape(a.message)}</li>`,
    ),
    `</ul>`,
    `<p>Revisa el expediente del paciente en el HIS para más detalles.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Alerta de signos vitales críticos`,
    ctx.patientName ? `Paciente: ${ctx.patientName}` : "",
    ``,
    `Valores fuera de rango:`,
    ...lines.map((l) => `  - ${l}`),
    ``,
    `Revisa el expediente del paciente en el HIS.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// lab.criticalValue
// -----------------------------------------------------------------------------

export function buildLabCriticalValueTemplate(
  payload: LabCriticalValuePayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const patientFragment = ctx.patientName ? ` — paciente ${ctx.patientName}` : "";
  const flagText = payload.flag === "CRITICAL_LOW" ? "valor críticamente bajo" : "valor críticamente alto";
  const subject = `[CRÍTICO] Resultado de laboratorio ${payload.testCode}${patientFragment}`;

  const refLow = payload.referenceRange.low ?? "?";
  const refHigh = payload.referenceRange.high ?? "?";
  const unit = payload.unit ? ` ${escape(payload.unit)}` : "";

  const html = [
    `<h2>Resultado de laboratorio crítico</h2>`,
    ctx.patientName ? `<p><strong>Paciente:</strong> ${escape(ctx.patientName)}</p>` : "",
    `<p><strong>Prueba:</strong> ${escape(payload.testCode)}</p>`,
    `<p><strong>Resultado:</strong> ${payload.value}${unit} (${escape(flagText)})</p>`,
    `<p><strong>Rango de referencia:</strong> ${refLow} - ${refHigh}${unit}</p>`,
    `<p>Revisa el resultado en el módulo LIS.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Resultado de laboratorio crítico`,
    ctx.patientName ? `Paciente: ${ctx.patientName}` : "",
    `Prueba: ${payload.testCode}`,
    `Resultado: ${payload.value}${payload.unit ? ` ${payload.unit}` : ""} (${flagText})`,
    `Rango de referencia: ${refLow} - ${refHigh}${payload.unit ? ` ${payload.unit}` : ""}`,
    ``,
    `Revisa el resultado en el módulo LIS.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// drug.interaction
// -----------------------------------------------------------------------------

export function buildDrugInteractionTemplate(
  payload: DrugInteractionPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const sevLabel = payload.severity === "CRITICAL" ? "[CRÍTICO]" : "[ADVERTENCIA]";
  const patientFragment = ctx.patientName ? ` — paciente ${ctx.patientName}` : "";
  const subject = `${sevLabel} Interacción medicamentosa detectada${patientFragment}`;

  const drugCount = payload.conflictingDrugIds.length;
  const html = [
    `<h2>Interacción medicamentosa detectada</h2>`,
    ctx.patientName ? `<p><strong>Paciente:</strong> ${escape(ctx.patientName)}</p>` : "",
    `<p><strong>Severidad:</strong> ${escape(payload.severity)}</p>`,
    `<p><strong>Drogas en conflicto:</strong> ${drugCount}</p>`,
    `<p>${escape(payload.description)}</p>`,
    `<p>Revisa la receta antes de firmar en el módulo de Farmacia.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Interacción medicamentosa detectada (${payload.severity})`,
    ctx.patientName ? `Paciente: ${ctx.patientName}` : "",
    `Drogas en conflicto: ${drugCount}`,
    ``,
    payload.description,
    ``,
    `Revisa la receta antes de firmar en el módulo de Farmacia.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// allergy.mismatch
// -----------------------------------------------------------------------------

export function buildAllergyMismatchTemplate(
  _payload: AllergyMismatchPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const patientFragment = ctx.patientName ? ` — paciente ${ctx.patientName}` : "";
  const subject = `[CRÍTICO] Posible alergia al medicamento prescrito${patientFragment}`;

  const html = [
    `<h2>Alerta de alergia: medicamento prescrito coincide con alergia registrada</h2>`,
    ctx.patientName ? `<p><strong>Paciente:</strong> ${escape(ctx.patientName)}</p>` : "",
    `<p>Se detectó coincidencia entre una alergia documentada del paciente y un medicamento prescrito/administrado.</p>`,
    `<p>Por favor revisa el caso en el expediente clínico antes de continuar.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Alerta de alergia`,
    ctx.patientName ? `Paciente: ${ctx.patientName}` : "",
    ``,
    `Coincidencia entre alergia documentada y medicamento prescrito/administrado.`,
    `Revisa el caso en el expediente clínico antes de continuar.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

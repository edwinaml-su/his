/**
 * Plantillas email HTML + texto plano por eventType — Beta.15 (US.B15.2.4).
 *
 * Reemplaza la versión MVP austera de US.B15.2.3 con plantillas de producción:
 *  - HTML con inline CSS compatible Gmail/Outlook/Apple Mail (layout de tablas,
 *    no divs; bgcolor en atributos HTML además de style, border-radius via VML).
 *  - Texto plano como fallback obligatorio.
 *  - Branding "HIS Multipaís — Inversiones Avante" consistente en header/footer.
 *  - CTA (call-to-action) al expediente/módulo relevante si se provee `url`.
 *  - Sanitización XSS robusta en todos los campos libres del payload.
 *
 * Interfaz intencional sin cambios disruptivos vs US.B15.2.3:
 *  - Mismas firmas de función que ya importa `dispatcher.ts`.
 *  - `TemplateContext` extiende con `url?` (CTA al expediente). Si el dispatcher
 *    no lo pasa, el botón CTA no aparece — no es error.
 *
 * NO se usa @react-email/components (ver deuda técnica en PR description).
 */
import type {
  VitalCriticalPayload,
  LabCriticalValuePayload,
  DrugInteractionPayload,
  AllergyMismatchPayload,
  TransfusionCrossmatchFailedPayload,
  TransfusionAdverseReactionPayload,
  PathologyReportSignedPayload,
  PathologyCriticalFindingPayload,
  AccountingPeriodClosedPayload,
  AccountingJournalPostedHighValuePayload,
} from "@his/contracts";

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

/** Contexto inyectado por el dispatcher al renderizar. */
export interface TemplateContext {
  /** Nombre legible del paciente. */
  patientName?: string | null;
  /** Nombre completo del destinatario, para el saludo. */
  recipientName?: string | null;
  /**
   * URL del expediente / módulo relevante.
   * Si se provee, se incluye un botón CTA en HTML y una línea en texto plano.
   */
  url?: string | null;
}

// ---------------------------------------------------------------------------
// Sanitización XSS
// ---------------------------------------------------------------------------

/**
 * Escapa caracteres peligrosos en contenido de texto HTML (texto libre).
 * Cubre los 5 chars estándar + apóstrofo + slash (OWASP mínimo seguro para
 * contenido dentro de elementos HTML, ej. <p>, <td>, atributos style).
 *
 * NO usar en valores de atributos `href` — para eso usar `escapeAttr`.
 */
export function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Escapa una URL para uso seguro en atributo `href`.
 * Solo `&` y `"` son peligrosos en atributos HTML con comillas dobles.
 * El slash `/` NO se escapa aquí porque es parte legal de la URL.
 */
function escapeAttr(url: string): string {
  return url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------------

/** Paleta — centralizada para coherencia entre plantillas. */
const COLOR = {
  brand: "#1a365d",       // azul oscuro header
  accent: "#2b6cb0",      // azul medio botón CTA
  critical: "#c53030",    // rojo alerta CRITICAL
  warning: "#d69e2e",     // amarillo WARNING
  border: "#e2e8f0",      // gris claro separador
  footer: "#f7fafc",      // fondo footer
  footerText: "#718096",  // texto footer gris
  bodyBg: "#ffffff",
  bodyText: "#2d3748",
} as const;

/** Cabecera HTML compartida — abre <html> hasta el <tbody> del wrapper. */
function htmlHeader(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>HIS Multipaís — Notificación clínica</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="#f4f6f8">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600"
  style="max-width:600px;width:100%;background-color:${COLOR.bodyBg};border:1px solid ${COLOR.border};border-radius:6px;overflow:hidden;">

<!-- HEADER -->
<tr>
<td bgcolor="${COLOR.brand}" style="background-color:${COLOR.brand};padding:20px 32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr>
<td>
<p style="margin:0;color:#ffffff;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;letter-spacing:0.5px;">
  HIS Multipaís
</p>
<p style="margin:4px 0 0;color:#bee3f8;font-family:Arial,sans-serif;font-size:12px;">
  Inversiones Avante — Sistema de Información Hospitalaria
</p>
</td>
</tr>
</table>
</td>
</tr>

<!-- BODY -->
<tr>
<td style="padding:32px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">`;
}

/** Cierra el wrapper y añade el footer de marca. */
function htmlFooter(url: string | null | undefined): string {
  const ctaRow = url
    ? `<tr><td style="padding-top:24px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
<tr>
<td bgcolor="${COLOR.accent}" style="background-color:${COLOR.accent};border-radius:4px;padding:10px 20px;">
<a href="${escapeAttr(url)}" target="_blank"
  style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;">
  Ver en el expediente clínico
</a>
</td>
</tr>
</table>
</td></tr>`
    : "";

  return `${ctaRow}
</table>
</td>
</tr>

<!-- FOOTER -->
<tr>
<td bgcolor="${COLOR.footer}" style="background-color:${COLOR.footer};border-top:1px solid ${COLOR.border};padding:20px 32px;">
<p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:${COLOR.footerText};text-align:center;">
  Inversiones Avante — HIS Multipaís &bull; Este es un mensaje automático generado por el sistema.
</p>
<p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;color:${COLOR.footerText};text-align:center;">
  Para ajustar qué notificaciones recibes por email,
  visita <strong>Preferencias de notificaciones</strong> en tu perfil del HIS.
</p>
</td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Badge de severidad con inline CSS. */
function severityBadge(label: string, critical: boolean): string {
  const bg = critical ? COLOR.critical : COLOR.warning;
  return `<span style="display:inline-block;background-color:${bg};color:#fff;font-family:Arial,sans-serif;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:3px;letter-spacing:0.5px;">${escape(label)}</span>`;
}

/** Fila de dato en tabla informativa. */
function infoRow(label: string, value: string): string {
  return `<tr>
<td style="font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};padding:4px 0;width:160px;vertical-align:top;">${escape(label)}</td>
<td style="font-family:Arial,sans-serif;font-size:13px;color:${COLOR.bodyText};padding:4px 0 4px 12px;vertical-align:top;">${value}</td>
</tr>`;
}

// ---------------------------------------------------------------------------
// vital.critical
// ---------------------------------------------------------------------------

export function buildVitalCriticalTemplate(
  payload: VitalCriticalPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const criticalAlerts = payload.alerts.filter((a) => a.severity === "CRITICAL");
  const summary = criticalAlerts.length > 0 ? criticalAlerts : payload.alerts;

  const patientFragment = ctx.patientName ? ` — ${ctx.patientName}` : "";
  const subject = `[CRÍTICO] Signos vitales fuera de rango${patientFragment}`;

  // --- HTML ---
  const alertRows = summary
    .map(
      (a) =>
        `<tr>
<td style="font-family:Arial,sans-serif;font-size:13px;color:${COLOR.bodyText};padding:6px 12px;border-bottom:1px solid ${COLOR.border};">
  <strong>${escape(a.parameter)}</strong>
</td>
<td style="font-family:Arial,sans-serif;font-size:13px;color:${COLOR.bodyText};padding:6px 12px;border-bottom:1px solid ${COLOR.border};">
  ${a.value}
</td>
<td style="font-family:Arial,sans-serif;font-size:13px;color:${a.severity === "CRITICAL" ? COLOR.critical : COLOR.warning};padding:6px 12px;border-bottom:1px solid ${COLOR.border};">
  ${escape(a.message)}
</td>
</tr>`,
    )
    .join("\n");

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const patientInfo = ctx.patientName
    ? `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};"><strong>Paciente:</strong> ${escape(ctx.patientName)}</p>`
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("CRÍTICO", true)}
  <span style="margin-left:8px;">Signos vitales fuera de rango</span>
</td>
</tr>
</table>
${patientInfo}
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  Se detectaron los siguientes valores que requieren atención inmediata:
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="1" bordercolor="${COLOR.border}"
  style="border-collapse:collapse;width:100%;margin-bottom:16px;">
<thead>
<tr style="background-color:#ebf4ff;">
<th style="font-family:Arial,sans-serif;font-size:12px;color:${COLOR.footerText};padding:8px 12px;text-align:left;border-bottom:2px solid ${COLOR.border};">Parámetro</th>
<th style="font-family:Arial,sans-serif;font-size:12px;color:${COLOR.footerText};padding:8px 12px;text-align:left;border-bottom:2px solid ${COLOR.border};">Valor</th>
<th style="font-family:Arial,sans-serif;font-size:12px;color:${COLOR.footerText};padding:8px 12px;text-align:left;border-bottom:2px solid ${COLOR.border};">Observación</th>
</tr>
</thead>
<tbody>
${alertRows}
</tbody>
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Por favor revisa el expediente del paciente y toma las medidas clínicas necesarias.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  // --- Texto plano ---
  const lines: string[] = [
    `[CRÍTICO] Signos vitales fuera de rango`,
    `=========================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    ...(ctx.patientName ? [`Paciente: ${ctx.patientName}`, ``] : []),
    `Valores que requieren atención inmediata:`,
    ...summary.map((a) => `  - ${a.parameter}: ${a.value} — ${a.message} (${a.severity})`),
    ``,
    `Por favor revisa el expediente del paciente.`,
    ...(ctx.url ? [``, `Ver expediente: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return {
    subject,
    html,
    text: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// lab.criticalValue
// ---------------------------------------------------------------------------

export function buildLabCriticalValueTemplate(
  payload: LabCriticalValuePayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const flagLabel =
    payload.flag === "CRITICAL_LOW" ? "Críticamente BAJO" : "Críticamente ALTO";
  const patientFragment = ctx.patientName ? ` — ${ctx.patientName}` : "";
  const subject = `[CRÍTICO] Resultado de laboratorio ${payload.testCode}${patientFragment}`;

  const refLow = payload.referenceRange.low ?? "?";
  const refHigh = payload.referenceRange.high ?? "?";
  const unit = payload.unit ? ` ${escape(payload.unit)}` : "";
  const unitPlain = payload.unit ? ` ${payload.unit}` : "";

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const patientInfo = ctx.patientName
    ? infoRow("Paciente:", escape(ctx.patientName))
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("CRÍTICO", true)}
  <span style="margin-left:8px;">Resultado de laboratorio crítico</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  Se registró un resultado que requiere revisión clínica inmediata:
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${patientInfo}
${infoRow("Prueba:", escape(payload.testCode))}
${infoRow("Resultado:", `<strong style="color:${COLOR.critical};">${payload.value}${unit}</strong>`)}
${infoRow("Interpretación:", `<span style="color:${COLOR.critical};">${escape(flagLabel)}</span>`)}
${infoRow("Rango referencia:", `${refLow} – ${refHigh}${unit}`)}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Revisa el resultado completo en el módulo LIS del HIS.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `[CRÍTICO] Resultado de laboratorio crítico`,
    `==========================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    ...(ctx.patientName ? [`Paciente: ${ctx.patientName}`] : []),
    `Prueba: ${payload.testCode}`,
    `Resultado: ${payload.value}${unitPlain} (${flagLabel})`,
    `Rango de referencia: ${refLow} – ${refHigh}${unitPlain}`,
    ``,
    `Revisa el resultado en el módulo LIS.`,
    ...(ctx.url ? [``, `Ver resultado: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return {
    subject,
    html,
    text: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// drug.interaction
// ---------------------------------------------------------------------------

export function buildDrugInteractionTemplate(
  payload: DrugInteractionPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const isCritical = payload.severity === "CRITICAL";
  const sevLabel = isCritical ? "[CRÍTICO]" : "[ADVERTENCIA]";
  const patientFragment = ctx.patientName ? ` — ${ctx.patientName}` : "";
  const subject = `${sevLabel} Interacción medicamentosa detectada${patientFragment}`;

  const drugCount = payload.conflictingDrugIds.length;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const patientInfo = ctx.patientName
    ? infoRow("Paciente:", escape(ctx.patientName))
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge(isCritical ? "CRÍTICO" : "ADVERTENCIA", isCritical)}
  <span style="margin-left:8px;">Interacción medicamentosa detectada</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  El sistema identificó una interacción entre los medicamentos de la receta.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${patientInfo}
${infoRow("Severidad:", severityBadge(payload.severity, isCritical))}
${infoRow("Medicamentos:", `${drugCount} en conflicto`)}
${infoRow("Descripción:", `<span style="color:${COLOR.bodyText};">${escape(payload.description)}</span>`)}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Revisa la receta antes de firmar en el módulo de Farmacia.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `${sevLabel} Interacción medicamentosa detectada`,
    `=`.repeat(44),
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    ...(ctx.patientName ? [`Paciente: ${ctx.patientName}`] : []),
    `Severidad: ${payload.severity}`,
    `Medicamentos en conflicto: ${drugCount}`,
    ``,
    payload.description,
    ``,
    `Revisa la receta antes de firmar en el módulo de Farmacia.`,
    ...(ctx.url ? [``, `Ver receta: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return {
    subject,
    html,
    text: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// allergy.mismatch
// ---------------------------------------------------------------------------

export function buildAllergyMismatchTemplate(
  _payload: AllergyMismatchPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const patientFragment = ctx.patientName ? ` — ${ctx.patientName}` : "";
  const subject = `[CRÍTICO] Alergia al medicamento prescrito${patientFragment}`;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const patientInfo = ctx.patientName
    ? infoRow("Paciente:", escape(ctx.patientName))
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("CRÍTICO", true)}
  <span style="margin-left:8px;">Alerta de alergia: medicamento prescrito</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  Se detectó una coincidencia entre una <strong>alergia documentada</strong> del paciente
  y un medicamento prescrito o en proceso de administración.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${patientInfo}
${infoRow("Severidad:", severityBadge("CRÍTICO", true))}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Detén el proceso y revisa el expediente clínico del paciente antes de continuar.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `[CRÍTICO] Alerta de alergia: medicamento prescrito`,
    `===================================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    ...(ctx.patientName ? [`Paciente: ${ctx.patientName}`] : [``]),
    `Severidad: CRÍTICO`,
    ``,
    `Coincidencia entre alergia documentada del paciente y medicamento prescrito o en administración.`,
    ``,
    `Detén el proceso y revisa el expediente clínico antes de continuar.`,
    ...(ctx.url ? [``, `Ver expediente: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return {
    subject,
    html,
    text: lines.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// transfusion.crossmatchFailed  (Beta.16.1)
// ---------------------------------------------------------------------------

export function buildTransfusionCrossmatchFailedTemplate(
  payload: TransfusionCrossmatchFailedPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const subject = `[CRÍTICO] Prueba de compatibilidad fallida — transfusión`;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("CRÍTICO", true)}
  <span style="margin-left:8px;">Prueba de compatibilidad fallida</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  La prueba de compatibilidad cruzada para la solicitud de transfusión ha fallado.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${infoRow("Resultado:", `<span style="color:${COLOR.critical};">${escape(payload.result)}</span>`)}
${infoRow("ID solicitud:", escape(payload.requestId))}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  NO proceder con la transfusión. Revisa la solicitud en el módulo de Banco de Sangre.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `[CRÍTICO] Prueba de compatibilidad fallida — transfusión`,
    `=========================================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    `Resultado: ${payload.result}`,
    `ID solicitud: ${payload.requestId}`,
    ``,
    `NO proceder con la transfusión. Revisa la solicitud en el módulo de Banco de Sangre.`,
    ...(ctx.url ? [``, `Ver solicitud: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return { subject, html, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// transfusion.adverseReaction  (Beta.16.1)
// ---------------------------------------------------------------------------

export function buildTransfusionAdverseReactionTemplate(
  payload: TransfusionAdverseReactionPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const isCritical = payload.severity === "LIFE_THREATENING" || payload.severity === "SEVERE";
  const sevLabel = isCritical ? "[CRÍTICO]" : "[ADVERTENCIA]";
  const subject = `${sevLabel} Reacción adversa a transfusión detectada`;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge(isCritical ? "CRÍTICO" : "ADVERTENCIA", isCritical)}
  <span style="margin-left:8px;">Reacción adversa a transfusión</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  Se registró una reacción adversa durante una transfusión activa.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${infoRow("Tipo de reacción:", escape(payload.reactionType))}
${infoRow("Severidad:", severityBadge(escape(payload.severity), isCritical))}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Evalúa la suspensión inmediata de la transfusión y activa el protocolo de reacción adversa.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `${sevLabel} Reacción adversa a transfusión detectada`,
    `=`.repeat(50),
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    `Tipo de reacción: ${payload.reactionType}`,
    `Severidad: ${payload.severity}`,
    ``,
    `Evalúa la suspensión inmediata de la transfusión y activa el protocolo de reacción adversa.`,
    ...(ctx.url ? [``, `Ver caso: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return { subject, html, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// pathology.reportSigned  (Beta.17.1)
// ---------------------------------------------------------------------------

export function buildPathologyReportSignedTemplate(
  payload: PathologyReportSignedPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const subject = `[INFO] Informe de patología firmado — disponible para revisión`;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("INFORME FIRMADO", false)}
  <span style="margin-left:8px;">Informe de patología disponible</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  El patólogo ha firmado el informe de la muestra solicitada.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${infoRow("Diagnóstico principal:", `<em>${escape(payload.primaryDiagnosis)}</em>`)}
${infoRow("ID reporte:", escape(payload.reportId))}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Revisa el informe completo en el módulo de Patología del HIS.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `[INFO] Informe de patología firmado`,
    `====================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    `Diagnóstico principal: ${payload.primaryDiagnosis}`,
    `ID reporte: ${payload.reportId}`,
    ``,
    `Revisa el informe completo en el módulo de Patología del HIS.`,
    ...(ctx.url ? [``, `Ver informe: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return { subject, html, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// pathology.criticalFinding  (Beta.17.1)
// ---------------------------------------------------------------------------

export function buildPathologyCriticalFindingTemplate(
  payload: PathologyCriticalFindingPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const subject = `[CRÍTICO] Hallazgo patológico crítico — requiere atención inmediata`;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("CRÍTICO", true)}
  <span style="margin-left:8px;">Hallazgo patológico crítico</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  El informe de patología contiene un hallazgo que requiere revisión clínica urgente.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${infoRow("Diagnóstico principal:", `<strong style="color:${COLOR.critical};">${escape(payload.primaryDiagnosis)}</strong>`)}
${infoRow("ID reporte:", escape(payload.reportId))}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Revisa el informe en el módulo de Patología y coordina con el equipo tratante de inmediato.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `[CRÍTICO] Hallazgo patológico crítico`,
    `======================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    `Diagnóstico principal: ${payload.primaryDiagnosis}`,
    `ID reporte: ${payload.reportId}`,
    ``,
    `Revisa el informe y coordina con el equipo tratante de inmediato.`,
    ...(ctx.url ? [``, `Ver informe: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return { subject, html, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// accounting.periodClosed  (Beta.18.1)
// ---------------------------------------------------------------------------

const MONTHS_ES = [
  "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

export function buildAccountingPeriodClosedTemplate(
  payload: AccountingPeriodClosedPayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const monthLabel = MONTHS_ES[payload.periodMonth] ?? `mes ${payload.periodMonth}`;
  const periodLabel = `${monthLabel} ${payload.periodYear}`;
  const subject = `[CONFIRMACIÓN] Período contable cerrado — ${periodLabel}`;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("CONFIRMACIÓN", false)}
  <span style="margin-left:8px;">Período contable cerrado</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  El período contable ha sido cerrado exitosamente. Este mensaje confirma la operación de auditoría.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${infoRow("Período:", escape(periodLabel))}
${infoRow("ID período:", escape(payload.periodId))}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Revisa el estado en el módulo de Contabilidad del HIS.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `[CONFIRMACIÓN] Período contable cerrado`,
    `========================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    `Período: ${periodLabel}`,
    `ID período: ${payload.periodId}`,
    ``,
    `El período contable ha sido cerrado exitosamente.`,
    ...(ctx.url ? [``, `Ver libro mayor: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return { subject, html, text: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// accounting.journalPostedHighValue  (Beta.18.1)
// ---------------------------------------------------------------------------

/** Formatea número con dos decimales (es-SV). */
function formatAmount(n: number): string {
  return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildAccountingJournalPostedHighValueTemplate(
  payload: AccountingJournalPostedHighValuePayload,
  ctx: TemplateContext = {},
): RenderedTemplate {
  const subject = `[ADVERTENCIA] Asiento de diario de alto valor registrado`;

  const greeting = ctx.recipientName
    ? `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">Estimado/a <strong>${escape(ctx.recipientName)}</strong>,</p>`
    : "";

  const html =
    htmlHeader() +
    `<tr><td>
${greeting}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:16px;">
<tr>
<td style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${COLOR.bodyText};padding-bottom:4px;">
  ${severityBadge("ADVERTENCIA", false)}
  <span style="margin-left:8px;">Asiento de alto valor registrado</span>
</td>
</tr>
</table>
<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:14px;color:${COLOR.bodyText};">
  Se registró un asiento de diario cuyo monto total supera el umbral configurado para revisión.
</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;width:100%;max-width:400px;">
${infoRow("Total débito:", `<strong>${escape(formatAmount(payload.totalDebit))}</strong>`)}
${infoRow("Umbral:", escape(formatAmount(payload.thresholdExceeded)))}
${infoRow("ID asiento:", escape(payload.journalEntryId))}
</table>
<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;color:${COLOR.footerText};">
  Revisa el asiento en el módulo de Contabilidad para confirmar su validez.
</p>
</td></tr>` +
    htmlFooter(ctx.url);

  const lines: string[] = [
    `[ADVERTENCIA] Asiento de diario de alto valor registrado`,
    `=========================================================`,
    ...(ctx.recipientName ? [`Estimado/a ${ctx.recipientName},`, ``] : []),
    `Total débito: ${formatAmount(payload.totalDebit)}`,
    `Umbral configurado: ${formatAmount(payload.thresholdExceeded)}`,
    `ID asiento: ${payload.journalEntryId}`,
    ``,
    `Revisa el asiento en el módulo de Contabilidad para confirmar su validez.`,
    ...(ctx.url ? [``, `Ver asiento: ${ctx.url}`] : []),
    ``,
    `---`,
    `Inversiones Avante — HIS Multipaís`,
    `Mensaje automático. Ajusta tus preferencias en el HIS.`,
  ];

  return { subject, html, text: lines.join("\n") };
}

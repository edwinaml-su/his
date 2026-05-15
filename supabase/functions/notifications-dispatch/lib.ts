// supabase/functions/notifications-dispatch/lib.ts
// =============================================================================
// HIS Beta.15 — Helpers puros para el dispatcher Edge Function (Deno).
//
// Mantenemos aislados de I/O para poder testear con `deno test`. Reflejan
// la lógica equivalente del dispatcher Node (packages/infrastructure/src/
// notifications/{routing,templates}.ts) — NO se reutiliza importando, porque
// Deno Deploy no resuelve workspace deps (`@his/contracts`, `@prisma/client`).
//
// Si cambias defaults/templates aquí, sincroniza con el paquete Node.
// =============================================================================

// deno-lint-ignore-file no-explicit-any

// -----------------------------------------------------------------------------
// Tipos compartidos
// -----------------------------------------------------------------------------

export type Severity = "CRITICAL" | "WARNING" | "INFO";
export type Channel = "INBOX" | "EMAIL";

export interface ChannelSet {
  inbox: boolean;
  email: boolean;
}

export interface RoleSeverityMatrix {
  critical: ChannelSet;
  warning: ChannelSet;
  info: ChannelSet;
}

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

// -----------------------------------------------------------------------------
// Routing (defaults hardcoded por rol × severity)
// -----------------------------------------------------------------------------

export const ROLE_CODES = {
  DOCTOR: "PHYSICIAN",
  NURSE: "NURSE",
  PHARMACIST: "PHARMACIST",
  ADMIN: "ADMIN",
} as const;

const ALL: ChannelSet = { inbox: true, email: true };
const INBOX_ONLY: ChannelSet = { inbox: true, email: false };
const OFF: ChannelSet = { inbox: false, email: false };

export const DEFAULT_ROLE_DEFAULTS: ReadonlyMap<string, RoleSeverityMatrix> =
  new Map<string, RoleSeverityMatrix>([
    [ROLE_CODES.DOCTOR, { critical: ALL, warning: ALL, info: INBOX_ONLY }],
    [ROLE_CODES.NURSE, { critical: ALL, warning: INBOX_ONLY, info: INBOX_ONLY }],
    [ROLE_CODES.PHARMACIST, { critical: ALL, warning: ALL, info: INBOX_ONLY }],
    [ROLE_CODES.ADMIN, { critical: ALL, warning: INBOX_ONLY, info: OFF }],
  ]);

export const FALLBACK_DEFAULTS: RoleSeverityMatrix = {
  critical: ALL,
  warning: INBOX_ONLY,
  info: INBOX_ONLY,
};

/**
 * Resuelve los canales aplicables para (role, severity).
 * Reglas duras:
 *   - CRITICAL siempre fuerza INBOX (no overridable por preferences).
 *   - CRITICAL siempre fuerza EMAIL si `hasEmail` (mantener canal alterno
 *     para alertas críticas no es opcional — política clínica HIS).
 *   - Si no hay email registrado, EMAIL se fuerza a false.
 */
export function resolveChannels(args: {
  roleCode: string | null;
  severity: Severity;
  hasEmail: boolean;
  userPrefs?: ReadonlyArray<{
    severity: string;
    channel: string;
    enabled: boolean;
  }>;
  overrides?: ReadonlyMap<string, RoleSeverityMatrix>;
}): ChannelSet {
  const { roleCode, severity, hasEmail, userPrefs, overrides } = args;
  const defaultsMap = overrides ?? DEFAULT_ROLE_DEFAULTS;
  const matrix =
    (roleCode ? defaultsMap.get(roleCode) : undefined) ?? FALLBACK_DEFAULTS;

  const base = pickSeverityRow(matrix, severity);
  const channels: ChannelSet = { inbox: base.inbox, email: base.email };

  if (userPrefs && userPrefs.length > 0) {
    for (const pref of userPrefs) {
      if (pref.severity !== severity) continue;
      if (pref.channel === "INBOX") channels.inbox = pref.enabled;
      else if (pref.channel === "EMAIL") channels.email = pref.enabled;
    }
  }

  if (severity === "CRITICAL") {
    channels.inbox = true;
    if (hasEmail) channels.email = true;
  }

  if (!hasEmail) channels.email = false;

  return channels;
}

function pickSeverityRow(matrix: RoleSeverityMatrix, severity: Severity): ChannelSet {
  switch (severity) {
    case "CRITICAL":
      return matrix.critical;
    case "WARNING":
      return matrix.warning;
    case "INFO":
      return matrix.info;
  }
}

// -----------------------------------------------------------------------------
// Severity por eventType
// -----------------------------------------------------------------------------

/**
 * Mapping eventType → severity. Para `drug.interaction` la severidad la
 * provee el payload (puede ser CRITICAL o WARNING); el resto son fijos.
 *
 * Retorna null si el eventType no es conocido (deja que el caller skip).
 */
export function mapEventTypeToSeverity(
  eventType: string,
  payload: any,
): Severity | null {
  switch (eventType) {
    case "vital.critical":
      return "CRITICAL";
    case "lab.criticalValue":
      return "CRITICAL";
    case "drug.interaction": {
      const sev = payload?.severity;
      if (sev === "CRITICAL" || sev === "WARNING") return sev;
      // Si payload mal formado, conservador — tratamos como CRITICAL para
      // no perder un evento posiblemente urgente.
      return "CRITICAL";
    }
    case "allergy.mismatch":
      return "CRITICAL";
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Validación shallow inline del payload por eventType
// -----------------------------------------------------------------------------

/**
 * Verifica los campos mínimos por eventType. NO usa Zod (no disponible
 * en este artefacto Deno — la validación robusta vive en `emitDomainEvent`
 * en el lado Node, antes de insertar en outbox).
 *
 * Retorna `null` si OK, o un string con razón del rechazo.
 */
export function validatePayloadShallow(
  eventType: string,
  payload: any,
): string | null {
  if (payload == null || typeof payload !== "object") {
    return "payload_not_object";
  }
  switch (eventType) {
    case "vital.critical": {
      if (typeof payload.source !== "string") return "missing_source";
      if (!Array.isArray(payload.alerts)) return "missing_alerts";
      // admissionId requerido para routing InpatientVitals.
      if (payload.source === "InpatientVitals" && typeof payload.admissionId !== "string") {
        return "missing_admissionId";
      }
      return null;
    }
    case "lab.criticalValue": {
      if (typeof payload.prescriberId !== "string") return "missing_prescriberId";
      if (typeof payload.testCode !== "string") return "missing_testCode";
      return null;
    }
    case "drug.interaction": {
      if (typeof payload.prescriberId !== "string") return "missing_prescriberId";
      if (typeof payload.description !== "string") return "missing_description";
      return null;
    }
    case "allergy.mismatch": {
      // prescriberId puede ser null (skip), pero el campo debe existir.
      if (
        payload.prescriberId !== null &&
        typeof payload.prescriberId !== "string"
      ) {
        return "missing_prescriberId";
      }
      return null;
    }
    default:
      return "unknown_eventType";
  }
}

// -----------------------------------------------------------------------------
// Templates HTML + texto (inline, sin React Email)
// -----------------------------------------------------------------------------

const escape = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function buildVitalCriticalTemplate(
  payload: any,
  patientName?: string | null,
): RenderedTemplate {
  const alerts: Array<{ parameter: string; value: any; message: string; severity?: string }> =
    Array.isArray(payload?.alerts) ? payload.alerts : [];
  const critical = alerts.filter((a) => a?.severity === "CRITICAL");
  const summary = critical.length > 0 ? critical : alerts;

  const patientFragment = patientName ? ` — paciente ${patientName}` : "";
  const subject = `[CRITICO] Signos vitales fuera de rango${patientFragment}`;

  const html = [
    `<h2>Alerta de signos vitales criticos</h2>`,
    patientName ? `<p><strong>Paciente:</strong> ${escape(patientName)}</p>` : "",
    `<p>Se detectaron valores fuera de rango en la ultima toma:</p>`,
    `<ul>`,
    ...summary.map(
      (a) =>
        `<li><strong>${escape(String(a.parameter))}</strong>: ${String(a.value)} — ${escape(String(a.message ?? ""))}</li>`,
    ),
    `</ul>`,
    `<p>Revisa el expediente del paciente en el HIS.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Alerta de signos vitales criticos`,
    patientName ? `Paciente: ${patientName}` : "",
    ``,
    `Valores fuera de rango:`,
    ...summary.map((a) => `  - ${a.parameter}=${a.value} (${a.message ?? ""})`),
    ``,
    `Revisa el expediente del paciente en el HIS.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

export function buildLabCriticalValueTemplate(
  payload: any,
  patientName?: string | null,
): RenderedTemplate {
  const flagText =
    payload?.flag === "CRITICAL_LOW"
      ? "valor criticamente bajo"
      : "valor criticamente alto";
  const patientFragment = patientName ? ` — paciente ${patientName}` : "";
  const subject = `[CRITICO] Resultado de laboratorio ${String(payload?.testCode ?? "")}${patientFragment}`;

  const refLow = payload?.referenceRange?.low ?? "?";
  const refHigh = payload?.referenceRange?.high ?? "?";
  const unit = payload?.unit ? ` ${escape(String(payload.unit))}` : "";

  const html = [
    `<h2>Resultado de laboratorio critico</h2>`,
    patientName ? `<p><strong>Paciente:</strong> ${escape(patientName)}</p>` : "",
    `<p><strong>Prueba:</strong> ${escape(String(payload?.testCode ?? ""))}</p>`,
    `<p><strong>Resultado:</strong> ${String(payload?.value ?? "")}${unit} (${escape(flagText)})</p>`,
    `<p><strong>Rango de referencia:</strong> ${refLow} - ${refHigh}${unit}</p>`,
    `<p>Revisa el resultado en el modulo LIS.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Resultado de laboratorio critico`,
    patientName ? `Paciente: ${patientName}` : "",
    `Prueba: ${payload?.testCode ?? ""}`,
    `Resultado: ${payload?.value ?? ""}${payload?.unit ? ` ${payload.unit}` : ""} (${flagText})`,
    `Rango de referencia: ${refLow} - ${refHigh}${payload?.unit ? ` ${payload.unit}` : ""}`,
    ``,
    `Revisa el resultado en el modulo LIS.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

export function buildDrugInteractionTemplate(
  payload: any,
  patientName?: string | null,
): RenderedTemplate {
  const sevLabel = payload?.severity === "CRITICAL" ? "[CRITICO]" : "[ADVERTENCIA]";
  const patientFragment = patientName ? ` — paciente ${patientName}` : "";
  const subject = `${sevLabel} Interaccion medicamentosa detectada${patientFragment}`;

  const drugIds: string[] = Array.isArray(payload?.conflictingDrugIds)
    ? payload.conflictingDrugIds
    : [];
  const drugCount = drugIds.length;
  const description = String(payload?.description ?? "");

  const html = [
    `<h2>Interaccion medicamentosa detectada</h2>`,
    patientName ? `<p><strong>Paciente:</strong> ${escape(patientName)}</p>` : "",
    `<p><strong>Severidad:</strong> ${escape(String(payload?.severity ?? ""))}</p>`,
    `<p><strong>Drogas en conflicto:</strong> ${drugCount}</p>`,
    `<p>${escape(description)}</p>`,
    `<p>Revisa la receta antes de firmar en el modulo de Farmacia.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Interaccion medicamentosa detectada (${payload?.severity ?? ""})`,
    patientName ? `Paciente: ${patientName}` : "",
    `Drogas en conflicto: ${drugCount}`,
    ``,
    description,
    ``,
    `Revisa la receta antes de firmar en el modulo de Farmacia.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

export function buildAllergyMismatchTemplate(
  payload: any,
  patientName?: string | null,
): RenderedTemplate {
  const patientFragment = patientName ? ` — paciente ${patientName}` : "";
  const subject = `[CRITICO] Posible alergia al medicamento prescrito${patientFragment}`;
  const allergyId = payload?.allergyId ? String(payload.allergyId) : null;

  const html = [
    `<h2>Alerta de alergia: medicamento prescrito coincide con alergia registrada</h2>`,
    patientName ? `<p><strong>Paciente:</strong> ${escape(patientName)}</p>` : "",
    allergyId ? `<p><strong>Alergia registrada (id):</strong> ${escape(allergyId)}</p>` : "",
    `<p>Se detecto coincidencia entre una alergia documentada y un medicamento prescrito/administrado.</p>`,
    `<p>Revisa el caso en el expediente clinico antes de continuar.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Alerta de alergia`,
    patientName ? `Paciente: ${patientName}` : "",
    allergyId ? `Alergia registrada (id): ${allergyId}` : "",
    ``,
    `Coincidencia entre alergia documentada y medicamento prescrito/administrado.`,
    `Revisa el caso en el expediente clinico antes de continuar.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

export function renderTemplate(
  eventType: string,
  payload: any,
  patientName?: string | null,
): RenderedTemplate | null {
  switch (eventType) {
    case "vital.critical":
      return buildVitalCriticalTemplate(payload, patientName);
    case "lab.criticalValue":
      return buildLabCriticalValueTemplate(payload, patientName);
    case "drug.interaction":
      return buildDrugInteractionTemplate(payload, patientName);
    case "allergy.mismatch":
      return buildAllergyMismatchTemplate(payload, patientName);
    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Utility — trunca string a max chars (BD constraint subject ≤ 200, body ≤ 5000).
// -----------------------------------------------------------------------------

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

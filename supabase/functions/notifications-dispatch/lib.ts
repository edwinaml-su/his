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
    // CC-0035 (auditoría C6 2026-09-15, P0-10) — motor de valor crítico con
    // SLA + read-back digital (IPSG.2 ME 2). Espejo del case agregado en
    // dispatcher.ts (Node).
    case "critical_result.emitted":
      return "CRITICAL";
    // CC-0031 — puente tarea→notificación (ver dispatcher.ts Node, mismo mapeo).
    case "task.action_required":
      return "INFO";
    case "task.sla_warning":
      return "WARNING";
    case "task.sla_exceeded":
    case "task.escalated":
      return "CRITICAL";
    case "cargo.pendiente_tarifa":
      return "WARNING";
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
    // CC-0035 — medicoTratanteUserId puede faltar (emisores que no lo tienen
    // a mano todavía) — el evento se valida igual; `resolveRecipients` lo
    // trata como "no-recipient" cuando falta, no como payload inválido.
    case "critical_result.emitted": {
      if (typeof payload.labResultId !== "string") return "missing_labResultId";
      if (typeof payload.severidad !== "string") return "missing_severidad";
      return null;
    }
    // CC-0031 — task.action_required/sla_warning/sla_exceeded/escalated comparten shape.
    case "task.action_required":
    case "task.sla_warning":
    case "task.sla_exceeded":
    case "task.escalated": {
      if (typeof payload.taskType !== "string") return "missing_taskType";
      if (typeof payload.assignedRoleCode !== "string") return "missing_assignedRoleCode";
      if (typeof payload.resumen !== "string") return "missing_resumen";
      if (typeof payload.url !== "string") return "missing_url";
      return null;
    }
    case "cargo.pendiente_tarifa": {
      if (typeof payload.code !== "string") return "missing_code";
      if (typeof payload.cargoId !== "string") return "missing_cargoId";
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

// CC-0035 (auditoría C6 2026-09-15, P0-10/P0-11) — critical_result.emitted.
// Motor de valor crítico con SLA + read-back digital (IPSG.2 ME 2).
export function buildCriticalResultEmittedTemplate(
  payload: any,
  patientName?: string | null,
): RenderedTemplate {
  const valorCritico = payload?.valorCritico ?? {};
  const testCode = String(valorCritico?.testCode ?? "");
  const value = valorCritico?.value;
  const unit = valorCritico?.unit ? ` ${escape(String(valorCritico.unit))}` : "";
  const slaMin = typeof payload?.slaMin === "number" ? payload.slaMin : 60;
  const patientFragment = patientName ? ` — paciente ${patientName}` : "";
  const subject = `[CRITICO] Valor critico ${testCode}${patientFragment} — read-back en ${slaMin} min`;

  const html = [
    `<h2>Valor critico — read-back digital requerido</h2>`,
    patientName ? `<p><strong>Paciente:</strong> ${escape(patientName)}</p>` : "",
    `<p><strong>Prueba:</strong> ${escape(testCode)}</p>`,
    `<p><strong>Resultado:</strong> ${String(value ?? "")}${unit}</p>`,
    `<p><strong>SLA read-back:</strong> ${slaMin} min</p>`,
    `<p>IPSG.2 ME 2 — confirma la lectura con tu PIN de firma electronica en el HIS.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `Valor critico — read-back digital requerido`,
    patientName ? `Paciente: ${patientName}` : "",
    `Prueba: ${testCode}`,
    `Resultado: ${value ?? ""}${valorCritico?.unit ? ` ${valorCritico.unit}` : ""}`,
    `SLA read-back: ${slaMin} min`,
    ``,
    `Confirma la lectura con tu PIN de firma electronica en el HIS.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

// CC-0031 — task.action_required / task.sla_warning / task.sla_exceeded / task.escalated.
// Espejo de `buildTaskNotificationTemplate` (packages/infrastructure/src/notifications/templates.ts).
const TASK_EVENT_LABEL: Record<string, { subject: string; badge: string }> = {
  "task.action_required": { subject: "Nueva tarea pendiente", badge: "ACCION REQUERIDA" },
  "task.sla_warning": { subject: "Tarea por vencer (70% del SLA)", badge: "SLA EN RIESGO" },
  "task.sla_exceeded": { subject: "Tarea vencida — escalada", badge: "SLA VENCIDO" },
  "task.escalated": { subject: "Tarea escalada a tu rol", badge: "ESCALADA" },
};

export function buildTaskNotificationTemplate(
  eventType: string,
  payload: any,
): RenderedTemplate {
  const meta = TASK_EVENT_LABEL[eventType] ?? TASK_EVENT_LABEL["task.action_required"]!;
  const resumen = String(payload?.resumen ?? "");
  const taskType = String(payload?.taskType ?? "");
  const dueAt = payload?.dueAt ? String(payload.dueAt) : null;
  const subject = `[${meta.badge}] ${resumen}`;

  const html = [
    `<h2>${escape(meta.subject)}</h2>`,
    `<p>${escape(resumen)}</p>`,
    `<p><strong>Tipo de tarea:</strong> ${escape(taskType)}</p>`,
    dueAt ? `<p><strong>Vence:</strong> ${escape(dueAt)}</p>` : "",
    `<p>Revisa la bandeja de tareas del HIS.</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = [
    `[${meta.badge}] ${resumen}`,
    `Tipo de tarea: ${taskType}`,
    dueAt ? `Vence: ${dueAt}` : "",
    ``,
    `Revisa la bandeja de tareas del HIS.`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { subject, html, text };
}

// docs/48 Ola 2 (C2-1) — antes de CC-0031 este eventType no tenía template ni
// resolución de recipient en la Edge Function (00 §2.3).
export function buildCargoPendienteTarifaTemplate(payload: any): RenderedTemplate {
  const code = String(payload?.code ?? "");
  const quantity = String(payload?.quantity ?? "");
  const origen = String(payload?.origen ?? "");
  const subject = `[ACCION REQUERIDA] Cargo sin tarifa resuelta — ${code}`;

  const html = [
    `<h2>Cargo sin tarifa resuelta</h2>`,
    `<p>Un cargo se registro sin precio resoluble (RN-HIS-BOT-001 R3: nunca se factura a 0).</p>`,
    `<p><strong>Codigo:</strong> ${escape(code)}</p>`,
    `<p><strong>Cantidad:</strong> ${escape(quantity)}</p>`,
    `<p><strong>Origen:</strong> ${escape(origen)}</p>`,
    `<p>Requiere que Facturacion asigne la tarifa antes del cierre de cuenta.</p>`,
  ].join("\n");

  const text = [
    `Cargo sin tarifa resuelta — ${code}`,
    `Cantidad: ${quantity}`,
    `Origen: ${origen}`,
    ``,
    `Requiere que Facturacion asigne la tarifa antes del cierre de cuenta.`,
  ].join("\n");

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
    case "critical_result.emitted":
      return buildCriticalResultEmittedTemplate(payload, patientName);
    case "task.action_required":
    case "task.sla_warning":
    case "task.sla_exceeded":
    case "task.escalated":
      return buildTaskNotificationTemplate(eventType, payload);
    case "cargo.pendiente_tarifa":
      return buildCargoPendienteTarifaTemplate(payload);
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

// -----------------------------------------------------------------------------
// Retry anti-deadlock (incidente 2026-09-15: en la tanda inicial de triage,
// 20/36 despachos fallaron con 40P01 "deadlock detected" — el poller
// `notifications.process_outbox_batch` (sql/44+242) dispara los http_post
// casi simultáneos vía pg_net y las tx concurrentes cruzan locks en la
// cadena de hash de auditoría, sql/05/43).
//
// Cada insert vía PostgREST es su propia transacción auto-commit, así que
// reintentar el statement es seguro. OJO: esto NO aplica a Prisma dentro de
// una transacción (dispatcher Node) — ahí un 40P01 aborta la tx completa y
// el retry correcto es re-ejecutar la tx entera en el caller.
// -----------------------------------------------------------------------------

export interface PgErrorLike {
  code?: string | null;
  message?: string | null;
}

export function isDeadlockError(error: PgErrorLike | null | undefined): boolean {
  if (!error) return false;
  // Con code presente, solo 40P01 garantiza que Postgres abortó y revirtió
  // la tx (reintentar es seguro). El fallback por mensaje aplica únicamente
  // cuando code viene ausente (errores que PostgREST no tipifica).
  if (error.code != null) return error.code === "40P01";
  return /deadlock detected/i.test(error.message ?? "");
}

export interface WithRetryOpts {
  /** Reintentos adicionales tras el primer intento (default 3). */
  retries?: number;
  /** Base del backoff exponencial: baseMs * 2^n (default 200). */
  baseMs?: number;
  /** Aleatoriza cada delay al 50–100% para des-sincronizar tx concurrentes (default true). */
  jitter?: boolean;
  /** Inyectable para tests (default setTimeout real). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Reintenta `fn` mientras el resultado traiga un error de deadlock (40P01).
 * Cualquier otro error (o éxito) retorna de inmediato — el caller conserva
 * su manejo de errores intacto. Si los reintentos se agotan, retorna el
 * último resultado (con el error de deadlock) para que el caller lance.
 * OJO: agotar los reintentos = notificación perdida — el poller marca
 * `publishedAt` de forma OPTIMISTA (sql/44+242, fire-and-forget) y NUNCA
 * re-arma; recuperar requiere re-armado manual
 * (`UPDATE "DomainEvent" SET "publishedAt" = NULL`), como en el incidente.
 */
export async function withRetry<T extends { error: PgErrorLike | null }>(
  fn: () => PromiseLike<T>,
  opts: WithRetryOpts = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 200;
  const jitter = opts.jitter ?? true;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let result = await fn();
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (!isDeadlockError(result.error)) return result;
    const delay = baseMs * 2 ** (attempt - 1);
    const waitMs = jitter ? Math.round(delay * (0.5 + Math.random() * 0.5)) : delay;
    console.warn(
      `[withRetry] deadlock detectado — reintento ${attempt}/${retries} en ${waitMs}ms`,
    );
    await sleep(waitMs);
    result = await fn();
  }
  return result;
}

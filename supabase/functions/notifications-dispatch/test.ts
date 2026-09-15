// supabase/functions/notifications-dispatch/test.ts
// =============================================================================
// HIS Beta.15 — tests para helpers puros del dispatcher Edge Function.
//
// Ejecutar localmente:
//   cd supabase/functions/notifications-dispatch
//   deno test
//
// NOTA: estos tests NO corren en el CI Node (no hay `deno` en el runner). Son
// para validación local antes de deploy. Lógica I/O se prueba en staging real
// (`supabase functions invoke notifications-dispatch ...`).
// =============================================================================

// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildAllergyMismatchTemplate,
  buildCargoPendienteTarifaTemplate,
  buildDrugInteractionTemplate,
  buildLabCriticalValueTemplate,
  buildTaskNotificationTemplate,
  buildVitalCriticalTemplate,
  clip,
  DEFAULT_ROLE_DEFAULTS,
  isDeadlockError,
  mapEventTypeToSeverity,
  renderTemplate,
  resolveChannels,
  validatePayloadShallow,
  withRetry,
} from "./lib.ts";

// -----------------------------------------------------------------------------
// mapEventTypeToSeverity
// -----------------------------------------------------------------------------

Deno.test("mapEventTypeToSeverity — vital.critical → CRITICAL", () => {
  assertEquals(mapEventTypeToSeverity("vital.critical", {}), "CRITICAL");
});

Deno.test("mapEventTypeToSeverity — lab.criticalValue → CRITICAL", () => {
  assertEquals(mapEventTypeToSeverity("lab.criticalValue", {}), "CRITICAL");
});

Deno.test("mapEventTypeToSeverity — drug.interaction lee severity del payload", () => {
  assertEquals(
    mapEventTypeToSeverity("drug.interaction", { severity: "CRITICAL" }),
    "CRITICAL",
  );
  assertEquals(
    mapEventTypeToSeverity("drug.interaction", { severity: "WARNING" }),
    "WARNING",
  );
  // Payload mal formado → conservador CRITICAL (no perder evento urgente).
  assertEquals(mapEventTypeToSeverity("drug.interaction", {}), "CRITICAL");
});

Deno.test("mapEventTypeToSeverity — allergy.mismatch → CRITICAL", () => {
  assertEquals(mapEventTypeToSeverity("allergy.mismatch", {}), "CRITICAL");
});

Deno.test("mapEventTypeToSeverity — eventType desconocido → null", () => {
  assertEquals(mapEventTypeToSeverity("foo.bar", {}), null);
});

// -----------------------------------------------------------------------------
// resolveChannels
// -----------------------------------------------------------------------------

Deno.test("resolveChannels — CRITICAL doctor con email → INBOX + EMAIL", () => {
  const ch = resolveChannels({
    roleCode: "PHYSICIAN",
    severity: "CRITICAL",
    hasEmail: true,
  });
  assertEquals(ch, { inbox: true, email: true });
});

Deno.test("resolveChannels — CRITICAL sin email → INBOX solo (email forzado a false)", () => {
  const ch = resolveChannels({
    roleCode: "PHYSICIAN",
    severity: "CRITICAL",
    hasEmail: false,
  });
  assertEquals(ch, { inbox: true, email: false });
});

Deno.test("resolveChannels — WARNING nurse → solo INBOX (matrix)", () => {
  const ch = resolveChannels({
    roleCode: "NURSE",
    severity: "WARNING",
    hasEmail: true,
  });
  assertEquals(ch, { inbox: true, email: false });
});

Deno.test("resolveChannels — role desconocido → FALLBACK_DEFAULTS", () => {
  const ch = resolveChannels({
    roleCode: "UNKNOWN_ROLE",
    severity: "WARNING",
    hasEmail: true,
  });
  // Fallback: WARNING → INBOX only.
  assertEquals(ch, { inbox: true, email: false });
});

Deno.test("resolveChannels — preference disable INBOX en WARNING aplica", () => {
  const ch = resolveChannels({
    roleCode: "PHYSICIAN",
    severity: "WARNING",
    hasEmail: true,
    userPrefs: [{ severity: "WARNING", channel: "INBOX", enabled: false }],
  });
  // INBOX off pero EMAIL del default sigue (Physician WARNING → EMAIL on).
  assertEquals(ch.inbox, false);
  assertEquals(ch.email, true);
});

Deno.test("resolveChannels — preference NO puede deshabilitar INBOX en CRITICAL (regla dura)", () => {
  const ch = resolveChannels({
    roleCode: "PHYSICIAN",
    severity: "CRITICAL",
    hasEmail: true,
    userPrefs: [{ severity: "CRITICAL", channel: "INBOX", enabled: false }],
  });
  // CRITICAL fuerza INBOX = true sin importar la preference.
  assertEquals(ch.inbox, true);
});

// -----------------------------------------------------------------------------
// validatePayloadShallow
// -----------------------------------------------------------------------------

Deno.test("validatePayloadShallow — vital.critical OK con InpatientVitals + admissionId", () => {
  const err = validatePayloadShallow("vital.critical", {
    source: "InpatientVitals",
    admissionId: "uuid-here",
    alerts: [],
  });
  assertEquals(err, null);
});

Deno.test("validatePayloadShallow — vital.critical sin admissionId → error", () => {
  const err = validatePayloadShallow("vital.critical", {
    source: "InpatientVitals",
    alerts: [],
  });
  assertNotEquals(err, null);
});

Deno.test("validatePayloadShallow — drug.interaction sin description → error", () => {
  const err = validatePayloadShallow("drug.interaction", {
    prescriberId: "uuid",
  });
  assertEquals(err, "missing_description");
});

Deno.test("validatePayloadShallow — payload no objeto → error", () => {
  assertEquals(validatePayloadShallow("vital.critical", null), "payload_not_object");
  assertEquals(validatePayloadShallow("vital.critical", "string"), "payload_not_object");
});

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

Deno.test("buildVitalCriticalTemplate — subject incluye paciente cuando se provee", () => {
  const t = buildVitalCriticalTemplate(
    { source: "InpatientVitals", admissionId: "u", alerts: [] },
    "Juan Perez",
  );
  assertEquals(t.subject.includes("Juan Perez"), true);
  assertEquals(t.subject.includes("[CRITICO]"), true);
});

Deno.test("buildVitalCriticalTemplate — lista alerts en HTML + texto", () => {
  const t = buildVitalCriticalTemplate({
    source: "InpatientVitals",
    admissionId: "u",
    alerts: [
      { parameter: "heartRate", value: 180, message: "Taquicardia", severity: "CRITICAL" },
    ],
  });
  assertEquals(t.html.includes("heartRate"), true);
  assertEquals(t.text.includes("heartRate=180"), true);
});

Deno.test("buildLabCriticalValueTemplate — incluye testCode + rango", () => {
  const t = buildLabCriticalValueTemplate({
    prescriberId: "uuid",
    testCode: "K+",
    value: 7.2,
    unit: "mmol/L",
    flag: "CRITICAL_HIGH",
    referenceRange: { low: 3.5, high: 5.1 },
  });
  assertEquals(t.subject.includes("K+"), true);
  assertEquals(t.text.includes("3.5 - 5.1"), true);
});

Deno.test("buildDrugInteractionTemplate — severidad WARNING usa [ADVERTENCIA]", () => {
  const t = buildDrugInteractionTemplate({
    prescriberId: "uuid",
    severity: "WARNING",
    description: "interaccion menor",
    conflictingDrugIds: ["d1", "d2"],
  });
  assertEquals(t.subject.includes("[ADVERTENCIA]"), true);
  assertEquals(t.html.includes("interaccion menor"), true);
});

Deno.test("buildAllergyMismatchTemplate — incluye allergyId si presente", () => {
  const t = buildAllergyMismatchTemplate({
    prescriberId: "uuid",
    allergyId: "allergy-123",
  });
  assertEquals(t.html.includes("allergy-123"), true);
});

Deno.test("renderTemplate — eventType desconocido → null", () => {
  assertEquals(renderTemplate("foo", {}), null);
});

// -----------------------------------------------------------------------------
// clip
// -----------------------------------------------------------------------------

Deno.test("clip — string corto se devuelve intacto", () => {
  assertEquals(clip("hola", 10), "hola");
});

Deno.test("clip — string largo se trunca con elipsis", () => {
  const s = "x".repeat(50);
  const clipped = clip(s, 10);
  assertEquals(clipped.length, 10);
  assertEquals(clipped.endsWith("…"), true);
});

// -----------------------------------------------------------------------------
// Sanity: defaults matrix tiene los 4 roles canónicos.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// CC-0031 — task.action_required/sla_warning/sla_exceeded/escalated + cargo.pendiente_tarifa
// -----------------------------------------------------------------------------

Deno.test("mapEventTypeToSeverity — task.action_required → INFO", () => {
  assertEquals(mapEventTypeToSeverity("task.action_required", {}), "INFO");
});

Deno.test("mapEventTypeToSeverity — task.sla_warning → WARNING", () => {
  assertEquals(mapEventTypeToSeverity("task.sla_warning", {}), "WARNING");
});

Deno.test("mapEventTypeToSeverity — task.sla_exceeded y task.escalated → CRITICAL", () => {
  assertEquals(mapEventTypeToSeverity("task.sla_exceeded", {}), "CRITICAL");
  assertEquals(mapEventTypeToSeverity("task.escalated", {}), "CRITICAL");
});

Deno.test("mapEventTypeToSeverity — cargo.pendiente_tarifa → WARNING", () => {
  assertEquals(mapEventTypeToSeverity("cargo.pendiente_tarifa", {}), "WARNING");
});

Deno.test("validatePayloadShallow — task.action_required OK con campos mínimos", () => {
  const err = validatePayloadShallow("task.action_required", {
    taskType: "IND_MED_CUMPLIR",
    assignedRoleCode: "NURSE",
    resumen: "Cumplir indicación",
    url: "/tareas",
  });
  assertEquals(err, null);
});

Deno.test("validatePayloadShallow — task.escalated sin assignedRoleCode → error", () => {
  const err = validatePayloadShallow("task.escalated", {
    taskType: "IND_MED_CUMPLIR",
    resumen: "x",
    url: "/tareas",
  });
  assertEquals(err, "missing_assignedRoleCode");
});

Deno.test("validatePayloadShallow — cargo.pendiente_tarifa OK con code+cargoId", () => {
  const err = validatePayloadShallow("cargo.pendiente_tarifa", {
    code: "SVC-001",
    cargoId: "11111111-1111-4111-8111-111111111111",
  });
  assertEquals(err, null);
});

Deno.test("buildTaskNotificationTemplate — subject incluye el badge del eventType", () => {
  const t = buildTaskNotificationTemplate("task.sla_exceeded", {
    taskType: "IND_MED_CUMPLIR",
    resumen: "Cumplir indicación — Juan Pérez",
    dueAt: "2026-09-15T10:00:00.000Z",
  });
  assertEquals(t.subject.includes("SLA VENCIDO"), true);
  assertEquals(t.text.includes("Cumplir indicación"), true);
});

Deno.test("buildCargoPendienteTarifaTemplate — incluye código y origen", () => {
  const t = buildCargoPendienteTarifaTemplate({
    code: "SVC-001",
    quantity: 2,
    origen: "indicaciones",
  });
  assertEquals(t.subject.includes("SVC-001"), true);
  assertEquals(t.text.includes("indicaciones"), true);
});

Deno.test("renderTemplate — task.* y cargo.pendiente_tarifa resuelven (no null)", () => {
  assertNotEquals(
    renderTemplate("task.action_required", { taskType: "x", resumen: "y" }, null),
    null,
  );
  assertNotEquals(
    renderTemplate("cargo.pendiente_tarifa", { code: "SVC-001" }, null),
    null,
  );
});

Deno.test("DEFAULT_ROLE_DEFAULTS — incluye PHYSICIAN, NURSE, PHARMACIST, ADMIN", () => {
  for (const code of ["PHYSICIAN", "NURSE", "PHARMACIST", "ADMIN"]) {
    assertNotEquals(DEFAULT_ROLE_DEFAULTS.get(code), undefined, `missing role ${code}`);
  }
});

// -----------------------------------------------------------------------------
// isDeadlockError + withRetry (incidente 2026-09-15 — 40P01 en ráfagas del poller)
// -----------------------------------------------------------------------------

Deno.test("isDeadlockError — detecta código 40P01 y mensaje 'deadlock detected'", () => {
  assertEquals(isDeadlockError({ code: "40P01", message: "" }), true);
  // Fallback por mensaje SOLO cuando code viene ausente (errores no tipificados).
  assertEquals(isDeadlockError({ message: "deadlock detected" }), true);
  assertEquals(isDeadlockError({ code: null, message: "deadlock detected" }), true);
  assertEquals(isDeadlockError({ code: "23505", message: "duplicate key" }), false);
  // Code presente manda: un error tipificado distinto NO se reintenta aunque
  // el mensaje contenga el texto.
  assertEquals(isDeadlockError({ code: "XX000", message: "deadlock detected" }), false);
  assertEquals(isDeadlockError(null), false);
  assertEquals(isDeadlockError(undefined), false);
});

Deno.test("withRetry — éxito al primer intento no reintenta ni duerme", async () => {
  let calls = 0;
  let slept = 0;
  const result = await withRetry(
    () => Promise.resolve({ error: null, calls: ++calls }),
    { sleep: () => (slept++, Promise.resolve()) },
  );
  assertEquals(calls, 1);
  assertEquals(slept, 0);
  assertEquals(result.error, null);
});

Deno.test("withRetry — error NO deadlock retorna de inmediato sin reintentar", async () => {
  let calls = 0;
  const result = await withRetry(
    () => Promise.resolve({ error: { code: "23505", message: "duplicate key" }, calls: ++calls }),
    { sleep: () => Promise.resolve() },
  );
  assertEquals(calls, 1);
  assertEquals(result.error?.code, "23505");
});

Deno.test("withRetry — deadlock reintenta y converge al segundo intento", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await withRetry(
    () => {
      calls++;
      return Promise.resolve(
        calls === 1
          ? { error: { code: "40P01", message: "deadlock detected" } }
          : { error: null },
      );
    },
    { jitter: false, baseMs: 200, sleep: (ms) => (delays.push(ms), Promise.resolve()) },
  );
  assertEquals(calls, 2);
  assertEquals(delays, [200]);
  assertEquals(result.error, null);
});

Deno.test("withRetry — deadlock persistente agota reintentos con backoff exponencial y retorna el error", async () => {
  let calls = 0;
  const delays: number[] = [];
  const result = await withRetry(
    () => (calls++, Promise.resolve({ error: { code: "40P01", message: "deadlock detected" } })),
    { retries: 3, baseMs: 200, jitter: false, sleep: (ms) => (delays.push(ms), Promise.resolve()) },
  );
  // 1 intento inicial + 3 reintentos; el caller recibe el error y lanza.
  assertEquals(calls, 4);
  assertEquals(delays, [200, 400, 800]);
  assertEquals(result.error?.code, "40P01");
});

Deno.test("withRetry — jitter mantiene el delay entre 50% y 100% del backoff", async () => {
  let calls = 0;
  const delays: number[] = [];
  await withRetry(
    () => (calls++, Promise.resolve({ error: { code: "40P01", message: "deadlock detected" } })),
    { retries: 2, baseMs: 200, sleep: (ms) => (delays.push(ms), Promise.resolve()) },
  );
  assertEquals(delays.length, 2);
  const bounds = [[100, 200], [200, 400]] as const;
  delays.forEach((ms, i) => {
    const [lo, hi] = bounds[i]!;
    assertEquals(ms >= lo && ms <= hi, true, `delay ${ms} fuera de [${lo}, ${hi}]`);
  });
});

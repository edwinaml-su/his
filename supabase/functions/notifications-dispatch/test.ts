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
  buildDrugInteractionTemplate,
  buildLabCriticalValueTemplate,
  buildVitalCriticalTemplate,
  clip,
  DEFAULT_ROLE_DEFAULTS,
  mapEventTypeToSeverity,
  renderTemplate,
  resolveChannels,
  validatePayloadShallow,
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

Deno.test("DEFAULT_ROLE_DEFAULTS — incluye PHYSICIAN, NURSE, PHARMACIST, ADMIN", () => {
  for (const code of ["PHYSICIAN", "NURSE", "PHARMACIST", "ADMIN"]) {
    assertNotEquals(DEFAULT_ROLE_DEFAULTS.get(code), undefined, `missing role ${code}`);
  }
});

/**
 * Tests US.B15.2.4 — Plantillas email HTML + texto plano por eventType.
 *
 * Por cada plantilla se verifica:
 *  1. Render con payload válido produce subject, html y text no vacíos.
 *  2. Campos clave del payload aparecen en el output.
 *  3. XSS escape: campos libres con caracteres peligrosos quedan escapados en HTML.
 *  4. Campos opcionales (patientName, recipientName, url) se incluyen cuando presentes.
 *  5. Branding HIS/Avante en header y footer.
 */
import { describe, it, expect } from "vitest";
import type {
  VitalCriticalPayload,
  LabCriticalValuePayload,
  DrugInteractionPayload,
  AllergyMismatchPayload,
} from "@his/contracts";

import {
  buildVitalCriticalTemplate,
  buildLabCriticalValueTemplate,
  buildDrugInteractionTemplate,
  buildAllergyMismatchTemplate,
  escape,
} from "../templates";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const vitalPayload: VitalCriticalPayload = {
  source: "InpatientVitals",
  admissionId: "11111111-1111-1111-1111-111111111111",
  patientId: "22222222-2222-2222-2222-222222222222",
  sourceRowId: "33333333-3333-3333-3333-333333333333",
  alerts: [
    { parameter: "HR", value: 160, severity: "CRITICAL", message: "Taquicardia severa" },
    { parameter: "SPO2", value: 88, severity: "CRITICAL", message: "Hipoxemia" },
  ],
};

const labPayload: LabCriticalValuePayload = {
  orderItemId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  resultId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  prescriberId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  testCode: "K",
  flag: "CRITICAL_HIGH",
  value: 7.2,
  unit: "mEq/L",
  referenceRange: { low: 3.5, high: 5.5 },
};

const drugPayload: DrugInteractionPayload = {
  prescriptionId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  prescriberId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  conflictingDrugIds: [
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "00000000-0000-0000-0000-000000000000",
  ],
  severity: "CRITICAL",
  description: "Warfarina + Aspirina: riesgo elevado de sangrado.",
};

const allergyPayload: AllergyMismatchPayload = {
  prescriptionItemId: "11111111-2222-3333-4444-555555555555",
  patientId: "22222222-2222-2222-2222-222222222222",
  allergyId: "33333333-3333-3333-3333-333333333333",
  drugId: "44444444-4444-4444-4444-444444444444",
  prescriberId: "55555555-5555-5555-5555-555555555555",
};

// ---------------------------------------------------------------------------
// escape() unit
// ---------------------------------------------------------------------------

describe("escape", () => {
  it("escapa los 6 caracteres peligrosos", () => {
    expect(escape(`<script>alert('XSS "test" & hack/it</script>`)).toBe(
      `&lt;script&gt;alert(&#x27;XSS &quot;test&quot; &amp; hack&#x2F;it&lt;&#x2F;script&gt;`,
    );
  });

  it("no altera texto sin caracteres especiales", () => {
    expect(escape("Texto limpio 123")).toBe("Texto limpio 123");
  });
});

// ---------------------------------------------------------------------------
// vital.critical
// ---------------------------------------------------------------------------

describe("buildVitalCriticalTemplate", () => {
  it("produce subject, html y text no vacíos", () => {
    const { subject, html, text } = buildVitalCriticalTemplate(vitalPayload);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("subject incluye '[CRÍTICO]'", () => {
    const { subject } = buildVitalCriticalTemplate(vitalPayload);
    expect(subject).toContain("[CRÍTICO]");
  });

  it("html incluye los parámetros vitales", () => {
    const { html } = buildVitalCriticalTemplate(vitalPayload);
    expect(html).toContain("HR");
    expect(html).toContain("SPO2");
    // Los valores numéricos no pasan por escape, aparecen directamente
    expect(html).toContain("160");
    expect(html).toContain("88");
  });

  it("text incluye los parámetros vitales", () => {
    const { text } = buildVitalCriticalTemplate(vitalPayload);
    expect(text).toContain("HR");
    expect(text).toContain("SPO2");
  });

  it("incluye nombre del paciente cuando se provee en ctx", () => {
    const { subject, html, text } = buildVitalCriticalTemplate(vitalPayload, {
      patientName: "María López",
    });
    expect(subject).toContain("María López");
    expect(html).toContain("María López");
    expect(text).toContain("María López");
  });

  it("incluye saludo al recipientName", () => {
    const { html, text } = buildVitalCriticalTemplate(vitalPayload, {
      recipientName: "Dr. García",
    });
    expect(html).toContain("Dr. García");
    expect(text).toContain("Dr. García");
  });

  it("incluye botón CTA con url cuando se provee", () => {
    const { html, text } = buildVitalCriticalTemplate(vitalPayload, {
      url: "https://his.avante.sv/expediente/123",
    });
    expect(html).toContain("https://his.avante.sv/expediente/123");
    expect(text).toContain("https://his.avante.sv/expediente/123");
  });

  it("XSS — patientName con caracteres peligrosos se escapa en html pero NO en text", () => {
    const xssName = '<img src="x" onerror="alert(1)">';
    const { html, text } = buildVitalCriticalTemplate(vitalPayload, {
      patientName: xssName,
    });
    // En HTML debe aparecer el nombre escapado, no el raw
    expect(html).not.toContain(xssName);
    expect(html).toContain("&lt;img");
    // En texto plano el nombre aparece sin procesar HTML (es texto puro, no tiene riesgo)
    expect(text).toContain(xssName);
  });

  it("XSS — url con & y comillas dobles se escapan en el atributo href", () => {
    // El escapeAttr protege contra romper el atributo con & o "
    const evilUrl = 'https://his.sv?a=1&b=2"onclick="alert(1)';
    const { html } = buildVitalCriticalTemplate(vitalPayload, { url: evilUrl });
    // & → &amp; para no romper el parser
    expect(html).toContain("&amp;b=2");
    // " → &quot; para no cerrar el atributo prematuramente
    expect(html).not.toContain('"onclick=');
    expect(html).toContain("&quot;onclick=");
  });

  it("html tiene DOCTYPE y estructura de tabla compatible con email clients", () => {
    const { html } = buildVitalCriticalTemplate(vitalPayload);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("HIS Multipaís");
  });

  it("html incluye branding footer de Inversiones Avante", () => {
    const { html } = buildVitalCriticalTemplate(vitalPayload);
    expect(html).toContain("Inversiones Avante");
    expect(html).toContain("Preferencias de notificaciones");
  });
});

// ---------------------------------------------------------------------------
// lab.criticalValue
// ---------------------------------------------------------------------------

describe("buildLabCriticalValueTemplate", () => {
  it("produce output completo con payload válido", () => {
    const { subject, html, text } = buildLabCriticalValueTemplate(labPayload);
    expect(subject).toContain("[CRÍTICO]");
    expect(subject).toContain("K");
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("incluye testCode en subject y body", () => {
    const { subject, html, text } = buildLabCriticalValueTemplate(labPayload);
    expect(subject).toContain("K");
    expect(html).toContain("K");
    expect(text).toContain("K");
  });

  it("incluye valor, unidad y rango de referencia", () => {
    const { html, text } = buildLabCriticalValueTemplate(labPayload);
    expect(html).toContain("7.2");
    expect(html).toContain("mEq&#x2F;L");    // unit pasa por escape()
    expect(html).toContain("3.5");
    expect(html).toContain("5.5");
    expect(text).toContain("7.2");
    expect(text).toContain("mEq/L");
    expect(text).toContain("3.5");
  });

  it("CRITICAL_LOW label en español", () => {
    const lowPayload: LabCriticalValuePayload = {
      ...labPayload,
      flag: "CRITICAL_LOW",
      value: 1.2,
    };
    const { html, text } = buildLabCriticalValueTemplate(lowPayload);
    expect(html).toContain("Críticamente BAJO");
    expect(text).toContain("Críticamente BAJO");
  });

  it("CRITICAL_HIGH label en español", () => {
    const { html } = buildLabCriticalValueTemplate(labPayload);
    expect(html).toContain("Críticamente ALTO");
  });

  it("XSS — testCode con caracteres peligrosos escapado en html", () => {
    const xssPayload: LabCriticalValuePayload = {
      ...labPayload,
      testCode: '<b onclick="alert()">K+</b>',
    };
    const { html } = buildLabCriticalValueTemplate(xssPayload);
    expect(html).not.toContain('<b onclick=');
    expect(html).toContain("&lt;b");
  });

  it("incluye patientName en subject y body cuando se provee", () => {
    const { subject, html, text } = buildLabCriticalValueTemplate(labPayload, {
      patientName: "Juan Pérez",
    });
    expect(subject).toContain("Juan Pérez");
    expect(html).toContain("Juan Pérez");
    expect(text).toContain("Juan Pérez");
  });

  it("html incluye branding", () => {
    const { html } = buildLabCriticalValueTemplate(labPayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

// ---------------------------------------------------------------------------
// drug.interaction
// ---------------------------------------------------------------------------

describe("buildDrugInteractionTemplate", () => {
  it("subject CRÍTICO para severity CRITICAL", () => {
    const { subject } = buildDrugInteractionTemplate(drugPayload);
    expect(subject).toContain("[CRÍTICO]");
  });

  it("subject ADVERTENCIA para severity WARNING", () => {
    const warnPayload: DrugInteractionPayload = {
      ...drugPayload,
      severity: "WARNING",
    };
    const { subject } = buildDrugInteractionTemplate(warnPayload);
    expect(subject).toContain("[ADVERTENCIA]");
  });

  it("incluye descripción de la interacción en html y text", () => {
    const { html, text } = buildDrugInteractionTemplate(drugPayload);
    // description pasa por escape — / → &#x2F; en html
    expect(html).toContain("Warfarina");
    expect(html).toContain("Aspirina");
    expect(text).toContain("Warfarina");
    expect(text).toContain("Aspirina");
  });

  it("incluye número de medicamentos en conflicto", () => {
    const { html, text } = buildDrugInteractionTemplate(drugPayload);
    expect(html).toContain("2");
    expect(text).toContain("2");
  });

  it("XSS — description con script tags escapado en html", () => {
    const xssPayload: DrugInteractionPayload = {
      ...drugPayload,
      description: '<script>evil()</script> Interacción real',
    };
    const { html, text } = buildDrugInteractionTemplate(xssPayload);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // En text no hay parsing HTML — el contenido aparece tal cual
    expect(text).toContain("<script>evil()</script>");
  });

  it("incluye CTA url en html y text", () => {
    const { html, text } = buildDrugInteractionTemplate(drugPayload, {
      url: "https://his.avante.sv/farmacia/receta/dddd",
    });
    expect(html).toContain("https://his.avante.sv/farmacia/receta/dddd");
    expect(text).toContain("https://his.avante.sv/farmacia/receta/dddd");
  });

  it("html incluye branding", () => {
    const { html } = buildDrugInteractionTemplate(drugPayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

// ---------------------------------------------------------------------------
// allergy.mismatch
// ---------------------------------------------------------------------------

describe("buildAllergyMismatchTemplate", () => {
  it("produce output con payload válido", () => {
    const { subject, html, text } = buildAllergyMismatchTemplate(allergyPayload);
    expect(subject).toContain("[CRÍTICO]");
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("html y text indican severidad CRÍTICO", () => {
    const { html, text } = buildAllergyMismatchTemplate(allergyPayload);
    expect(html).toContain("CRÍTICO");
    expect(text).toContain("CRÍTICO");
  });

  it("incluye patientName en subject y body", () => {
    const { subject, html, text } = buildAllergyMismatchTemplate(allergyPayload, {
      patientName: "Ana González",
    });
    expect(subject).toContain("Ana González");
    expect(html).toContain("Ana González");
    expect(text).toContain("Ana González");
  });

  it("XSS — patientName con caracteres peligrosos escapado en html", () => {
    const xssName = '"><img src=x onerror=alert(0)>';
    const { html } = buildAllergyMismatchTemplate(allergyPayload, {
      patientName: xssName,
    });
    expect(html).not.toContain(xssName);
    expect(html).toContain("&lt;img");
  });

  it("incluye mensaje de acción urgente en html y text", () => {
    const { html, text } = buildAllergyMismatchTemplate(allergyPayload);
    expect(html).toContain("expediente clínico");
    expect(text).toContain("expediente clínico");
  });

  it("incluye CTA url cuando se provee", () => {
    const { html, text } = buildAllergyMismatchTemplate(allergyPayload, {
      url: "https://his.avante.sv/emar/admin/1111",
    });
    expect(html).toContain("https://his.avante.sv/emar/admin/1111");
    expect(text).toContain("https://his.avante.sv/emar/admin/1111");
  });

  it("html incluye branding", () => {
    const { html } = buildAllergyMismatchTemplate(allergyPayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

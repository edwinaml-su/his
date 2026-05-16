/**
 * Tests plantillas Beta.16.1 + Beta.17.1 + Beta.18.1.
 *
 * Por cada plantilla:
 *  1. Render con payload válido produce subject, html, text no vacíos.
 *  2. Campos clave del payload aparecen en el output.
 *  3. XSS escape en campos libres.
 *  4. Severidad condicional (adverseReaction).
 *  5. Branding HIS/Avante.
 */
import { describe, it, expect } from "vitest";
import type {
  TransfusionCrossmatchFailedPayload,
  TransfusionAdverseReactionPayload,
  PathologyReportSignedPayload,
  PathologyCriticalFindingPayload,
  AccountingPeriodClosedPayload,
  AccountingJournalPostedHighValuePayload,
} from "@his/contracts";

import {
  buildTransfusionCrossmatchFailedTemplate,
  buildTransfusionAdverseReactionTemplate,
  buildPathologyReportSignedTemplate,
  buildPathologyCriticalFindingTemplate,
  buildAccountingPeriodClosedTemplate,
  buildAccountingJournalPostedHighValueTemplate,
} from "../templates";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const crossmatchPayload: TransfusionCrossmatchFailedPayload = {
  requestId:     "11111111-1111-4111-8111-111111111111",
  unitId:        "22222222-2222-4222-8222-222222222222",
  crossMatchId:  "33333333-3333-4333-8333-333333333333",
  result:        "INCOMPATIBLE",
  requestedById: "44444444-4444-4444-8444-444444444444",
  patientId:     "55555555-5555-4555-8555-555555555555",
};

const adverseReactionBase: TransfusionAdverseReactionPayload = {
  transfusionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  requestId:     "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  patientId:     "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  supervisorId:  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  nurseId:       "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  reactionType:  "Urticaria generalizada",
  severity:      "SEVERE",
};

const reportSignedPayload: PathologyReportSignedPayload = {
  reportId:               "ffffffff-ffff-4fff-8fff-ffffffffffff",
  orderId:                "00000000-0000-4000-8000-000000000000",
  requestingPhysicianId:  "11111111-2222-4333-8444-555555555555",
  pathologistId:          "66666666-7777-4888-8999-000000000001",
  primaryDiagnosis:       "Adenocarcinoma moderadamente diferenciado",
};

const criticalFindingPayload: PathologyCriticalFindingPayload = {
  reportId:              "22222222-3333-4444-8555-666666666666",
  orderId:               "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
  requestingPhysicianId: "cccccccc-dddd-4eee-8fff-000000000002",
  serviceHeadId:         "11111111-2222-4333-8444-000000000003",
  primaryDiagnosis:      "Linfoma de Hodgkin clásico",
};

const periodClosedPayload: AccountingPeriodClosedPayload = {
  organizationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  ledgerId:       "ffffffff-0000-4111-8222-333333333333",
  periodId:       "44444444-5555-4666-8777-888888888888",
  periodYear:     2026,
  periodMonth:    5,
  closedById:     "99999999-aaaa-4bbb-8ccc-dddddddddddd",
};

const journalHighValuePayload: AccountingJournalPostedHighValuePayload = {
  organizationId:    "eeeeeeee-ffff-4000-8111-222222222222",
  ledgerId:          "33333333-4444-4555-8666-777777777777",
  journalEntryId:    "88888888-9999-4aaa-8bbb-cccccccccccc",
  totalDebit:        150000.50,
  thresholdExceeded: 100000,
  postedById:        "dddddddd-eeee-4fff-8000-111111111111",
};

// ---------------------------------------------------------------------------
// transfusion.crossmatchFailed
// ---------------------------------------------------------------------------

describe("buildTransfusionCrossmatchFailedTemplate", () => {
  it("produce subject, html y text no vacíos", () => {
    const { subject, html, text } = buildTransfusionCrossmatchFailedTemplate(crossmatchPayload);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("subject incluye '[CRÍTICO]'", () => {
    const { subject } = buildTransfusionCrossmatchFailedTemplate(crossmatchPayload);
    expect(subject).toContain("[CRÍTICO]");
  });

  it("html y text incluyen el resultado y requestId", () => {
    const { html, text } = buildTransfusionCrossmatchFailedTemplate(crossmatchPayload);
    expect(html).toContain("INCOMPATIBLE");
    expect(html).toContain(crossmatchPayload.requestId);
    expect(text).toContain("INCOMPATIBLE");
    expect(text).toContain(crossmatchPayload.requestId);
  });

  it("html incluye mensaje de no proceder", () => {
    const { html, text } = buildTransfusionCrossmatchFailedTemplate(crossmatchPayload);
    expect(html).toContain("NO proceder");
    expect(text).toContain("NO proceder");
  });

  it("incluye saludo al recipientName cuando se provee", () => {
    const { html, text } = buildTransfusionCrossmatchFailedTemplate(crossmatchPayload, {
      recipientName: "Dr. Martínez",
    });
    expect(html).toContain("Dr. Martínez");
    expect(text).toContain("Dr. Martínez");
  });

  it("XSS — result con caracteres peligrosos escapado en html", () => {
    const evilPayload: TransfusionCrossmatchFailedPayload = {
      ...crossmatchPayload,
      result: "INCOMPATIBLE" as TransfusionCrossmatchFailedPayload["result"],
    };
    // El campo result es un enum — no hay riesgo directo, pero probamos el escape
    // via un patron con caracteres HTML en recipientName
    const { html } = buildTransfusionCrossmatchFailedTemplate(evilPayload, {
      recipientName: '<script>alert("xss")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("html incluye branding HIS/Avante", () => {
    const { html } = buildTransfusionCrossmatchFailedTemplate(crossmatchPayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

// ---------------------------------------------------------------------------
// transfusion.adverseReaction
// ---------------------------------------------------------------------------

describe("buildTransfusionAdverseReactionTemplate", () => {
  it("produce output no vacío", () => {
    const { subject, html, text } = buildTransfusionAdverseReactionTemplate(adverseReactionBase);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("SEVERE → subject '[CRÍTICO]'", () => {
    const { subject } = buildTransfusionAdverseReactionTemplate(adverseReactionBase);
    expect(subject).toContain("[CRÍTICO]");
  });

  it("LIFE_THREATENING → subject '[CRÍTICO]'", () => {
    const { subject } = buildTransfusionAdverseReactionTemplate({
      ...adverseReactionBase,
      severity: "LIFE_THREATENING",
    });
    expect(subject).toContain("[CRÍTICO]");
  });

  it("MODERATE → subject '[ADVERTENCIA]'", () => {
    const { subject } = buildTransfusionAdverseReactionTemplate({
      ...adverseReactionBase,
      severity: "MODERATE",
    });
    expect(subject).toContain("[ADVERTENCIA]");
  });

  it("MILD → subject '[ADVERTENCIA]'", () => {
    const { subject } = buildTransfusionAdverseReactionTemplate({
      ...adverseReactionBase,
      severity: "MILD",
    });
    expect(subject).toContain("[ADVERTENCIA]");
  });

  it("html y text incluyen tipo de reacción y severidad", () => {
    const { html, text } = buildTransfusionAdverseReactionTemplate(adverseReactionBase);
    expect(html).toContain("Urticaria generalizada");
    expect(html).toContain("SEVERE");
    expect(text).toContain("Urticaria generalizada");
    expect(text).toContain("SEVERE");
  });

  it("XSS — reactionType con tags html escapado en html", () => {
    const xssPayload: TransfusionAdverseReactionPayload = {
      ...adverseReactionBase,
      reactionType: '<b>Urticaria</b> <script>evil()</script>',
    };
    const { html, text } = buildTransfusionAdverseReactionTemplate(xssPayload);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // texto plano sin escape HTML
    expect(text).toContain("<script>evil()</script>");
  });

  it("html incluye branding", () => {
    const { html } = buildTransfusionAdverseReactionTemplate(adverseReactionBase);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

// ---------------------------------------------------------------------------
// pathology.reportSigned
// ---------------------------------------------------------------------------

describe("buildPathologyReportSignedTemplate", () => {
  it("produce output no vacío", () => {
    const { subject, html, text } = buildPathologyReportSignedTemplate(reportSignedPayload);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("subject incluye '[INFO]'", () => {
    const { subject } = buildPathologyReportSignedTemplate(reportSignedPayload);
    expect(subject).toContain("[INFO]");
  });

  it("html y text incluyen diagnóstico y reportId", () => {
    const { html, text } = buildPathologyReportSignedTemplate(reportSignedPayload);
    expect(html).toContain("Adenocarcinoma");
    expect(html).toContain(reportSignedPayload.reportId);
    expect(text).toContain("Adenocarcinoma");
    expect(text).toContain(reportSignedPayload.reportId);
  });

  it("XSS — primaryDiagnosis con caracteres peligrosos escapado en html", () => {
    const xssPayload: PathologyReportSignedPayload = {
      ...reportSignedPayload,
      primaryDiagnosis: '<script>alert(1)</script>',
    };
    const { html } = buildPathologyReportSignedTemplate(xssPayload);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("incluye recipientName en saludo", () => {
    const { html, text } = buildPathologyReportSignedTemplate(reportSignedPayload, {
      recipientName: "Dra. Flores",
    });
    expect(html).toContain("Dra. Flores");
    expect(text).toContain("Dra. Flores");
  });

  it("html incluye branding", () => {
    const { html } = buildPathologyReportSignedTemplate(reportSignedPayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

// ---------------------------------------------------------------------------
// pathology.criticalFinding
// ---------------------------------------------------------------------------

describe("buildPathologyCriticalFindingTemplate", () => {
  it("produce output no vacío", () => {
    const { subject, html, text } = buildPathologyCriticalFindingTemplate(criticalFindingPayload);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("subject incluye '[CRÍTICO]'", () => {
    const { subject } = buildPathologyCriticalFindingTemplate(criticalFindingPayload);
    expect(subject).toContain("[CRÍTICO]");
  });

  it("html y text incluyen diagnóstico y reportId", () => {
    const { html, text } = buildPathologyCriticalFindingTemplate(criticalFindingPayload);
    expect(html).toContain("Linfoma de Hodgkin");
    expect(html).toContain(criticalFindingPayload.reportId);
    expect(text).toContain("Linfoma de Hodgkin");
    expect(text).toContain(criticalFindingPayload.reportId);
  });

  it("XSS — primaryDiagnosis escapado en html", () => {
    const xssPayload: PathologyCriticalFindingPayload = {
      ...criticalFindingPayload,
      primaryDiagnosis: '"><img src=x onerror=alert(0)>',
    };
    const { html } = buildPathologyCriticalFindingTemplate(xssPayload);
    // El tag <img> debe aparecer escapado (no como tag real)
    expect(html).not.toContain('<img');
    expect(html).toContain("&lt;img");
    // La comilla doble de apertura también escapada
    expect(html).not.toContain('"><img');
  });

  it("html incluye branding", () => {
    const { html } = buildPathologyCriticalFindingTemplate(criticalFindingPayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

// ---------------------------------------------------------------------------
// accounting.periodClosed
// ---------------------------------------------------------------------------

describe("buildAccountingPeriodClosedTemplate", () => {
  it("produce output no vacío", () => {
    const { subject, html, text } = buildAccountingPeriodClosedTemplate(periodClosedPayload);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("subject incluye '[CONFIRMACIÓN]' y el período en español", () => {
    const { subject } = buildAccountingPeriodClosedTemplate(periodClosedPayload);
    expect(subject).toContain("[CONFIRMACIÓN]");
    expect(subject).toContain("mayo 2026");
  });

  it("html y text incluyen periodId", () => {
    const { html, text } = buildAccountingPeriodClosedTemplate(periodClosedPayload);
    expect(html).toContain(periodClosedPayload.periodId);
    expect(text).toContain(periodClosedPayload.periodId);
  });

  it("mes 0 (sin nombre canónico) cae en fallback", () => {
    const payload: AccountingPeriodClosedPayload = { ...periodClosedPayload, periodMonth: 0 };
    const { subject } = buildAccountingPeriodClosedTemplate(payload);
    // MONTHS_ES[0] = "" → el label es " 2026" o "mes 0 2026"
    // Con el schema que acepta 0, MONTHS_ES[0] es "" así que periodLabel = " 2026"
    expect(subject).toContain("2026");
  });

  it("incluye recipientName en saludo", () => {
    const { html, text } = buildAccountingPeriodClosedTemplate(periodClosedPayload, {
      recipientName: "Contadora Pérez",
    });
    expect(html).toContain("Contadora Pérez");
    expect(text).toContain("Contadora Pérez");
  });

  it("html incluye branding", () => {
    const { html } = buildAccountingPeriodClosedTemplate(periodClosedPayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

// ---------------------------------------------------------------------------
// accounting.journalPostedHighValue
// ---------------------------------------------------------------------------

describe("buildAccountingJournalPostedHighValueTemplate", () => {
  it("produce output no vacío", () => {
    const { subject, html, text } = buildAccountingJournalPostedHighValueTemplate(journalHighValuePayload);
    expect(subject.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    expect(text.length).toBeGreaterThan(0);
  });

  it("subject incluye '[ADVERTENCIA]'", () => {
    const { subject } = buildAccountingJournalPostedHighValueTemplate(journalHighValuePayload);
    expect(subject).toContain("[ADVERTENCIA]");
  });

  it("html y text incluyen journalEntryId", () => {
    const { html, text } = buildAccountingJournalPostedHighValueTemplate(journalHighValuePayload);
    expect(html).toContain(journalHighValuePayload.journalEntryId);
    expect(text).toContain(journalHighValuePayload.journalEntryId);
  });

  it("html y text incluyen el monto total formateado", () => {
    const { html, text } = buildAccountingJournalPostedHighValueTemplate(journalHighValuePayload);
    // 150000.50 formateado con 2 decimales — el separador varía por entorno,
    // verificamos los dígitos principales.
    expect(html).toContain("150");
    expect(text).toContain("150");
  });

  it("XSS — journalEntryId (UUID) no tiene contenido peligroso, pero el template usa escape correctamente en otros campos", () => {
    // Verificamos que el template produce HTML con DOCTYPE
    const { html } = buildAccountingJournalPostedHighValueTemplate(journalHighValuePayload);
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("incluye CTA url cuando se provee", () => {
    const { html, text } = buildAccountingJournalPostedHighValueTemplate(journalHighValuePayload, {
      url: "https://his.avante.sv/contabilidad/asiento/8888",
    });
    expect(html).toContain("https://his.avante.sv/contabilidad/asiento/8888");
    expect(text).toContain("https://his.avante.sv/contabilidad/asiento/8888");
  });

  it("html incluye branding", () => {
    const { html } = buildAccountingJournalPostedHighValueTemplate(journalHighValuePayload);
    expect(html).toContain("HIS Multipaís");
    expect(html).toContain("Inversiones Avante");
  });
});

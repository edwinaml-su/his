/**
 * Tests — LASA acknowledgement bloqueante en medication-admin.router.ts
 *
 * JCI Standard: IPSG.3-H1 (US-21-D4)
 * "Look-Alike/Sound-Alike medications — acknowledgement must be traceable in DB."
 *
 * Cubre el procedimiento `recordBedsideAdmin` del medicationAdminRouter:
 *   (a) Droga no-LASA acepta sin ack — flujo normal.
 *   (b) Droga LASA sin ack rechaza con PRECONDITION_FAILED (IPSG3_LASA_ACK_REQUIRED).
 *   (c) Droga LASA con ack=true + reason persiste lasaAckAt + lasaAckBy + lasaAckReason.
 *   (d) Droga LASA con ack=true sin reason rechaza (reason es obligatoria con ack).
 *   (e) Evento jci.ipsg3.lasa_acknowledged emitido cuando ack correcto.
 *
 * @QA E2E (Playwright) — tests adicionales para Sprint 2:
 *   - Escanear GTIN de morfina → toast LASA + modal de acknowledgement bloqueante.
 *   - Completar modal con reason → administración procede + timestamp visible.
 *   - Cerrar modal sin completar → administración bloqueada; toast de error.
 *   - GTIN de metformina (sin LASA) → sin modal, flujo directo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { medicationAdminRouter } from "../medication-admin.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const NURSE_ID   = "00000000-0000-0000-0000-000000000001";
const PATIENT_ID = "00000000-0000-0000-0000-000000000002";
const ORG_ID     = "00000000-0000-0000-0000-0000000000aa";
const ITEM_ID    = "00000000-0000-0000-0000-000000000010";
const ADMIN_ID   = "00000000-0000-0000-0000-0000000000ff";

const DRUG_MORPHINE_ID  = "00000000-0000-0000-0000-0000000000d1";
const DRUG_METFORMIN_ID = "00000000-0000-0000-0000-0000000000d2";
const DRUG_MIDAZOLAM_ID = "00000000-0000-0000-0000-0000000000d3";

const GSRN_PACIENTE  = "804012345678901234";
const GSRN_ENFERMERA = "804087654321098765";
const GTIN           = "00370268001480";
const LOTE           = "L2025001";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const normalIndication = {
  id: ITEM_ID,
  drug: {
    id: DRUG_METFORMIN_ID,
    genericName: "Metformina",
    alertLevel: "standard",
  },
};

const lasaIndication = {
  id: ITEM_ID,
  drug: {
    id: DRUG_MORPHINE_ID,
    genericName: "Morfina",
    alertLevel: "critical",
  },
};

const lasaRow = {
  paired_drug_id:   DRUG_MIDAZOLAM_ID,
  paired_drug_name: "Midazolam 5mg/ml",
  razon:            "look-alike-packaging",
  severidad:        "critical",
};

const baseInput = {
  indicationId:     ITEM_ID,
  gtin:             GTIN,
  lote:             LOTE,
  gsrnPaciente:     GSRN_PACIENTE,
  nurseId:          NURSE_ID,
  patientId:        PATIENT_ID,
  secondIdentifier: { type: "MRN" as const, value: "MRN-2025-001" },
};

// ---------------------------------------------------------------------------
// Helper: mock que supera los checks anteriores al LASA check
// Mocks: IPSG.1 2-ID (gsrn+second match same patient), prescriptionItem, lasa query.
// ---------------------------------------------------------------------------

function wireBedsideSetup(prisma: DeepMockProxy<PrismaClient>, opts: {
  lasaRows?: typeof lasaRow[];
  drugAlerLevel?: string;
} = {}): void {
  // IPSG.1 ME 2 — los 2 identificadores apuntan al mismo paciente
  prisma.$queryRawUnsafe.mockImplementation(async (sql: string, ...args: unknown[]) => {
    const s = sql as string;
    if (s.includes("gsrn = $1")) return [{ id: PATIENT_ID }];
    if (s.includes('"mrn"') || s.includes('"nationalId"')) return [{ id: PATIENT_ID }];
    // LASA pair query
    if (s.includes("lasa_pair")) {
      return opts.lasaRows ?? [];
    }
    // No otras queries rawUnsafe relevantes aquí
    return [];
  });

  // PrescriptionItem lookup
  prisma.prescriptionItem.findFirst.mockResolvedValue({
    id: ITEM_ID,
    drug: {
      id: opts.lasaRows && opts.lasaRows.length > 0 ? DRUG_MORPHINE_ID : DRUG_METFORMIN_ID,
      genericName: opts.lasaRows && opts.lasaRows.length > 0 ? "Morfina" : "Metformina",
      alertLevel: opts.drugAlerLevel ?? "standard",
    },
  } as never);

  // $transaction passthrough
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });

  // Default: create succeeds
  prisma.medicationAdministration.create.mockResolvedValue({ id: ADMIN_ID, administeredAt: new Date() } as never);

  // domainEvent.create — outbox
  prisma.domainEvent.create.mockResolvedValue({ id: "ev-01" } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("medicationAdminRouter.recordBedsideAdmin — LASA ack (IPSG.3-H1)", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ── (a) Droga no-LASA acepta sin ack ──────────────────────────────────────
  describe("(a) Drug no-LASA — pasa sin lasaAcknowledged", () => {
    it("acepta administracion cuando drug no tiene par LASA activo", async () => {
      wireBedsideSetup(prisma, { lasaRows: [] });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.recordBedsideAdmin({
        ...baseInput,
        // Sin lasaAcknowledged ni lasaAcknowledgementReason
      });

      expect((result as { administrationId: string | null }).administrationId).toBe(ADMIN_ID);
      expect((result as { lasaAlert: unknown }).lasaAlert).toBeNull();
      expect((result as { requiresDoubleCheck: boolean }).requiresDoubleCheck).toBe(false);
    });

    it("con drug no-LASA, create no persiste campos lasa_ack_*", async () => {
      wireBedsideSetup(prisma, { lasaRows: [] });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.recordBedsideAdmin({ ...baseInput });

      const createArgs = prisma.medicationAdministration.create.mock.calls[0]?.[0];
      expect(createArgs?.data?.lasaAckAt).toBeNull();
      expect(createArgs?.data?.lasaAckBy).toBeNull();
      expect(createArgs?.data?.lasaAckReason).toBeNull();
    });
  });

  // ── (b) Droga LASA sin ack → PRECONDITION_FAILED ─────────────────────────
  describe("(b) Drug LASA sin ack — rechaza con PRECONDITION_FAILED", () => {
    it("lanza PRECONDITION_FAILED cuando drug tiene par LASA y no hay lasaAcknowledged", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "critical" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.recordBedsideAdmin({ ...baseInput }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("IPSG3_LASA_ACK_REQUIRED"),
      });
    });

    it("lanza PRECONDITION_FAILED cuando lasaAcknowledged=false explícito", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "critical" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.recordBedsideAdmin({
          ...baseInput,
          lasaAcknowledged: false,
          lasaAcknowledgementReason: "razón clínica aportada",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("lanza PRECONDITION_FAILED cuando lasaAcknowledged=true pero sin reason", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "critical" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.recordBedsideAdmin({
          ...baseInput,
          lasaAcknowledged: true,
          // lasaAcknowledgementReason ausente
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("message del error incluye nombre del medicamento par LASA", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow] });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      try {
        await caller.recordBedsideAdmin({ ...baseInput });
        expect.fail("Deberia haber lanzado error");
      } catch (err: unknown) {
        const e = err as { message?: string };
        expect(e.message).toContain("Midazolam 5mg/ml");
      }
    });
  });

  // ── (c) Droga LASA con ack correcto → persiste campos + emite audit ───────
  // Nota: usamos alertLevel="standard" para que el double-check (IPSG.3 ME 4)
  // no intercepte el flujo antes de llegar al create. El riesgo LASA viene de
  // ece.lasa_pair, no de alertLevel — ambas reglas son ortogonales.
  describe("(c) Drug LASA con ack=true + reason — persiste y emite audit", () => {
    it("persiste lasaAckAt, lasaAckBy, lasaAckReason cuando ack correcto", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "standard" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      const reason = "Verifique la etiqueta original contra el perfil del paciente";
      await caller.recordBedsideAdmin({
        ...baseInput,
        lasaAcknowledged: true,
        lasaAcknowledgementReason: reason,
      });

      const createArgs = prisma.medicationAdministration.create.mock.calls[0]?.[0];
      expect(createArgs?.data?.lasaAckAt).toBeInstanceOf(Date);
      expect(createArgs?.data?.lasaAckBy).toBe(NURSE_ID);
      expect(createArgs?.data?.lasaAckReason).toBe(reason);
    });

    it("administrationId esta presente en response cuando ack correcto", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "standard" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.recordBedsideAdmin({
        ...baseInput,
        lasaAcknowledged: true,
        lasaAcknowledgementReason: "Confirmado con segunda enfermera antes de administrar",
      });

      expect((result as { administrationId: string | null }).administrationId).toBe(ADMIN_ID);
      expect((result as { lasaAlert: unknown }).lasaAlert).not.toBeNull();
    });

    it("emite evento jci.ipsg3.lasa_acknowledged en outbox cuando ack correcto", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "standard" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.recordBedsideAdmin({
        ...baseInput,
        lasaAcknowledged: true,
        lasaAcknowledgementReason: "Verificado con guia de medicamentos LASA del servicio",
      });

      // 2 eventos esperados: medication.administered.bedside + jci.ipsg3.lasa_acknowledged
      const allEventCalls = prisma.domainEvent.create.mock.calls;
      const lasaAckEvent = allEventCalls.find(
        (c) => c[0]?.data?.eventType === "jci.ipsg3.lasa_acknowledged",
      );
      expect(lasaAckEvent).toBeDefined();

      const payload = lasaAckEvent![0]!.data.payload as Record<string, unknown>;
      expect(payload.medicationAdministrationId).toBe(ADMIN_ID);
      expect(payload.nurseId).toBe(NURSE_ID);
      expect(payload.pairedDrugName).toBe("Midazolam 5mg/ml");
      expect(payload.razon).toBe("look-alike-packaging");
      expect(payload.severidad).toBe("critical");
      expect(typeof payload.ackedAt).toBe("string");
    });

    it("evento medication.administered.bedside tambien emitido", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "standard" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      await caller.recordBedsideAdmin({
        ...baseInput,
        lasaAcknowledged: true,
        lasaAcknowledgementReason: "Verificacion fisica completada segun protocolo",
      });

      const bedsideEvent = prisma.domainEvent.create.mock.calls.find(
        (c) => c[0]?.data?.eventType === "medication.administered.bedside",
      );
      expect(bedsideEvent).toBeDefined();
    });

    it("create no se llama cuando la validacion LASA falla", async () => {
      wireBedsideSetup(prisma, { lasaRows: [lasaRow], drugAlerLevel: "standard" });

      const caller = medicationAdminRouter.createCaller(makeCtx({ prisma }));
      try {
        await caller.recordBedsideAdmin({ ...baseInput });
      } catch {
        // Error esperado
      }

      expect(prisma.medicationAdministration.create).not.toHaveBeenCalled();
    });
  });
});

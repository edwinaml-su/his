/**
 * CC-0016 — Tests del imagingRequestRouter (solicitud de radiología e
 * imágenes: cabecera ImagingRequest + N ImagingOrder hijas, catálogo,
 * parametrización de campos/reglas).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

// docs/48 Ola 3 (C3-1) — capturarCargo ya tiene su propia suite
// (charge-capture.test.ts); aquí solo importa que `crear` la invoque una vez
// por prestación con code/quantity correctos, mismo patrón que
// dispensation.router.test.ts / lis.router.test.ts.
const capturarCargoMock = vi.fn().mockResolvedValue({
  cargoId: "cargo-default",
  status: "VIGENTE",
  unitPrice: 10,
});
vi.mock("../../lib/charge-capture", () => ({
  capturarCargo: (...args: unknown[]) => capturarCargoMock(...args),
  revertirCargo: vi.fn(),
}));

import { imagingRequestRouter } from "../imaging-request.router";

const u = "00000000-0000-0000-0000-000000000001";
const cuentaId = "00000000-0000-0000-0000-000000000010";
const patientId = "00000000-0000-0000-0000-000000000011";
const labTestId = "00000000-0000-0000-0000-000000000012";
const panelId = "00000000-0000-0000-0000-000000000013";

const TENANT_NO_ADMIN = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };

function wireTransaction(prisma: DeepMockProxy<PrismaClient>): void {
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
}

const CUENTA_ROW = { id: cuentaId, patientId, encounterId: null };
const TEST_ROW = {
  id: labTestId,
  code: "RX001",
  name: "RX TORAX",
  imagingAttrs: {
    labTestId,
    requiereContraste: false,
    requiereAyuno: false,
    requiereAutorizacion: false,
    duracionMin: 15,
    modalityType: "CR",
    modalityId: null,
    preparacionPaciente: null,
  },
};

describe("imagingRequestRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction(prisma);
    capturarCargoMock.mockClear();
    // CC-0041 — defaults de los caminos nuevos de `crear` (sexo/alergias del
    // expediente, SLA parametrizable, CareTask por prestación) para que las
    // suites previas no crashen en llamadas sin stub.
    prisma.patient.findUnique.mockResolvedValue(null as never);
    prisma.patientAllergy.findMany.mockResolvedValue([] as never);
    prisma.imagingSlaConfig.findMany.mockResolvedValue([] as never);
    prisma.serviceUnit.findFirst.mockResolvedValue(null as never);
    prisma.careTask.create.mockResolvedValue({ id: u } as never);
  });

  // ---------------------------------------------------------------------------
  // crear
  // ---------------------------------------------------------------------------
  describe("crear", () => {
    function stubHappyPath() {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([TEST_ROW] as never);
      prisma.imagingOrder.findMany.mockResolvedValue([] as never);
      prisma.$queryRaw.mockResolvedValue([{ n: 7 }] as never);
      prisma.imagingRequest.create.mockResolvedValue({ id: u } as never);
      prisma.costCenter.findFirst.mockResolvedValue(null as never);
      prisma.imagingOrder.create.mockResolvedValue({ id: "order-1" } as never);
    }

    const validInput = {
      cuentaId,
      prestaciones: [{ labTestId }],
      dx: "M54.5",
      justificacion: "lumbalgia",
      prioridad: "ROUTINE" as const,
      // CC-0041 RF-06 — embarazo obligatorio siempre (sin fila Patient en el
      // mock, el sexo es desconocido y el input debe traerlo).
      embarazo: "No aplica" as const,
    };

    it("FORBIDDEN si no hay establecimiento seleccionado", async () => {
      const caller = imagingRequestRouter.createCaller(
        makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
      );
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si la cuenta no existe", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si falta un campo obligatorio por defecto (dx)", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.crear({
          cuentaId,
          prestaciones: [{ labTestId }],
          justificacion: "lumbalgia",
          prioridad: "ROUTINE",
          embarazo: "No aplica",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("respeta la parametrización: dx opcional deja pasar sin dx", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([
        { fieldKey: "dx", estado: "opcional" },
      ] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([TEST_ROW] as never);
      prisma.imagingOrder.findMany.mockResolvedValue([] as never);
      prisma.$queryRaw.mockResolvedValue([{ n: 1 }] as never);
      prisma.imagingRequest.create.mockResolvedValue({ id: u } as never);
      prisma.costCenter.findFirst.mockResolvedValue(null as never);
      prisma.imagingOrder.create.mockResolvedValue({ id: "order-1" } as never);

      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear({
        cuentaId,
        prestaciones: [{ labTestId }],
        justificacion: "lumbalgia",
        prioridad: "ROUTINE",
        embarazo: "No aplica",
      });
      expect(result.folio).toMatch(/^SOL-\d{4}-0001$/);
    });

    it("BAD_REQUEST si supera la regla maxN", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([
        { ruleKey: "maxN", enabled: true, valorNum: 1 },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.crear({ ...validInput, prestaciones: [{ labTestId }, { labTestId }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("NOT_FOUND si una prestación no existe en el catálogo", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST: contraste requiere creatinina cuando el campo no está oculto", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([
        { ...TEST_ROW, imagingAttrs: { ...TEST_ROW.imagingAttrs, requiereContraste: true } },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("OK: contraste + creatinina provista pasa la validación", async () => {
      stubHappyPath();
      prisma.labTest.findMany.mockResolvedValue([
        { ...TEST_ROW, imagingAttrs: { ...TEST_ROW.imagingAttrs, requiereContraste: true } },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear({ ...validInput, creatinina: "0.9" });
      expect(result.folio).toBe(`SOL-${new Date().getFullYear()}-0007`);
    });

    it("crea la solicitud y sus ImagingOrder hijas con folio SOL-{YYYY}-{NNNN}", async () => {
      stubHappyPath();
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear(validInput);

      expect(result.folio).toBe(`SOL-${new Date().getFullYear()}-0007`);
      expect(result.advertencias).toEqual([]);

      const createArgs = prisma.imagingOrder.create.mock.calls[0]![0];
      expect(createArgs.data).toMatchObject({
        requestId: u,
        patientAccountId: cuentaId,
        patientId,
        studyDescription: "RX TORAX",
        modalityType: "CR",
      });
    });

    it("docs/48 Ola 3 (C3-1): genera un cargo por prestación, con code/quantity=1 y origen IMAGENES", async () => {
      stubHappyPath();
      prisma.imagingOrder.create.mockResolvedValue({ id: "order-1" } as never);

      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.crear(validInput);

      expect(capturarCargoMock).toHaveBeenCalledTimes(1);
      expect(capturarCargoMock).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          patientId,
          encounterId: null,
          accountId: cuentaId,
          code: "RX001",
          descripcion: "RX TORAX",
          quantity: 1,
          origen: "IMAGENES",
          referenciaId: "order-1",
        }),
      );
    });

    it("devuelve advertencia de duplicado (dupWarn) sin bloquear la creación", async () => {
      stubHappyPath();
      prisma.imagingOrder.findMany.mockResolvedValue([
        { studyDescription: "RX TORAX" },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.crear(validInput);
      expect(result.advertencias.length).toBe(1);
      expect(result.advertencias[0]).toContain("RX TORAX");
    });

    it("BAD_REQUEST si la regla firma está habilitada y no se envía pin", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([
        { ruleKey: "firma", enabled: true, valorNum: null },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    // ─── CC-0041 (mockup v2) ────────────────────────────────────────────────

    it("CC-0041 RN-4: rechaza fecha de programación con prioridad URGENT/STAT", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.crear({ ...validInput, prioridad: "URGENT", fechaDeseada: new Date() }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Rutina"),
      });
    });

    it("CC-0041 RN-4: rechaza fecha de programación en el pasado", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.crear({
          ...validInput,
          fechaDeseada: new Date(Date.now() - 48 * 60 * 60 * 1000),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("R2.2 (plan remediación 2026-09): la comparación de fecha usa la TZ de la organización, no un hardcode SV", async () => {
      // now = 2026-01-14T20:00:00Z. En America/El_Salvador (UTC-6) es
      // "2026-01-14"; en una TZ desplazada (Asia/Tokyo, UTC+9) ya es
      // "2026-01-15". fechaDeseada = 2026-01-14T13:00:00Z es "hoy" en SV
      // pero "ayer" en Tokyo — si el código siguiera hardcodeado a SV,
      // esto pasaría; con la TZ de la organización resuelta, se rechaza.
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-14T20:00:00Z"));
      try {
        prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
        prisma.organization.findUnique.mockResolvedValue({
          country: {
            isoAlpha2: "JP",
            isoAlpha3: "JPN",
            defaultTzId: "Asia/Tokyo",
            defaultLocale: "ja-JP",
          },
          functionalCurr: { isoCode: "JPY" },
        } as never);
        const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
        await expect(
          caller.crear({
            ...validInput,
            fechaDeseada: new Date("2026-01-14T13:00:00Z"),
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
        expect(prisma.organization.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: MOCK_TENANT.organizationId } }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("CC-0041 RN-5: sexo masculino ⇒ embarazo «No aplica» automático aunque no venga en el input", async () => {
      stubHappyPath();
      prisma.patient.findUnique.mockResolvedValue({ biologicalSex: { code: "M" } } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const { embarazo: _sinEmbarazo, ...inputSinEmbarazo } = validInput;
      await caller.crear(inputSinEmbarazo);
      const args = prisma.imagingRequest.create.mock.calls[0]![0];
      expect(args.data.embarazo).toBe("No aplica");
    });

    it("CC-0041 RN-5: sexo femenino sin embarazo ⇒ BAD_REQUEST", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.patient.findUnique.mockResolvedValue({ biologicalSex: { code: "F" } } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const { embarazo: _sinEmbarazo, ...inputSinEmbarazo } = validInput;
      await expect(caller.crear(inputSinEmbarazo)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("embarazo"),
      });
    });

    it("CC-0041 RN-6: las alergias se snapshotean server-side desde PatientAllergy (ignora el input)", async () => {
      stubHappyPath();
      prisma.patientAllergy.findMany.mockResolvedValue([
        { substanceText: "Penicilina", reaction: "rash" },
        { substanceText: "Medio de contraste yodado", reaction: null },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({ ...validInput, alergias: "texto del cliente que se ignora" });
      const args = prisma.imagingRequest.create.mock.calls[0]![0];
      expect(args.data.alergias).toBe("Penicilina (rash) · Medio de contraste yodado");
    });

    it("CC-0041 RF-08: contraste con creatinina OCULTA en parametrización ⇒ BAD_REQUEST (advertencia bloqueante)", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([
        { fieldKey: "creat", estado: "oculto" },
      ] as never);
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      prisma.labTest.findMany.mockResolvedValue([
        { ...TEST_ROW, imagingAttrs: { ...TEST_ROW.imagingAttrs, requiereContraste: true } },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.crear(validInput)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("parametrización"),
      });
    });

    it("CC-0041 RF-03: persiste el snapshot de trazabilidad del dx (sistema/fuente/origen)", async () => {
      stubHappyPath();
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({
        ...validInput,
        dx: "ME84.2 — Dolor de la región lumbar",
        dxSistema: "CIE11",
        dxFuente: "Historia Clínica — 15/09/2026",
        dxOrigenId: u,
      });
      const args = prisma.imagingRequest.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        dxSistema: "CIE11",
        dxFuente: "Historia Clínica — 15/09/2026",
        dxOrigenId: u,
      });
    });

    it("CC-0041 — crea una CareTask RAD_TECHNICIAN por prestación con SLA parametrizado", async () => {
      stubHappyPath();
      prisma.imagingSlaConfig.findMany.mockResolvedValue([
        { priority: "ROUTINE", slaMinutes: 300, warningMinutes: 20 },
      ] as never);
      prisma.serviceUnit.findFirst.mockResolvedValue({ id: panelId } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.crear(validInput);
      expect(prisma.careTask.create).toHaveBeenCalledTimes(1);
      const args = prisma.careTask.create.mock.calls[0]![0];
      expect(args.data).toMatchObject({
        sourceType: "IMAGING_ORDER",
        sourceId: "order-1",
        assignedRoleCode: "RAD_TECHNICIAN",
        taskType: "IMAGING_TO_PERFORM",
        slaMinutes: 300, // parametrizado (ImagingSlaConfig), no el default 1440
        serviceUnitId: panelId,
      });
    });

    it("CC-0041 RF-04: prioridad STAT emite el hook imaging.solicitudStat", async () => {
      stubHappyPath();
      prisma.domainEvent.create.mockResolvedValue({ id: u } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.crear({ ...validInput, prioridad: "STAT" });
      const eventos = prisma.domainEvent.create.mock.calls.map(
        (c) => (c[0] as { data: { eventType: string } }).data.eventType,
      );
      expect(eventos).toContain("imaging.solicitudStat");
      expect(eventos).toContain("task.action_required");
    });
  });

  // ---------------------------------------------------------------------------
  // CC-0041 — fieldConfig.set: pisos normativos (CA-12)
  // ---------------------------------------------------------------------------
  describe("fieldConfig.set (CC-0041 CA-12)", () => {
    it("rechaza configurar embarazo como opcional u oculto", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.fieldConfig.set({ fieldKey: "embarazo", estado: "opcional" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        caller.fieldConfig.set({ fieldKey: "embarazo", estado: "oculto" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza ocultar la prioridad", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.fieldConfig.set({ fieldKey: "prio", estado: "oculto" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ---------------------------------------------------------------------------
  // CC-0041 — contexto del expediente (dx / sexo / alergias)
  // ---------------------------------------------------------------------------
  describe("contextoExpediente (CC-0041 RF-03)", () => {
    it("retorna sexo, alergias formateadas y dx CIE-10 de encuentros; degrada sin filas ECE", async () => {
      prisma.patientAccount.findFirst.mockResolvedValue(CUENTA_ROW as never);
      prisma.patient.findUnique.mockResolvedValue({ biologicalSex: { code: "F" } } as never);
      prisma.patientAllergy.findMany.mockResolvedValue([
        { substanceText: "Penicilina", reaction: "rash" },
      ] as never);
      prisma.encounterDiagnosis.findMany.mockResolvedValue([
        { id: u, conceptId: panelId, diagnosedAt: new Date() },
      ] as never);
      prisma.clinicalConcept.findMany.mockResolvedValue([
        { id: panelId, code: "M54.5", display: "Lumbalgia" },
      ] as never);
      // $queryRaw sin stub (undefined) — la lectura ECE degrada con warn.
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.contextoExpediente({ cuentaId });
      expect(r.sexo).toBe("F");
      expect(r.alergias).toBe("Penicilina (rash)");
      expect(r.diagnosticos[0]).toMatchObject({
        codigo: "M54.5",
        descripcion: "Lumbalgia",
        sistema: "CIE10",
        origenId: u,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // CC-0041 — supervisión + SLA parametrizable
  // ---------------------------------------------------------------------------
  describe("supervision / sla (CC-0041)", () => {
    it("supervision calcula semáforo VENCIDO con el SLA default para un estudio ORDERED viejo", async () => {
      prisma.imagingOrder.findMany.mockResolvedValue([
        {
          id: u,
          status: "ORDERED",
          priority: "ROUTINE",
          orderedAt: new Date(Date.now() - 2000 * 60_000),
          scheduledAt: null,
          completedAt: null,
          encounterId: null,
          modalityType: "CR",
          studyDescription: "RX TORAX",
          report: null,
          request: { folio: "SOL-2026-0001" },
          patient: { firstName: "Ana", lastName: "Cruz", expediente: "EXP-1", mrn: "M1" },
          patientAccount: { numeroCuenta: "CTA-1" },
        },
      ] as never);
      prisma.careTask.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const res = await caller.supervision({ incluirCompletados: true, limit: 200 });
      expect(res.rows[0]).toMatchObject({
        slaEstado: "VENCIDO",
        etapa: "SOLICITADO",
        atencion: "AMBULATORIO",
        categoria: "Radiografías",
      });
      expect(res.kpis.vencidos).toBe(1);
    });

    it("sla.list retorna defaults con esDefault=true y refleja la fila del tenant", async () => {
      prisma.imagingSlaConfig.findMany.mockResolvedValue([
        { priority: "STAT", slaMinutes: 45, warningMinutes: 10 },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.sla.list();
      expect(rows.find((r) => r.priority === "STAT")).toMatchObject({
        slaMinutes: 45,
        esDefault: false,
      });
      expect(rows.find((r) => r.priority === "ROUTINE")).toMatchObject({
        slaMinutes: 1440,
        esDefault: true,
      });
    });

    it("sla.upsert exige rol ADMIN/DIR", async () => {
      const caller = imagingRequestRouter.createCaller(
        makeCtx({ prisma, tenant: TENANT_NO_ADMIN }),
      );
      await expect(
        caller.sla.upsert({ priority: "STAT", slaMinutes: 45, warningMinutes: 10 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ---------------------------------------------------------------------------
  // listarPorCuenta / listarPorPaciente — estado derivado
  // ---------------------------------------------------------------------------
  describe("listarPorCuenta / listarPorPaciente", () => {
    it("deriva estado y concatena categorías por modalidad", async () => {
      prisma.imagingRequest.findMany.mockResolvedValue([
        {
          id: u,
          folio: "SOL-2026-0001",
          createdAt: new Date("2026-08-01"),
          prioridad: "ROUTINE",
          orders: [
            { status: "ORDERED", modalityType: "CR" },
            { status: "COMPLETED", modalityType: "CT" },
          ],
        },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.listarPorCuenta({ cuentaId });
      expect(rows[0]!.estado).toBe("pend"); // mínimo = ORDERED
      expect(rows[0]!.categorias).toBe("Radiografías, Tomografías");
      expect(rows[0]!.nPrestaciones).toBe(2);
    });

    it("listarPorPaciente filtra por patientId", async () => {
      prisma.imagingRequest.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.listarPorPaciente({ patientId });
      const args = prisma.imagingRequest.findMany.mock.calls[0]![0];
      expect(args!.where).toMatchObject({ patientId });
    });
  });

  // ---------------------------------------------------------------------------
  // detalle / resolverDeepLink
  // ---------------------------------------------------------------------------
  describe("detalle", () => {
    it("NOT_FOUND si la solicitud no existe", async () => {
      prisma.imagingRequest.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.detalle({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("incluye estado derivado en el detalle", async () => {
      prisma.imagingRequest.findFirst.mockResolvedValue({
        id: u,
        folio: "SOL-2026-0001",
        orders: [{ status: "VALIDATED" }],
      } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.detalle({ id: u });
      expect(r.estado).toBe("inf");
    });
  });

  describe("resolverDeepLink", () => {
    it("NOT_FOUND si la orden no existe", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.resolverDeepLink({ orderId: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("devuelve requestId null para una orden legada sin solicitud", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, requestId: null } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.resolverDeepLink({ orderId: u });
      expect(r.requestId).toBeNull();
    });

    it("devuelve el requestId cuando la orden viene del módulo de solicitud", async () => {
      prisma.imagingOrder.findFirst.mockResolvedValue({ id: u, requestId: "req-1" } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.resolverDeepLink({ orderId: u });
      expect(r.requestId).toBe("req-1");
    });
  });

  // ---------------------------------------------------------------------------
  // catalogoImagen
  // ---------------------------------------------------------------------------
  describe("catalogoImagen.list", () => {
    it("aplana paneles + tests + attrs en ImagingCatalogoItem[]", async () => {
      prisma.labPanel.findMany.mockResolvedValue([
        {
          id: panelId,
          code: "IMG-RX",
          name: "Radiografías",
          displayOrder: 1,
          active: true,
          tests: [
            {
              id: labTestId,
              code: "RX001",
              name: "RX TORAX",
              displayOrder: 1,
              active: true,
              imagingAttrs: { requiereContraste: false, requiereAyuno: true, requiereAutorizacion: false, duracionMin: 15, modalityId: null, preparacionPaciente: null },
            },
          ],
        },
      ] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const items = await caller.catalogoImagen.list();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ labTestId, code: "RX001", panelNombre: "Radiografías", requiereAyuno: true });
    });
  });

  describe("catalogoImagen.upsert", () => {
    it("FORBIDDEN sin rol ADMIN/DIR", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma, tenant: TENANT_NO_ADMIN }));
      await expect(
        caller.catalogoImagen.upsert({ panelId, code: "RX999", name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si la categoría no existe", async () => {
      prisma.labPanel.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.catalogoImagen.upsert({ panelId, code: "RX999", name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("CONFLICT si el código ya existe al crear", async () => {
      prisma.labPanel.findFirst.mockResolvedValue({ id: panelId, code: "IMG-RX" } as never);
      prisma.labTest.findFirst.mockResolvedValue({ id: "existing" } as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.catalogoImagen.upsert({ panelId, code: "RX999", name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("crea LabTest + ImagingTestAttrs con el modalityType derivado del panel", async () => {
      prisma.labPanel.findFirst.mockResolvedValue({ id: panelId, code: "IMG-TAC" } as never);
      prisma.labTest.findFirst.mockResolvedValue(null as never);
      prisma.labTest.create.mockResolvedValue({ id: labTestId } as never);
      prisma.imagingTestAttrs.upsert.mockResolvedValue({} as never);

      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.catalogoImagen.upsert({ panelId, code: "TC999", name: "TOMOGRAFIA PRUEBA" });

      const attrsArgs = prisma.imagingTestAttrs.upsert.mock.calls[0]![0];
      expect(attrsArgs.create).toMatchObject({ labTestId, modalityType: "CT" });
    });

    it("NOT_FOUND al actualizar una prestación fuera del tenant", async () => {
      prisma.labPanel.findFirst.mockResolvedValue({ id: panelId, code: "IMG-RX" } as never);
      prisma.labTest.findFirst.mockResolvedValue(null as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.catalogoImagen.upsert({ labTestId, panelId, name: "RX PRUEBA" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ---------------------------------------------------------------------------
  // fieldConfig / rules
  // ---------------------------------------------------------------------------
  describe("fieldConfig", () => {
    it("list devuelve defaults del mockup cuando la org no tiene filas", async () => {
      prisma.imagingFormFieldConfig.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.fieldConfig.list();
      expect(rows.find((r) => r.fieldKey === "dx")!.estado).toBe("obligatorio");
      expect(rows.find((r) => r.fieldKey === "obs")!.estado).toBe("oculto");
    });

    it("set requiere rol ADMIN/DIR", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma, tenant: TENANT_NO_ADMIN }));
      await expect(
        caller.fieldConfig.set({ fieldKey: "dx", estado: "opcional" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("set hace upsert por (organizationId, fieldKey)", async () => {
      prisma.imagingFormFieldConfig.upsert.mockResolvedValue({} as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.fieldConfig.set({ fieldKey: "obs", estado: "opcional" });
      const args = prisma.imagingFormFieldConfig.upsert.mock.calls[0]![0];
      expect(args.update).toEqual({ estado: "opcional" });
    });
  });

  describe("rules", () => {
    it("list devuelve defaults del mockup cuando la org no tiene filas", async () => {
      prisma.imagingModuleRule.findMany.mockResolvedValue([] as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      const rows = await caller.rules.list();
      expect(rows.find((r) => r.ruleKey === "multi")!.enabled).toBe(true);
      expect(rows.find((r) => r.ruleKey === "maxN")).toMatchObject({ enabled: false, valorNum: 10 });
    });

    it("set requiere rol ADMIN/DIR", async () => {
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma, tenant: TENANT_NO_ADMIN }));
      await expect(caller.rules.set({ ruleKey: "multi", enabled: false })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("set persiste valorNum en maxN", async () => {
      prisma.imagingModuleRule.upsert.mockResolvedValue({} as never);
      const caller = imagingRequestRouter.createCaller(makeCtx({ prisma }));
      await caller.rules.set({ ruleKey: "maxN", enabled: true, valorNum: 5 });
      const args = prisma.imagingModuleRule.upsert.mock.calls[0]![0];
      expect(args.create).toMatchObject({ ruleKey: "maxN", enabled: true, valorNum: 5 });
    });
  });
});

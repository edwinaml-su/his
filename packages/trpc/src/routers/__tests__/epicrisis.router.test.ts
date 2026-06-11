/**
 * Tests del epicrisisRouter (ECE §3.15 — Epicrisis de Egreso).
 *
 * Estrategia: tablas ECE operadas via $queryRaw/$executeRaw.
 * Se mockean con vi.fn() por procedimiento; emitDomainEvent se mockea globalmente.
 *
 * Cubre (≥8):
 *  1. list — filtra por episodioId (happy path)
 *  2. get — NOT_FOUND si no existe
 *  3. create — happy path MC
 *  4. create — FORBIDDEN si rol es NURSE
 *  5. firmar — CONFLICT si ya está firmado
 *  6. validar — CONFLICT si no está firmado (estado borrador)
 *  7. certificar — CONFLICT si no está validado (requiere validado previo)
 *  8. certificar — happy path DIR emite evento outbox
 *  9. anular — CONFLICT si ya está certificado
 * 10. firmar — NOT_FOUND si epicrisis no existe
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { epicrisisRouter } from "../ece/epicrisis.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mocks globales ───────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return { ...original, emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }) };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EPICRISIS_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPISODIO_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FIRMA_ID     = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PERSONAL_ID  = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PACIENTE_ID  = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const TIPO_DOC_ID  = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const ESTADO_INICIAL_ID = "11111111-1111-1111-1111-111111111111";
const INSTANCIA_ID = "22222222-2222-2222-2222-222222222222";

const MC_TENANT    = { ...MOCK_TENANT, establishmentId: "00000000-0000-0000-0000-000000000001", roleCodes: ["MC", "PHYSICIAN"] };
const ESP_TENANT   = { ...MOCK_TENANT, establishmentId: "00000000-0000-0000-0000-000000000001", roleCodes: ["ESP"] };
const DIR_TENANT   = { ...MOCK_TENANT, establishmentId: "00000000-0000-0000-0000-000000000001", roleCodes: ["DIR"] };

const EPICRISIS_BORRADOR = {
  id: EPICRISIS_ID,
  instancia_id: null,
  episodio_id: EPISODIO_ID,
  fecha_hora_egreso: new Date("2026-05-01T10:00:00Z"),
  tipo_egreso: "vivo",
  circunstancia_alta: "alta_medica",
  diagnosticos_egreso: [{ cie10: "J18.9", descripcion: "Neumonia", tipo: "principal" }],
  resumen_ingreso: "Paciente ingresa por disnea",
  evolucion_hospitalaria: "Evolución favorable",
  tratamiento_egreso: "Amoxicilina 500mg",
  indicaciones_egreso: "Control en 7 días",
  notas: null,
  medico_tratante_id: PERSONAL_ID,
  visto_jefe_servicio_id: null,
  estado_workflow: "borrador",
  firma_mc_id: null,
  firma_esp_id: null,
  firma_dir_id: null,
  firmado_en: null,
  validado_en: null,
  certificado_en: null,
  anulado_en: null,
  motivo_anulacion: null,
  registrado_en: new Date("2026-05-01T08:00:00Z"),
};

const CREATE_INPUT = {
  episodioHospitalarioId: EPISODIO_ID,
  fechaEgreso: new Date("2026-05-01T10:00:00Z"),
  motivoEgreso: "alta_medica" as const,
  diagnosticoEgresoCie10: [{ cie10: "J18.9", descripcion: "Neumonia", tipo: "principal" as const }],
  resumenIngreso: "Paciente ingresa por disnea severa",
  evolucionHospitalaria: "Evolución favorable con antibióticos",
  tratamientoEgreso: "Amoxicilina 500mg c/8h x 7 días",
  indicacionesEgreso: "Control con médico de cabecera en 7 días",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("epicrisisRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = mockDeep<PrismaClient>();
    // Procedures use $transaction with applyWorkflowContext inside — wire it up
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return cb;
    });
    (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  });

  // 1 ────────────────────────────────────────────────────────────────────────
  describe("list", () => {
    it("devuelve items paginados filtrando por episodioId", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([EPICRISIS_BORRADOR] as never)    // items
        .mockResolvedValueOnce([{ total: BigInt(1) }] as never); // count

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: MC_TENANT }));
      const result = await caller.list({ episodioId: EPISODIO_ID, page: 1, pageSize: 20 });

      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe(EPICRISIS_ID);
    });
  });

  // 2 ────────────────────────────────────────────────────────────────────────
  describe("get", () => {
    it("lanza NOT_FOUND si la epicrisis no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: MC_TENANT }));
      await expect(caller.get({ id: EPICRISIS_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // 3 ────────────────────────────────────────────────────────────────────────
  describe("create", () => {
    it("crea epicrisis en estado borrador para rol MC", async () => {
      // Instancia-first (DDL vivo): resuelve tipo_documento EPICRISIS, crea
      // documento_instancia y luego inserta epicrisis_egreso con instancia_id.
      prisma.$queryRaw
        .mockResolvedValueOnce([] as never)                                          // no existing
        .mockResolvedValueOnce([{ id: PERSONAL_ID }] as never)                       // personal_salud
        .mockResolvedValueOnce([                                                     // tipo_documento + estado inicial
          { tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INICIAL_ID },
        ] as never)
        .mockResolvedValueOnce([{ paciente_id: PACIENTE_ID }] as never)             // episodio
        .mockResolvedValueOnce([{ id: INSTANCIA_ID }] as never)                     // documento_instancia INSERT
        .mockResolvedValueOnce([{ id: EPICRISIS_ID }] as never);                    // epicrisis_egreso INSERT

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: MC_TENANT }));
      const result = await caller.create(CREATE_INPUT);

      expect(result.id).toBe(EPICRISIS_ID);
      expect(result.instanciaId).toBe(INSTANCIA_ID);
    });

    // 4 ──────────────────────────────────────────────────────────────────────
    it("lanza FORBIDDEN si el rol es NURSE (no MC)", async () => {
      const caller = epicrisisRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, establishmentId: "00000000-0000-0000-0000-000000000001", roleCodes: ["NURSE"] } }),
      );
      await expect(caller.create(CREATE_INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // 5 ────────────────────────────────────────────────────────────────────────
  describe("firmar", () => {
    it("lanza CONFLICT si la epicrisis ya está firmada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ ...EPICRISIS_BORRADOR, estado_workflow: "firmado" }] as never);

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: MC_TENANT }));
      await expect(caller.firmar({ id: EPICRISIS_ID, firmaId: FIRMA_ID }))
        .rejects.toMatchObject({ code: "CONFLICT" });
    });

    // 10 ─────────────────────────────────────────────────────────────────────
    it("lanza NOT_FOUND si la epicrisis no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: MC_TENANT }));
      await expect(caller.firmar({ id: EPICRISIS_ID, firmaId: FIRMA_ID }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // 6 ────────────────────────────────────────────────────────────────────────
  describe("validar", () => {
    it("lanza CONFLICT si la epicrisis está en borrador (no firmado)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([EPICRISIS_BORRADOR] as never);

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: ESP_TENANT }));
      await expect(caller.validar({ id: EPICRISIS_ID }))
        .rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("lanza FORBIDDEN si el rol es MC (no ESP)", async () => {
      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: MC_TENANT }));
      await expect(caller.validar({ id: EPICRISIS_ID }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // 7 ────────────────────────────────────────────────────────────────────────
  describe("certificar", () => {
    it("lanza CONFLICT si el estado no es validado (CONFLICT borrador)", async () => {
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValueOnce([EPICRISIS_BORRADOR]),
        $executeRaw: vi.fn(),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as any).mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: DIR_TENANT }));
      await expect(caller.certificar({ id: EPICRISIS_ID, firmaId: FIRMA_ID }))
        .rejects.toMatchObject({ code: "CONFLICT" });
    });

    // 8 ──────────────────────────────────────────────────────────────────────
    it("certifica y emite evento outbox cuando estado es validado", async () => {
      const epicrisisValidada = { ...EPICRISIS_BORRADOR, estado_workflow: "validado" };
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValueOnce([epicrisisValidada]),
        $executeRaw: vi.fn().mockResolvedValueOnce(1),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as any).mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: DIR_TENANT }));
      const result = await caller.certificar({ id: EPICRISIS_ID, firmaId: FIRMA_ID });

      expect(result.estado).toBe("certificado");
      expect(result.documentHash).toHaveLength(64); // SHA-256 hex
      expect(emitDomainEvent).toHaveBeenCalledOnce();
      const emitCall = vi.mocked(emitDomainEvent).mock.calls[0]!;
      expect(emitCall[1].eventType).toBe("ece.epicrisis.certificada");
      expect((emitCall[1].payload as { firmaId: string }).firmaId).toBe(FIRMA_ID);
    });

    it("lanza FORBIDDEN si el rol es ESP (no DIR)", async () => {
      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: ESP_TENANT }));
      await expect(caller.certificar({ id: EPICRISIS_ID, firmaId: FIRMA_ID }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // 9 ────────────────────────────────────────────────────────────────────────
  describe("anular", () => {
    it("lanza CONFLICT si la epicrisis está certificada", async () => {
      const txMock = {
        $queryRaw: vi.fn().mockResolvedValueOnce([{ ...EPICRISIS_BORRADOR, estado_workflow: "certificado" }]),
        $executeRaw: vi.fn(),
        $executeRawUnsafe: vi.fn().mockResolvedValue(0),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prisma.$transaction as any).mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const caller = epicrisisRouter.createCaller(makeCtx({ prisma, tenant: DIR_TENANT }));
      await expect(
        caller.anular({ id: EPICRISIS_ID, motivoAnulacion: "Error administrativo grave documentado" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});

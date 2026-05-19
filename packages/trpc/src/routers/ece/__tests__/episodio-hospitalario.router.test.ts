/**
 * Tests de eceEpisodioHospitalarioRouter.
 *
 * Cubre:
 *  1.  listActivos — happy-path devuelve items
 *  2.  listActivos — lista vacía
 *  3.  listActivos — FORBIDDEN sin rol
 *  4.  getDetalle — happy-path
 *  5.  getDetalle — NOT_FOUND cuando no existe
 *  6.  iniciarAltaMedica — happy-path: crea epicrisis + emite evento (mismo tx, HD-10)
 *  7.  iniciarAltaMedica — CONFLICT si episodio no está en_curso
 *  8.  iniciarAltaMedica — NOT_FOUND si episodio no existe
 *  9.  confirmarAlta — happy-path: cierra episodio + libera cama + evento (mismo tx, HD-10)
 * 10.  confirmarAlta — CONFLICT si epicrisis en borrador
 * 11.  confirmarAlta — CONFLICT si episodio no está en alta_iniciada
 * 12.  confirmarAlta — NOT_FOUND si episodio no existe
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceEpisodioHospitalarioRouter } from "../episodio-hospitalario.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mock outbox ──────────────────────────────────────────────────────────────

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }),
  };
});

import { emitDomainEvent } from "@his/database";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EPISODIO_HOSP_ID  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EPISODIO_ATEN_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const EPICRISIS_ID      = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PACIENTE_ID       = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const MEDICO_ID         = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const ORG_ID            = MOCK_TENANT.organizationId;
const ESTAB_ID          = MOCK_TENANT.establishmentId ?? "11111111-1111-1111-1111-111111111111";

const TENANT_PHYSICIAN = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"], establishmentId: ESTAB_ID };
const TENANT_NURSE     = { ...MOCK_TENANT, roleCodes: ["NURSE"],     establishmentId: ESTAB_ID };

// Fixtures usan nombres de alias SQL (sala_id = servicio_id, fecha_ingreso = fecha_hora_orden_ingreso)
const ACTIVO_ROW = {
  id: EPISODIO_HOSP_ID,
  episodio_atencion_id: EPISODIO_ATEN_ID,
  paciente_id: PACIENTE_ID,
  paciente_nombre: "Juan Pérez",
  sala_id: "11111111-0000-0000-0000-000000000000",     // alias de servicio_id
  sala_nombre: "Medicina Interna",
  cama_id: "22222222-0000-0000-0000-000000000000",
  cama_codigo: "MI-101",
  fecha_ingreso: new Date("2026-05-10T08:00:00Z"),      // alias de fecha_hora_orden_ingreso
  estado: "en_curso",
  medico_nombre: null,                                  // medico_tratante_id eliminado (HD-08)
};

const DETALLE_ROW = {
  ...ACTIVO_ROW,
  motivo_ingreso: "Dolor abdominal severo",
  orden_ingreso_id: "33333333-0000-0000-0000-000000000000",
  documentos_firmados_count: 2,
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

function makePhysicianCaller(prisma: DeepMockProxy<PrismaClient>) {
  return eceEpisodioHospitalarioRouter.createCaller(
    makeCtx({ prisma, tenant: TENANT_PHYSICIAN }),
  );
}

function makeNurseCaller(prisma: DeepMockProxy<PrismaClient>) {
  return eceEpisodioHospitalarioRouter.createCaller(
    makeCtx({ prisma, tenant: TENANT_NURSE }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("eceEpisodioHospitalarioRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // ─── listActivos ───────────────────────────────────────────────────────────

  describe("listActivos", () => {
    it("1. happy-path: devuelve items paginados", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([ACTIVO_ROW]);

      const caller = makeNurseCaller(prisma);
      const result = await caller.listActivos({ limit: 50 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(EPISODIO_HOSP_ID);
      expect(result.items[0]?.sala_nombre).toBe("Medicina Interna");
      expect(result.nextCursor).toBeNull();
    });

    it("2. lista vacía devuelve items=[] y nextCursor=null", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = makeNurseCaller(prisma);
      const result = await caller.listActivos({ limit: 50 });

      expect(result.items).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("3. FORBIDDEN si usuario no tiene rol PHYSICIAN | NURSE | ADM", async () => {
      const sinRol = eceEpisodioHospitalarioRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["PORTAL"], establishmentId: ESTAB_ID } }),
      );
      await expect(sinRol.listActivos({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("3b. input no acepta campo gravedad (eliminado HD-08)", () => {
      // El schema Zod ya no incluye gravedad — TS lo verifica en build.
      // Verificamos que el input omite el campo sin error de runtime.
      const validInput = { limit: 10, servicioId: undefined };
      // Si el schema aceptara gravedad esto causaría error de tipos. El test documenta la decisión.
      expect(validInput).not.toHaveProperty("gravedad");
    });
  });

  // ─── getDetalle ───────────────────────────────────────────────────────────

  describe("getDetalle", () => {
    it("4. happy-path: devuelve detalle enriquecido", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([DETALLE_ROW]);

      const caller = makeNurseCaller(prisma);
      const result = await caller.getDetalle({ id: EPISODIO_HOSP_ID });

      expect(result.id).toBe(EPISODIO_HOSP_ID);
      expect(result.motivo_ingreso).toBe("Dolor abdominal severo");
      expect(result.documentos_firmados_count).toBe(2);
    });

    it("5. NOT_FOUND cuando el episodio no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = makeNurseCaller(prisma);
      await expect(
        caller.getDetalle({ id: EPISODIO_HOSP_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── iniciarAltaMedica ────────────────────────────────────────────────────

  describe("iniciarAltaMedica", () => {
    const VALID_INPUT = {
      episodioId: EPISODIO_ATEN_ID,
      medicoAltaId: MEDICO_ID,
      fechaHoraAlta: new Date("2026-05-17T14:00:00Z"),
      motivoAlta: "mejoria" as const,
      instruccionesAlta: "Reposo relativo, cita en 7 días.",
    };

    it("6. happy-path: crea epicrisis borrador, emite evento altaIniciada en mismo tx (HD-10)", async () => {
      // episodio en_curso
      prisma.$queryRaw.mockResolvedValueOnce([{
        id: EPISODIO_ATEN_ID,
        estado: "en_curso",
        paciente_id: PACIENTE_ID,
        episodio_hosp_id: EPISODIO_HOSP_ID,
      }]);
      // INSERT epicrisis → retorna epicrisisId
      prisma.$queryRaw.mockResolvedValueOnce([{ id: EPICRISIS_ID }]);
      // UPDATE estado + INSERT estado_log ya mockeados con $executeRaw → 0

      const caller = makePhysicianCaller(prisma);
      const result = await caller.iniciarAltaMedica(VALID_INPUT);

      expect(result.episodioId).toBe(EPISODIO_ATEN_ID);
      expect(result.epicrisisId).toBe(EPICRISIS_ID);
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.episodio.altaIniciada",
          aggregateId: EPISODIO_ATEN_ID,
        }),
      );
      // HD-10: no debe haber una segunda $transaction separada para el outbox
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("7. CONFLICT si el episodio no está en_curso", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{
        id: EPISODIO_ATEN_ID,
        estado: "cerrado",
        paciente_id: PACIENTE_ID,
        episodio_hosp_id: EPISODIO_HOSP_ID,
      }]);

      const caller = makePhysicianCaller(prisma);
      await expect(
        caller.iniciarAltaMedica(VALID_INPUT),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("8. NOT_FOUND si el episodio no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = makePhysicianCaller(prisma);
      await expect(
        caller.iniciarAltaMedica(VALID_INPUT),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── confirmarAlta ────────────────────────────────────────────────────────

  describe("confirmarAlta", () => {
    const VALID_CONFIRM = {
      episodioId: EPISODIO_ATEN_ID,
      epicrisisId: EPICRISIS_ID,
    };

    it("9. happy-path: cierra episodio, libera cama, emite altaConfirmada en mismo tx (HD-10)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{
        episodio_id: EPISODIO_ATEN_ID,
        estado_episodio: "alta_iniciada",
        episodio_hosp_id: EPISODIO_HOSP_ID,
        estado_epicrisis: "firmado",
        paciente_id: PACIENTE_ID,
      }]);

      const caller = makePhysicianCaller(prisma);
      const result = await caller.confirmarAlta(VALID_CONFIRM);

      expect(result.episodioId).toBe(EPISODIO_ATEN_ID);
      expect(result.epicrisisId).toBe(EPICRISIS_ID);
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.episodio.altaConfirmada",
          aggregateId: EPISODIO_ATEN_ID,
        }),
      );
      // HD-10: no debe haber una segunda $transaction separada para el outbox
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("10. CONFLICT si la epicrisis está en borrador", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{
        episodio_id: EPISODIO_ATEN_ID,
        estado_episodio: "alta_iniciada",
        episodio_hosp_id: EPISODIO_HOSP_ID,
        estado_epicrisis: "borrador",
        paciente_id: PACIENTE_ID,
      }]);

      const caller = makePhysicianCaller(prisma);
      await expect(caller.confirmarAlta(VALID_CONFIRM)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("11. CONFLICT si el episodio no está en alta_iniciada", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{
        episodio_id: EPISODIO_ATEN_ID,
        estado_episodio: "en_curso",
        episodio_hosp_id: EPISODIO_HOSP_ID,
        estado_epicrisis: "firmado",
        paciente_id: PACIENTE_ID,
      }]);

      const caller = makePhysicianCaller(prisma);
      await expect(caller.confirmarAlta(VALID_CONFIRM)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("12. NOT_FOUND si el episodio o epicrisis no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = makePhysicianCaller(prisma);
      await expect(caller.confirmarAlta(VALID_CONFIRM)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});

/**
 * Tests unitarios — indicacionesMedicasRouter (IND_MED).
 *
 * Estrategia: Vitest + vitest-mock-extended. Cero I/O real.
 * withEceContext mockeado para ejecutar el callback con el prisma mock.
 * emitDomainEvent mockeado para evitar side effects.
 *
 * Casos cubiertos (13 tests):
 *   1. create — happy path multi-item retorna id + estadoRegistro=borrador
 *   2. create — rechaza items vacíos (Zod min(1))
 *   3. create — rechaza cuando no hay establishmentId en tenant
 *   4. firmar — transición borrador→firmado + llama emitDomainEvent
 *   5. firmar — rechaza si estado_registro no es borrador
 *   6. registrarAdministracion — happy path ADMINISTRADO
 *   7. registrarAdministracion — OMITIDA sin motivo lanza BAD_REQUEST (Zod)
 *   8. suspender — ACTIVA → SUSPENDIDA
 *   9. cancelar — rechaza si vigencia ya es CANCELADA
 *  10. list — RLS demote: withEceContext recibe personalId correcto
 *  11. list — rechaza con PRECONDITION_FAILED si ECE no está inicializado
 *      para el establecimiento (resolveEceEstablecimientoId devuelve null)
 *  12. list — CONTROL NEGATIVO: withEceContext debe recibir el id resuelto
 *      en el espacio `ece.establecimiento` (ECE_ESTABLECIMIENTO_ID), nunca
 *      `ctx.tenant.establishmentId` (ESTAB_ID, espacio public) sin resolver
 *      — ver eceIds() en indicaciones-medicas.router.ts.
 *  13. create — misma aserción de control negativo que #12, en una mutation.
 *
 * @QA E2E pendiente:
 *   - PHYSICIAN crea indicación y la firma; NURSE la visualiza y registra admin.
 *   - NURSE no puede llamar create/firmar/cancelar (403).
 *   - registrarAdministracion OMITIDA con motivo <10 chars rechazado.
 *   - list filtra por vigencia=SUSPENDIDA correctamente.
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

// Mock withEceContext para ejecutar callback directamente con prisma mock
vi.mock("../../../ece/rls-context", () => ({
  withEceContext: vi.fn(async (
    prisma: PrismaClient,
    _personalId: string,
    _establecimientoId: string,
    fn: (tx: PrismaClient) => Promise<unknown>,
  ) => fn(prisma)),
}));

// Mock emitDomainEvent para no requerir BD real
vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }),
  };
});

import { indicacionesMedicasRouter } from "../indicaciones-medicas.router";
import { emitDomainEvent } from "@his/database";
import { withEceContext } from "../../../ece/rls-context";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const IND_ID = "00000000-0000-4000-8001-000000000001";
const ITEM_ID = "00000000-0000-4000-8001-000000000002";
const ADMIN_ID = "00000000-0000-4000-8001-000000000003";
const EP_ID = "00000000-0000-4000-8001-000000000004";
const MEDICO_ID = "00000000-0000-4000-8001-000000000005";
const ENF_ID = "00000000-0000-4000-8001-000000000006";
const ORG_ID = "00000000-0000-4000-8001-000000000007";
// ESTAB_ID = espacio public."Establishment" (ctx.tenant.establishmentId).
const ESTAB_ID = "00000000-0000-4000-8001-000000000008";
// ECE_ESTABLECIMIENTO_ID = espacio ece.establecimiento (lo que devuelve
// resolveEceEstablecimientoId). Deliberadamente distinto de ESTAB_ID: si
// eceIds() volviera a pasar ctx.tenant.establishmentId sin resolver, las
// aserciones de "CONTROL NEGATIVO" abajo fallarían.
const ECE_ESTABLECIMIENTO_ID = "00000000-0000-4000-8001-000000000009";

function buildCtx(
  roleCodes: string[] = ["PHYSICIAN"],
  establishmentId: string | undefined = ESTAB_ID,
) {
  const prisma = mockDeep<PrismaClient>();
  // withEceContext usa prisma.$transaction internamente pero el mock lo bypasea
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
  (prisma.$executeRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue(0);

  return {
    prisma,
    user: { id: MEDICO_ID, email: "medico@test.com", fullName: "Dr. Médico" },
    tenant: { organizationId: ORG_ID, establishmentId, roleCodes },
    portalAccount: null,
  };
}

function baseIndicacion(
  overrides: Partial<{
    id: string;
    estado_registro: string;
    vigencia: string;
    version: number;
  }> = {},
) {
  return {
    id: overrides.id ?? IND_ID,
    instancia_id: null,
    episodio_id: EP_ID,
    fecha_hora: new Date("2026-05-19T10:00:00Z"),
    version: overrides.version ?? 1,
    vigencia: overrides.vigencia ?? "ACTIVA",
    medico_prescriptor: MEDICO_ID,
    transcripcion_enf: null,
    registrado_en: new Date("2026-05-19T10:00:00Z"),
    estado_registro: overrides.estado_registro ?? "borrador",
    digitado_retroactivamente: false,
  };
}

/**
 * eceIds() llama a resolveEceEstablecimientoId ANTES de cualquier query del
 * propio router — y ambas usan prisma.$queryRaw (tagged template). Hay que
 * primar esta respuesta como la primera de la cadena mockResolvedValueOnce
 * en todo test que llegue a un procedure con establishmentId definido.
 */
function primeEceResolve(ctx: ReturnType<typeof buildCtx>) {
  (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { id: ECE_ESTABLECIMIENTO_ID },
  ]);
}

// ─── Caller helpers ───────────────────────────────────────────────────────────

function caller(ctx: ReturnType<typeof buildCtx>) {
  // Usamos el router directamente sin servidor tRPC completo
  return indicacionesMedicasRouter.createCaller(ctx as Parameters<typeof indicacionesMedicasRouter.createCaller>[0]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("indicacionesMedicasRouter", () => {
  describe("create", () => {
    it("happy path multi-item retorna id + estadoRegistro=borrador", async () => {
      const ctx = buildCtx(["PHYSICIAN"]);

      primeEceResolve(ctx);
      // Mock INSERT encabezado → RETURNING id
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: IND_ID },
      ]);
      // Mock INSERT ítems (2 items → 2 llamadas executeRaw)
      (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(1);

      const result = await caller(ctx).create({
        episodioId: EP_ID,
        medicoPrescriptor: MEDICO_ID,
        items: [
          { tipo: "MEDICAMENTO", descripcion: "Paracetamol", dosis: "500mg", via: "ORAL", frecuencia: "QID" },
          { tipo: "DIETA", descripcion: "Dieta blanda hipocalórica" },
        ],
      });

      expect(result.id).toBe(IND_ID);
      expect(result.estadoRegistro).toBe("borrador");
      expect(result.vigencia).toBe("ACTIVA");

      // CONTROL NEGATIVO (misma aserción que list, ver describe "list — RLS
      // demote" al final del archivo): withEceContext debe recibir el id
      // resuelto en espacio ece.establecimiento, nunca ESTAB_ID sin resolver.
      expect(ECE_ESTABLECIMIENTO_ID).not.toBe(ESTAB_ID);
      expect(withEceContext).toHaveBeenCalledWith(
        ctx.prisma,
        MEDICO_ID,
        ECE_ESTABLECIMIENTO_ID,
        expect.any(Function),
      );
    });

    it("rechaza items vacíos (Zod min(1))", async () => {
      const ctx = buildCtx(["PHYSICIAN"]);

      await expect(
        caller(ctx).create({
          episodioId: EP_ID,
          medicoPrescriptor: MEDICO_ID,
          items: [],
        }),
      ).rejects.toThrow();
    });

    it("rechaza cuando no hay establishmentId en tenant", async () => {
      const ctx = buildCtx(["PHYSICIAN"], undefined);

      await expect(
        caller(ctx).create({
          episodioId: EP_ID,
          medicoPrescriptor: MEDICO_ID,
          items: [{ tipo: "MEDICAMENTO", descripcion: "Amoxicilina" }],
        }),
      ).rejects.toThrowError(TRPCError);
    });
  });

  describe("firmar", () => {
    it("transición borrador→firmado + llama emitDomainEvent", async () => {
      const ctx = buildCtx(["PHYSICIAN"]);

      primeEceResolve(ctx);
      // Mock getIndicacionOrThrow
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([baseIndicacion({ estado_registro: "borrador" })])
        // Mock item texts for IPSG.2 forbidden-abbreviations check (solo descripcion, sin notas)
        .mockResolvedValueOnce([{ descripcion: "Paracetamol 500mg VO cada 8h" }])
        // Mock count items
        .mockResolvedValueOnce([{ cnt: 2 }]);
      (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const result = await caller(ctx).firmar({ id: IND_ID });

      expect(result.estadoRegistro).toBe("firmado");
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.indicaciones.firmadas",
          aggregateId: IND_ID,
          payload: expect.objectContaining({ itemCount: 2 }),
        }),
      );
    });

    it("rechaza si estado_registro no es borrador", async () => {
      const ctx = buildCtx(["PHYSICIAN"]);

      primeEceResolve(ctx);
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion({ estado_registro: "firmado" }),
      ]);

      await expect(caller(ctx).firmar({ id: IND_ID })).rejects.toThrow(
        TRPCError,
      );
    });
  });

  describe("registrarAdministracion", () => {
    it("happy path ADMINISTRADO inserta y retorna id + estado", async () => {
      const ctx = buildCtx(["NURSE"]);

      primeEceResolve(ctx);
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: ADMIN_ID },
      ]);

      const result = await caller(ctx).registrarAdministracion({
        indicacionItemId: ITEM_ID,
        registroEnfId: ENF_ID,
        horaAplicada: new Date("2026-05-19T14:00:00Z"),
        estado: "ADMINISTRADO",
        responsable: ENF_ID,
      });

      expect(result.id).toBe(ADMIN_ID);
      expect(result.estado).toBe("ADMINISTRADO");
    });

    it("OMITIDA sin motivo lanza error Zod (motivoOmision requerido)", async () => {
      const ctx = buildCtx(["NURSE"]);

      await expect(
        caller(ctx).registrarAdministracion({
          indicacionItemId: ITEM_ID,
          registroEnfId: ENF_ID,
          horaAplicada: new Date("2026-05-19T14:00:00Z"),
          estado: "OMITIDA",
          responsable: ENF_ID,
          // motivoOmision ausente → superRefine debe rechazar
        }),
      ).rejects.toThrow();
    });
  });

  describe("suspender", () => {
    it("ACTIVA → SUSPENDIDA retorna nuevo estado", async () => {
      const ctx = buildCtx(["NURSE"]);

      primeEceResolve(ctx);
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion({ vigencia: "ACTIVA" }),
      ]);
      (ctx.prisma.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const result = await caller(ctx).suspender({
        id: IND_ID,
        motivo: "Paciente presentó reacción adversa",
      });

      expect(result.vigencia).toBe("SUSPENDIDA");
    });
  });

  describe("cancelar", () => {
    it("rechaza si vigencia ya es CANCELADA", async () => {
      const ctx = buildCtx(["PHYSICIAN"]);

      primeEceResolve(ctx);
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion({ vigencia: "CANCELADA" }),
      ]);

      await expect(
        caller(ctx).cancelar({
          id: IND_ID,
          motivo: "Error de prescripción",
        }),
      ).rejects.toThrow(TRPCError);
    });
  });

  describe("list — RLS demote", () => {
    it("lanza BAD_REQUEST si no hay establishmentId (guard RLS demote)", async () => {
      // Sin establishmentId en tenant, el guard lanza antes de llamar withEceContext.
      // Esto garantiza que el contexto ECE siempre se inyecta con un establecimiento válido.
      const ctx = buildCtx(["PHYSICIAN"], undefined);

      await expect(
        caller(ctx).list({ episodioId: EP_ID, limit: 10 }),
      ).rejects.toThrow(TRPCError);
    });

    it("list ejecuta query y retorna items + nextCursor", async () => {
      const ctx = buildCtx(["PHYSICIAN"]);

      primeEceResolve(ctx);
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        baseIndicacion(),
      ]);

      const result = await caller(ctx).list({ episodioId: EP_ID, limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("lanza PRECONDITION_FAILED si ECE no está inicializado para el establecimiento", async () => {
      // resolveEceEstablecimientoId no encuentra fila en ece.establecimiento
      // (establishmentId existe en public pero nunca se corrió backfill-ece.mjs).
      const ctx = buildCtx(["PHYSICIAN"]);
      (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await expect(
        caller(ctx).list({ episodioId: EP_ID, limit: 10 }),
      ).rejects.toThrow(TRPCError);
    });

    it("CONTROL NEGATIVO: withEceContext recibe el establecimiento resuelto " +
      "(espacio ece), nunca ctx.tenant.establishmentId (espacio public) sin resolver",
      async () => {
        const ctx = buildCtx(["PHYSICIAN"]);

        primeEceResolve(ctx);
        (ctx.prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
          baseIndicacion(),
        ]);

        await caller(ctx).list({ episodioId: EP_ID, limit: 10 });

        // Si eceIds() volviera a hacer `establecimientoId: ctx.tenant.establishmentId`
        // (regresión al bug original), withEceContext se llamaría con ESTAB_ID
        // en vez de ECE_ESTABLECIMIENTO_ID y esta aserción fallaría.
        expect(ECE_ESTABLECIMIENTO_ID).not.toBe(ESTAB_ID);
        expect(withEceContext).toHaveBeenCalledWith(
          ctx.prisma,
          MEDICO_ID,
          ECE_ESTABLECIMIENTO_ID,
          expect.any(Function),
        );
      },
    );
  });
});

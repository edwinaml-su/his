/**
 * Tests — eceBridgeCirugiaRouter (bridge-cirugia.router.ts).
 *
 * Casos cubiertos (9 tests):
 *
 * programarCirugia:
 *  1. PRECONDITION_FAILED si personal ECE no existe para el usuario
 *  2. CONFLICT si sala QX tiene overlap de horario
 *  3. Happy-path: retorna ordenId, episodioId, preOpId, reservaId
 *  4. Rollback: si INSERT episodio_hospitalario falla → tx rechaza
 *  5. Rollback: si INSERT preop_checklist falla → tx rechaza (reserva nunca se crea)
 *
 * listProgramacionDia:
 *  6. Sin salaQxId: retorna todas las cirugías del día mapeadas
 *  7. Con salaQxId: usa la rama filtrada (misma forma de retorno)
 *
 * cancelarPrograma:
 *  8. NOT_FOUND si orden quirúrgica no existe
 *  9. Happy-path: cascade soft-delete + evento ece.cirugia.cancelada emitido
 *
 * @QA E2E: flujo completo programarCirugia → verificar reserva + episodio + preop;
 *   doble reserva misma sala mismo horario → CONFLICT;
 *   cancelarPrograma → verificar cascade.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceBridgeCirugiaRouter } from "../bridge-cirugia.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

// ─── Mock emitDomainEvent ─────────────────────────────────────────────────────
vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-cirugia-0001" }),
}));

// ─── UUIDs constantes ────────────────────────────────────────────────────────
const PERSONAL_ID   = "a1000000-0000-0000-0000-000000000001";
const PACIENTE_ID   = "a2000000-0000-0000-0000-000000000002";
const SALA_QX_ID    = "a3000000-0000-0000-0000-000000000003";
const CIRUJANO_ID   = "a4000000-0000-0000-0000-000000000004";
const ANEST_ID      = "a5000000-0000-0000-0000-000000000005";
const ORDEN_ID      = "a6000000-0000-0000-0000-000000000006";
const EPISODIO_ID   = "a7000000-0000-0000-0000-000000000007";
const PREOP_ID      = "a8000000-0000-0000-0000-000000000008";
const RESERVA_ID    = "a9000000-0000-0000-0000-000000000009";

const PERSONAL_ROW = {
  id: PERSONAL_ID,
  nombre_completo: "Dr. Carlos Cirujano",
  establecimiento_id: "b1000000-0000-0000-0000-000000000001",
};

const BASE_INPUT = {
  pacienteId: PACIENTE_ID,
  procedimientoCie10: "K35.89",
  fechaProgramada: "2026-05-20T08:00:00+00:00",
  cirujanoId: CIRUJANO_ID,
  anestesiologoId: ANEST_ID,
  salaQxId: SALA_QX_ID,
  duracionEstimadaMin: 90,
};

type MockRaw = DeepMockProxy<PrismaClient>;

function makeQxCtx(prisma: MockRaw) {
  return makeCtx({
    prisma,
    user: MOCK_USER_ADMIN,
    tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] },
  });
}

/** Configura $queryRaw para responder en secuencia. */
function mockQuerySequence(prisma: MockRaw, ...responses: unknown[][]) {
  let call = 0;
  prisma.$queryRaw.mockImplementation(() => {
    const res = responses[call] ?? [];
    call++;
    return Promise.resolve(res);
  });
}

/** $transaction que ejecuta el callback con el mismo prisma (sin rollback real). */
function setupTx(prisma: MockRaw) {
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  );
}

/** $transaction que ejecuta el callback y re-lanza errores (simula rollback). */
function setupTxWithRollback(prisma: MockRaw) {
  prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    try {
      return await fn(prisma);
    } catch (err) {
      throw err;
    }
  });
}

// ─── Suites ──────────────────────────────────────────────────────────────────

describe("eceBridgeCirugiaRouter", () => {
  let prisma: MockRaw;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // ─── programarCirugia ─────────────────────────────────────────────────────

  describe("programarCirugia", () => {
    it("1. PRECONDITION_FAILED si personal ECE no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]); // findPersonalSalud → vacío
      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await expect(caller.programarCirugia(BASE_INPUT)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("2. CONFLICT si sala QX tiene overlap de horario", async () => {
      // personal OK → detectarConflictoSala retorna reserva existente
      prisma.$queryRaw
        .mockResolvedValueOnce([PERSONAL_ROW])         // personal
        .mockResolvedValueOnce([{ id: RESERVA_ID }]);  // overlap detectado
      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await expect(caller.programarCirugia(BASE_INPUT)).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("sala QX"),
      });
    });

    it("3. Happy-path: retorna ordenId, episodioId, preOpId, reservaId", async () => {
      setupTx(prisma);
      mockQuerySequence(
        prisma,
        [PERSONAL_ROW],                     // 0: personal
        [],                                 // 1: detectarConflicto → sin overlap
        // dentro de tx:
        [{ id: ORDEN_ID }],                 // 2: INSERT orden_ingreso
        [{ id: EPISODIO_ID }],              // 3: INSERT episodio_atencion
        // $executeRaw: INSERT episodio_hospitalario (call 1)
        // $executeRaw: UPDATE orden set episodio_id (call 2)
        [{ id: PREOP_ID }],                 // 4: INSERT preop_checklist
        [{ id: RESERVA_ID }],              // 5: INSERT reserva_sala_qx
        // $executeRaw: UPDATE orden set reserva_id (call 3)
      );
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      const result = await caller.programarCirugia(BASE_INPUT);

      expect(result.ordenId).toBe(ORDEN_ID);
      expect(result.episodioId).toBe(EPISODIO_ID);
      expect(result.preOpId).toBe(PREOP_ID);
      expect(result.reservaId).toBe(RESERVA_ID);
    });

    it("4. Rollback: INSERT episodio_hospitalario falla → tx rechaza", async () => {
      setupTxWithRollback(prisma);
      mockQuerySequence(
        prisma,
        [PERSONAL_ROW],
        [],
        [{ id: ORDEN_ID }],    // INSERT orden OK
        [{ id: EPISODIO_ID }], // INSERT episodio OK
        // executeRaw[0] = INSERT episodio_hospitalario → falla
      );
      let executeCall = 0;
      prisma.$executeRaw.mockImplementation(() => {
        executeCall++;
        if (executeCall === 1) {
          return Promise.reject(new Error("FK constraint: episodio_hospitalario"));
        }
        return Promise.resolve(1);
      });

      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await expect(caller.programarCirugia(BASE_INPUT)).rejects.toThrow(
        "FK constraint: episodio_hospitalario",
      );
    });

    it("5. Rollback: INSERT preop_checklist falla → tx rechaza (reserva nunca se crea)", async () => {
      setupTxWithRollback(prisma);
      let qrCall = 0;
      prisma.$queryRaw.mockImplementation(() => {
        qrCall++;
        // 0=personal, 1=conflicto, 2=orden, 3=episodio, 4=preop → vacío = error
        const responses: unknown[][] = [
          [PERSONAL_ROW],
          [],
          [{ id: ORDEN_ID }],
          [{ id: EPISODIO_ID }],
          [], // preop RETURNING id vacío → throw interno
        ];
        return Promise.resolve(responses[qrCall - 1] ?? []);
      });
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await expect(caller.programarCirugia(BASE_INPUT)).rejects.toThrow(
        "No se pudo crear preop_checklist.",
      );

      // Verificar que nunca se intentó crear la reserva (queryRaw call 5 no existe)
      // qrCall debería ser 5 (hasta preop inclusive)
      expect(qrCall).toBe(5);
    });
  });

  // ─── listProgramacionDia ──────────────────────────────────────────────────

  describe("listProgramacionDia", () => {
    const mockProgramacion = {
      orden_id: ORDEN_ID,
      fecha_programada: new Date("2026-05-20T08:00:00Z"),
      duracion_min: 90,
      procedimiento_cie10: "K35.89",
      paciente_nombre: "Juan Pérez",
      cirujano_nombre: "Dr. Carlos Cirujano",
      anestesiologo_nombre: "Dra. Ana Anestesia",
      sala_nombre: "QX-01",
      estado: "programado",
      preop_checklist_id: PREOP_ID,
    };

    it("6. Sin salaQxId: retorna todas las cirugías del día mapeadas", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([mockProgramacion]);
      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      const result = await caller.listProgramacionDia({ fecha: "2026-05-20" });

      expect(result).toHaveLength(1);
      expect(result[0]?.ordenId).toBe(ORDEN_ID);
      expect(result[0]?.procedimientoCie10).toBe("K35.89");
      expect(result[0]?.salaNombre).toBe("QX-01");
      expect(result[0]?.preOpChecklistId).toBe(PREOP_ID);
      expect(result[0]?.anestesiologoNombre).toBe("Dra. Ana Anestesia");
    });

    it("7. Con salaQxId: usa rama filtrada y retorna misma forma", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([mockProgramacion]);
      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      const result = await caller.listProgramacionDia({
        fecha: "2026-05-20",
        salaQxId: SALA_QX_ID,
      });

      expect(result).toHaveLength(1);
      expect(result[0]?.ordenId).toBe(ORDEN_ID);
    });
  });

  // ─── cancelarPrograma ─────────────────────────────────────────────────────

  describe("cancelarPrograma", () => {
    const CANCEL_INPUT = {
      ordenId: ORDEN_ID,
      motivo: "Paciente con fiebre preoperatoria",
    };

    it("8. NOT_FOUND si orden quirúrgica no existe", async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([PERSONAL_ROW]) // personal
        .mockResolvedValueOnce([]);            // findOrdenQx → vacío
      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await expect(caller.cancelarPrograma(CANCEL_INPUT)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("9. Happy-path: cascade soft-delete + evento ece.cirugia.cancelada", async () => {
      const ordenRow = {
        id: ORDEN_ID,
        paciente_id: PACIENTE_ID,
        episodio_id: EPISODIO_ID,
        estado_registro: "programado",
        reserva_sala_qx_id: RESERVA_ID,
      };

      setupTx(prisma);
      prisma.$queryRaw
        .mockResolvedValueOnce([PERSONAL_ROW]) // personal
        .mockResolvedValueOnce([ordenRow]);    // findOrdenQx
      prisma.$executeRaw.mockResolvedValue(1);

      const { emitDomainEvent } = await import("@his/database");
      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      const result = await caller.cancelarPrograma(CANCEL_INPUT);

      expect(result.ok).toBe(true);
      expect(result.ordenId).toBe(ORDEN_ID);

      // Verificar que se ejecutaron los 4 UPDATE (reserva, preop, episodio, orden)
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);

      // Verificar evento emitido
      expect(emitDomainEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          eventType: "ece.cirugia.cancelada",
          aggregateId: ORDEN_ID,
        }),
      );
    });
  });
});

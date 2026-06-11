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
const PERSONAL_ID       = "a1000000-0000-0000-0000-000000000001";
const PACIENTE_ID       = "a2000000-0000-0000-0000-000000000002";
const SALA_QX_ID        = "a3000000-0000-0000-0000-000000000003";
const CIRUJANO_ID       = "a4000000-0000-0000-0000-000000000004";
const ANEST_ID          = "a5000000-0000-0000-0000-000000000005";
const ORDEN_ID          = "a6000000-0000-0000-0000-000000000006";
const EPISODIO_ID       = "a7000000-0000-0000-0000-000000000007";
const PREOP_ID          = "a8000000-0000-0000-0000-000000000008";
const RESERVA_ID        = "a9000000-0000-0000-0000-000000000009";
const INSTANCIA_ID      = "b1000000-0000-0000-0000-000000000001";
const TIPO_DOC_ID       = "b2000000-0000-0000-0000-000000000002";
const ESTADO_INICIAL_ID = "b3000000-0000-0000-0000-000000000003";
// Instancia-first de la orden (ORD_ING) — Paso 1a/1b
const ORD_TIPO_ID       = "c1000000-0000-0000-0000-000000000001";
const ORD_ESTADO_ID     = "c2000000-0000-0000-0000-000000000002";
const ORD_INSTANCIA_ID  = "c3000000-0000-0000-0000-000000000003";

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
      // Paso 5 ahora hace 3 queries extra (HE-11 fix):
      //   5a: SELECT tipo_doc_id + estado_inicial_id de PREOP_CHECK
      //   5b: INSERT documento_instancia → instancia_id
      //   5c: INSERT preop_checklist con instancia_id + episodio_hospitalario_id
      setupTx(prisma);
      mockQuerySequence(
        prisma,
        [PERSONAL_ROW],                                              // 0: personal
        [],                                                          // 1: detectarConflicto → sin overlap
        // dentro de tx:
        [{ tipo_doc_id: ORD_TIPO_ID, estado_inicial_id: ORD_ESTADO_ID }], // 2: SELECT ORD_ING tipo
        [{ id: ORD_INSTANCIA_ID }],                                  // 3: INSERT documento_instancia (orden)
        [{ id: ORDEN_ID }],                                          // 4: INSERT orden_ingreso
        [{ id: EPISODIO_ID }],                                       // 5: INSERT episodio_atencion
        // $executeRaw[0]: INSERT episodio_hospitalario
        // $executeRaw[1]: UPDATE orden set episodio_id
        [{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INICIAL_ID }], // 6: SELECT PREOP_CHECK
        [{ id: INSTANCIA_ID }],                                      // 7: INSERT documento_instancia (preop)
        [{ id: PREOP_ID }],                                          // 8: INSERT preop_checklist
        [{ id: RESERVA_ID }],                                        // 9: INSERT reserva_sala_qx
        // $executeRaw[2]: UPDATE orden set reserva_id
      );
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      const result = await caller.programarCirugia(BASE_INPUT);

      expect(result.ordenId).toBe(ORDEN_ID);
      expect(result.episodioId).toBe(EPISODIO_ID);
      expect(result.preOpId).toBe(PREOP_ID);
      expect(result.reservaId).toBe(RESERVA_ID);
    });

    it("3b. HE-11/13: documento_instancia.episodio_id recibe el episodio_atencion.id (no hospitalario)", async () => {
      // Verifica que el INSTANCIA INSERT usa episodioId (el de episodio_atencion)
      // como episodio_id en documento_instancia, lo cual es correcto según el schema:
      // episodio_hospitalario.episodio_id FK → episodio_atencion.id
      // documento_instancia.episodio_id FK → episodio_atencion.id
      const capturedCalls: unknown[][] = [];
      setupTx(prisma);
      let qrCall = 0;
      prisma.$queryRaw.mockImplementation((...args) => {
        capturedCalls.push(args as unknown[]);
        qrCall++;
        const responses: unknown[][] = [
          [PERSONAL_ROW],
          [],
          [{ tipo_doc_id: ORD_TIPO_ID, estado_inicial_id: ORD_ESTADO_ID }],
          [{ id: ORD_INSTANCIA_ID }],
          [{ id: ORDEN_ID }],
          [{ id: EPISODIO_ID }],
          [{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INICIAL_ID }],
          [{ id: INSTANCIA_ID }],
          [{ id: PREOP_ID }],
          [{ id: RESERVA_ID }],
        ];
        return Promise.resolve(responses[qrCall - 1] ?? []);
      });
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await caller.programarCirugia(BASE_INPUT);

      // 10 llamadas $queryRaw totales: personal, conflicto, ORD_ING tipo,
      // orden instancia, orden, episodio, PREOP tipo, preop instancia, preop, reserva
      expect(qrCall).toBe(10);
    });

    it("4. Rollback: INSERT episodio_hospitalario falla → tx rechaza", async () => {
      setupTxWithRollback(prisma);
      mockQuerySequence(
        prisma,
        [PERSONAL_ROW],
        [],
        [{ tipo_doc_id: ORD_TIPO_ID, estado_inicial_id: ORD_ESTADO_ID }], // ORD_ING tipo
        [{ id: ORD_INSTANCIA_ID }],                                       // orden instancia
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
      // Flujo: orden instancia-first (ORD_ING) → episodio → preop instancia-first:
      //   5a: SELECT PREOP_CHECK tipo OK
      //   5b: INSERT documento_instancia (preop) OK
      //   5c: INSERT preop_checklist → vacío → throw
      setupTxWithRollback(prisma);
      let qrCall = 0;
      prisma.$queryRaw.mockImplementation(() => {
        qrCall++;
        const responses: unknown[][] = [
          [PERSONAL_ROW],                                                      // 1: personal
          [],                                                                   // 2: conflicto → sin overlap
          [{ tipo_doc_id: ORD_TIPO_ID, estado_inicial_id: ORD_ESTADO_ID }],     // 3: ORD_ING tipo
          [{ id: ORD_INSTANCIA_ID }],                                           // 4: INSERT orden instancia
          [{ id: ORDEN_ID }],                                                   // 5: INSERT orden
          [{ id: EPISODIO_ID }],                                                // 6: INSERT episodio
          [{ tipo_doc_id: TIPO_DOC_ID, estado_inicial_id: ESTADO_INICIAL_ID }], // 7: tipo_doc PREOP_CHECK
          [{ id: INSTANCIA_ID }],                                               // 8: INSERT documento_instancia (preop)
          [], // 9: INSERT preop_checklist RETURNING → vacío → throw
        ];
        return Promise.resolve(responses[qrCall - 1] ?? []);
      });
      prisma.$executeRaw.mockResolvedValue(1);

      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await expect(caller.programarCirugia(BASE_INPUT)).rejects.toThrow(
        "No se pudo crear preop_checklist.",
      );

      // 9 llamadas: personal, conflicto, ORD_ING tipo, orden instancia, orden,
      // episodio, PREOP tipo, preop instancia, preop. La reserva (call 10) nunca se ejecutó.
      expect(qrCall).toBe(9);
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

    it("10. (HJ-QX-001) JOIN preop_checklist usa episodio_hospitalario_id, no orden_id", async () => {
      // Regresión del schema drift: ece.preop_checklist no tiene columna
      // orden_id (PG 42703). El test 7 mockea el SQL sin inspeccionarlo, por eso
      // no atrapaba el bug. Aquí capturamos el template del $queryRaw y verificamos
      // el JOIN real en AMBAS ramas (else y filtrada por sala).
      const sqls: string[] = [];
      prisma.$queryRaw.mockImplementation((...args: unknown[]) => {
        const strings = args[0] as TemplateStringsArray;
        sqls.push(Array.from(strings).join(" ? "));
        return Promise.resolve([mockProgramacion]);
      });

      const caller = eceBridgeCirugiaRouter.createCaller(makeQxCtx(prisma));
      await caller.listProgramacionDia({ fecha: "2026-05-20" });                       // rama else
      await caller.listProgramacionDia({ fecha: "2026-05-20", salaQxId: SALA_QX_ID }); // rama salaQxId

      expect(sqls).toHaveLength(2);
      for (const sql of sqls) {
        expect(sql).toContain("pc.episodio_hospitalario_id = r.episodio_id");
        expect(sql).not.toContain("pc.orden_id");
        // El nombre del paciente sale de public."Patient" (ece.paciente no tiene
        // columna de nombre) — evita el 42703 sobre pac.nombre_completo.
        expect(sql).toContain('public."Patient"');
        expect(sql).not.toContain("pac.nombre_completo");
      }

      // La rama filtrada por sala ya no usa el JOIN roto paciente↔episodio:
      // el paciente se resuelve por orden_ingreso → pac (igual que la rama else).
      const salaSql = sqls[1]!;
      expect(salaSql).not.toContain("p.id = r.episodio_id");
      expect(salaSql).toContain("pac.id = oi.paciente_id");
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
        reserva_sala_qx_id: RESERVA_ID,
        reserva_estado: "programado",
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

      // Cascade mínimo alineado al DDL: 2 UPDATE (reserva + episodio). Ya NO se
      // escribe estado_registro='cancelado' en preop/orden (CHECK vigente/rectificado).
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);

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

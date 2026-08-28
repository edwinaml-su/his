/**
 * Tests de workflowPublicacionRouter.rollback — hallazgo 2026-08-28.
 *
 * El rollback anterior solo escribía en ece.workflow_publicacion_audit
 * (registro de auditoría) sin tocar el motor de ejecución
 * (ece.flujo_estado / ece.flujo_transicion), así que "Restaurar" no
 * restauraba nada operativo. Estos tests cubren el fix:
 *
 *  1. rollback feliz — aplica el snapshot objetivo al motor de ejecución
 *     (upsert de estados/transiciones del snapshot, DELETE de los que
 *     sobran) y deja constancia en el audit trail.
 *  2. rollback rechazado — si algún estado que el snapshot objetivo
 *     elimina tiene documento_instancia vivas apuntándolo, aborta con
 *     PRECONDITION_FAILED SIN ejecutar ninguna escritura (verificado con
 *     $executeRaw.not.toHaveBeenCalled()).
 *
 * Mocking: mockDeep<PrismaClient> + $transaction pass-through (mismo
 * patrón que packages/trpc/src/routers/__tests__/accounting.test.ts).
 * $queryRaw se secuencia con mockResolvedValueOnce en el orden exacto en
 * que el router los invoca; $executeRaw no necesita valor de retorno.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowPublicacionRouter } from "../workflow-publicacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const TIPO_DOC_ID = "20000000-0000-0000-0000-000000000001";
const TARGET_VERSION_ROW_ID = "20000000-0000-0000-0000-000000000002";
const ESTADO_INICIAL_ID = "20000000-0000-0000-0000-000000000010";
const ESTADO_FINAL_ID = "20000000-0000-0000-0000-000000000011";
const ESTADO_EXTRA_ID = "20000000-0000-0000-0000-000000000012"; // solo en vivo, no en el snapshot objetivo
const TRANSICION_FIRMAR_ID = "20000000-0000-0000-0000-000000000020";
const TRANSICION_EXTRA_ID = "20000000-0000-0000-0000-000000000021"; // solo en vivo
const ROL_MC_ID = "20000000-0000-0000-0000-000000000030";

const DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR"] };

// Snapshot objetivo (versión HISTORICO a restaurar): 2 estados, 1 transición.
const TARGET_SNAPSHOT = {
  nodes: [
    {
      id: ESTADO_INICIAL_ID,
      nombre: "Borrador",
      codigo: "borrador",
      es_inicial: true,
      es_final: false,
      orden: 1,
    },
    {
      id: ESTADO_FINAL_ID,
      nombre: "Firmado",
      codigo: "firmado",
      es_inicial: false,
      es_final: true,
      orden: 2,
    },
  ],
  edges: [
    {
      id: TRANSICION_FIRMAR_ID,
      source: ESTADO_INICIAL_ID,
      target: ESTADO_FINAL_ID,
      accion: "firmar",
      rolCodigo: "MC",
      requiereFirma: true,
    },
  ],
};

function makeRollbackCaller(prisma: DeepMockProxy<PrismaClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$transaction as any).mockImplementation(async (cb: any) =>
    typeof cb === "function" ? cb(prisma) : cb,
  );
  return workflowPublicacionRouter.createCaller(makeCtx({ prisma, tenant: DIR_TENANT }));
}

describe("workflowPublicacionRouter.rollback — restaura el motor de ejecución", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // $executeRaw no se lee — cualquier statement del "aplicar snapshot"
    // (reset flags, upserts, deletes, update HISTORICO) resuelve OK.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$executeRaw as any).mockResolvedValue(0);
  });

  it("aplica snapshot: upsert de estados/transiciones del target + DELETE de los que sobran en vivo", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([
        { version: 2, estado: "HISTORICO", snapshot_jsonb: TARGET_SNAPSHOT },
      ]) // 1. target
      .mockResolvedValueOnce([
        { id: ESTADO_INICIAL_ID },
        { id: ESTADO_FINAL_ID },
        { id: ESTADO_EXTRA_ID },
      ]) // 2. liveEstados (E_EXTRA sobra)
      .mockResolvedValueOnce([{ id: TRANSICION_FIRMAR_ID }, { id: TRANSICION_EXTRA_ID }]) // 3. liveTransiciones (T_EXTRA sobra)
      .mockResolvedValueOnce([]) // 4. documento_instancia referenciando ESTADO_EXTRA_ID — ninguna
      .mockResolvedValueOnce([{ id: ROL_MC_ID, codigo: "MC" }]) // 5. ece.rol por código
      .mockResolvedValueOnce([{ next_version: 4 }]) // 6. next_workflow_version
      .mockResolvedValueOnce([{ chain_hash: "hash-v3" }]) // 7. último chain_hash
      .mockResolvedValueOnce([{ id: "20000000-0000-0000-0000-000000000099" }]); // 8. INSERT RETURNING id

    const caller = makeRollbackCaller(prisma);
    const result = await caller.rollback({
      tipDocumentoId: TIPO_DOC_ID,
      targetVersionId: TARGET_VERSION_ROW_ID,
      motivoCambio: "Revertir cambio erróneo de ayer.",
    });

    expect(result.version).toBe(4);
    expect(result.restoredFromVersion).toBe(2);
    expect(result.motorAplicado).toEqual({
      estadosAplicados: 2,
      transicionesAplicadas: 1,
      estadosEliminados: 1,
      transicionesEliminadas: 1,
    });

    // Se ejecutaron escrituras reales sobre el motor: reset flags + 2 upserts
    // de estado + 1 upsert de transición + DELETE transiciones + DELETE
    // estados + UPDATE HISTORICO = 7 $executeRaw.
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(7);

    // La transición/estado "extra" (solo en vivo) deben aparecer en algún
    // DELETE — verificamos que al menos un $executeRaw referenció el id.
    const executedSql = (prisma.$executeRaw as unknown as { mock: { calls: unknown[][] } }).mock
      .calls.map((call) => JSON.stringify(call));
    expect(executedSql.some((c) => c.includes(ESTADO_EXTRA_ID))).toBe(true);
    expect(executedSql.some((c) => c.includes(TRANSICION_EXTRA_ID))).toBe(true);
  });

  it("rechaza con instancias vivas en estados a eliminar — no ejecuta ninguna escritura", async () => {
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([
        { version: 2, estado: "HISTORICO", snapshot_jsonb: TARGET_SNAPSHOT },
      ]) // 1. target
      .mockResolvedValueOnce([
        { id: ESTADO_INICIAL_ID },
        { id: ESTADO_FINAL_ID },
        { id: ESTADO_EXTRA_ID },
      ]) // 2. liveEstados
      .mockResolvedValueOnce([{ id: TRANSICION_FIRMAR_ID }, { id: TRANSICION_EXTRA_ID }]) // 3. liveTransiciones
      .mockResolvedValueOnce([
        {
          estado_actual_id: ESTADO_EXTRA_ID,
          codigo: "intermedio",
          nombre: "Intermedio",
          total: 3n,
        },
      ]); // 4. documento_instancia CON referencias vivas al estado a eliminar

    const caller = makeRollbackCaller(prisma);

    await expect(
      caller.rollback({
        tipDocumentoId: TIPO_DOC_ID,
        targetVersionId: TARGET_VERSION_ROW_ID,
        motivoCambio: "Intento de rollback bloqueado.",
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: {
        totalInstancias: 3,
        estadosBloqueados: [
          expect.objectContaining({ estadoId: ESTADO_EXTRA_ID, codigo: "intermedio", instancias: 3 }),
        ],
      },
    });

    // Guardia de integridad: no debe haberse tocado nada del motor ni del
    // audit trail — el chequeo aborta ANTES de cualquier escritura.
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

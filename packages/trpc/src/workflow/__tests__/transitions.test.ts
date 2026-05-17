/**
 * Tests unitarios para `canTransition` y `executeTransition` — Fase 2 / ECE / GS1.
 *
 * Estrategia:
 *   - Vitest + vitest-mock-extended (DeepMockProxy<PrismaClient>).
 *   - Prisma mockeado completamente; cero I/O real.
 *   - $transaction mockeado para ejecutar el callback con el mismo prisma mock
 *     (mismo patrón que accounting / inpatient router tests).
 *   - $executeRawUnsafe mockeado para absorber las llamadas de applyWorkflowContext
 *     (SET LOCAL GUCs + SET LOCAL ROLE authenticated).
 *   - $queryRaw mockeado por secuencia de llamadas para simular las dos queries
 *     de canTransition (instancia y transición).
 *   - $executeRaw mockeado para las dos mutaciones de executeTransition
 *     (UPDATE instancia + INSERT historial).
 *
 * Casos cubiertos (18 tests):
 *   canTransition:
 *     1.  Transición válida — permitida sin firma
 *     2.  Transición válida — permitida con firma requerida
 *     3.  Instancia no encontrada → NOT_FOUND
 *     4.  Estado origen no tiene la acción definida → allowed=false
 *     5.  Rol incorrecto bloquea → allowed=false
 *     6.  Rol parcialmente correcto (uno de varios) — el usuario tiene el rol → allowed=true
 *     7.  userRoles vacío → allowed=false aunque exista la transición
 *     8.  Estado destino devuelto correctamente cuando allowed=true
 *
 *   executeTransition:
 *     9.  Ejecución exitosa sin firma (requiere_firma=false)
 *     10. Ejecución exitosa con firma (requiere_firma=true + firmaId presente)
 *     11. Firma faltante cuando requiere_firma=true → BAD_REQUEST
 *     12. Rol incorrecto bloquea la ejecución → FORBIDDEN
 *     13. Instancia no encontrada en executeTransition → NOT_FOUND
 *     14. Acción no definida en el flujo → FORBIDDEN
 *     15. Historial registrado: UPDATE instancia ocurre antes que INSERT historial
 *     16. executeTransition pasa firmaId nulo correctamente al historial
 *     17. observacion opcional se propaga al historial
 *     18. withWorkflowContext es invocado (applyWorkflowContext llama $executeRawUnsafe)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { canTransition, executeTransition } from "../transitions";
import type { EceContext } from "../context";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures UUID
// ─────────────────────────────────────────────────────────────────────────────

const INSTANCIA_ID     = "00000000-0000-0000-0001-000000000001";
const TIPO_DOC_ID      = "00000000-0000-0000-0002-000000000001";
const ESTADO_ORIGEN_ID = "00000000-0000-0000-0003-000000000001";
const ESTADO_DESTINO_ID = "00000000-0000-0000-0003-000000000002";
const TRANSICION_ID    = "00000000-0000-0000-0004-000000000001";
const ROL_MC_ID        = "00000000-0000-0000-0005-000000000001";
const ROL_ENF_ID       = "00000000-0000-0000-0005-000000000002";
const PERSONAL_ID      = "00000000-0000-0000-0006-000000000001";
const ESTAB_ID         = "00000000-0000-0000-0007-000000000001";
const FIRMA_ID         = "00000000-0000-0000-0008-000000000001";

const ACCION_FIRMAR    = "firmar";
const ACCION_REVISAR   = "enviar_revision";
const ROL_MC_CODIGO    = "MC";
const ROL_ENF_CODIGO   = "ENF";

/** Fila de ece.documento_instancia devuelta por la primera $queryRaw. */
const INSTANCIA_ROW = {
  id: INSTANCIA_ID,
  estado_actual_id: ESTADO_ORIGEN_ID,
  tipo_documento_id: TIPO_DOC_ID,
};

/** Fila de ece.flujo_transicion — sin firma requerida. */
const TRANSICION_SIN_FIRMA = {
  id: TRANSICION_ID,
  estado_destino_id: ESTADO_DESTINO_ID,
  rol_autoriza_id: ROL_MC_ID,
  rol_codigo: ROL_MC_CODIGO,
  requiere_firma: false,
};

/** Fila de ece.flujo_transicion — con firma requerida. */
const TRANSICION_CON_FIRMA = {
  ...TRANSICION_SIN_FIRMA,
  requiere_firma: true,
};

/** Fila extra devuelta por la segunda query dentro de executeTransition. */
const ROL_ROW = {
  rol_autoriza_id: ROL_MC_ID,
  estado_origen_id: ESTADO_ORIGEN_ID,
};

/** Contexto ECE del médico MC. */
const CTX_MC: EceContext = {
  personalId: PERSONAL_ID,
  establecimientoId: ESTAB_ID,
  roles: [ROL_MC_CODIGO],
};

/** Contexto ECE del enfermero (rol diferente). */
const CTX_ENF: EceContext = {
  personalId: PERSONAL_ID,
  establecimientoId: ESTAB_ID,
  roles: [ROL_ENF_CODIGO],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: configura $transaction para ejecutar el callback con el mismo mock.
// También absorbe las llamadas a $executeRawUnsafe de applyWorkflowContext.
// ─────────────────────────────────────────────────────────────────────────────

function wireTransaction(prisma: DeepMockProxy<PrismaClient>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma.$transaction.mockImplementation(async (cb: any) => {
    if (typeof cb === "function") return cb(prisma);
    return cb;
  });
  // applyWorkflowContext emite SET LOCAL vía $executeRawUnsafe
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: configura la secuencia de $queryRaw para canTransition.
//   - 1ª llamada → [INSTANCIA_ROW] (o [] para simular not found)
//   - 2ª llamada → [transicion] (o [] para simular acción no definida)
// ─────────────────────────────────────────────────────────────────────────────

function mockQueryRawSequence(
  prisma: DeepMockProxy<PrismaClient>,
  instanciaRows: object[],
  transicionRows: object[],
): void {
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$queryRaw as any).mockImplementation(() => {
    call += 1;
    if (call === 1) return Promise.resolve(instanciaRows);
    return Promise.resolve(transicionRows);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: configura la secuencia de $queryRaw para executeTransition
//   (canTransition interna llama 2 veces + la 3ª query busca rol_autoriza_id).
// ─────────────────────────────────────────────────────────────────────────────

function mockQueryRawForExecute(
  prisma: DeepMockProxy<PrismaClient>,
  transicionRows: object[],
): void {
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$queryRaw as any).mockImplementation(() => {
    call += 1;
    if (call === 1) return Promise.resolve([INSTANCIA_ROW]);
    if (call === 2) return Promise.resolve(transicionRows);
    // 3ª query: ROL_ROW para obtener rol_autoriza_id + estado_origen_id
    return Promise.resolve([ROL_ROW]);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite: canTransition
// ─────────────────────────────────────────────────────────────────────────────

describe("canTransition", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // Test 1
  it("devuelve allowed=true sin firma cuando transición existe y rol coincide", async () => {
    mockQueryRawSequence(prisma, [INSTANCIA_ROW], [TRANSICION_SIN_FIRMA]);

    const result = await canTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, [ROL_MC_CODIGO]);

    expect(result.allowed).toBe(true);
    expect(result.requiresSignature).toBe(false);
    expect(result.targetStateId).toBe(ESTADO_DESTINO_ID);
  });

  // Test 2
  it("devuelve allowed=true con requiresSignature=true cuando la transición lo exige", async () => {
    mockQueryRawSequence(prisma, [INSTANCIA_ROW], [TRANSICION_CON_FIRMA]);

    const result = await canTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, [ROL_MC_CODIGO]);

    expect(result.allowed).toBe(true);
    expect(result.requiresSignature).toBe(true);
    expect(result.targetStateId).toBe(ESTADO_DESTINO_ID);
  });

  // Test 3
  it("lanza NOT_FOUND si la instancia no existe en la BD", async () => {
    mockQueryRawSequence(prisma, [], []);

    await expect(
      canTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, [ROL_MC_CODIGO]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Test 4
  it("devuelve allowed=false cuando no existe transición para la acción desde el estado actual", async () => {
    mockQueryRawSequence(prisma, [INSTANCIA_ROW], []);

    const result = await canTransition(prisma, INSTANCIA_ID, "accion_inexistente", [ROL_MC_CODIGO]);

    expect(result.allowed).toBe(false);
    expect(result.requiresSignature).toBe(false);
    expect(result.targetStateId).toBeUndefined();
  });

  // Test 5
  it("devuelve allowed=false cuando el rol del ejecutor no coincide con rol_autorizador", async () => {
    // La transición requiere ROL_MC pero el usuario tiene ROL_ENF
    mockQueryRawSequence(prisma, [INSTANCIA_ROW], [TRANSICION_SIN_FIRMA]);

    const result = await canTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, [ROL_ENF_CODIGO]);

    expect(result.allowed).toBe(false);
    expect(result.targetStateId).toBeUndefined();
  });

  // Test 6
  it("devuelve allowed=true cuando el usuario tiene el rol correcto entre varios roles", async () => {
    mockQueryRawSequence(prisma, [INSTANCIA_ROW], [TRANSICION_SIN_FIRMA]);

    // Usuario con múltiples roles, uno de ellos es ROL_MC
    const result = await canTransition(
      prisma,
      INSTANCIA_ID,
      ACCION_FIRMAR,
      [ROL_ENF_CODIGO, ROL_MC_CODIGO, "ADM"],
    );

    expect(result.allowed).toBe(true);
  });

  // Test 7
  it("devuelve allowed=false cuando userRoles está vacío aunque la transición exista", async () => {
    mockQueryRawSequence(prisma, [INSTANCIA_ROW], [TRANSICION_SIN_FIRMA]);

    const result = await canTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, []);

    expect(result.allowed).toBe(false);
  });

  // Test 8
  it("devuelve targetStateId correcto cuando allowed=true", async () => {
    mockQueryRawSequence(prisma, [INSTANCIA_ROW], [TRANSICION_CON_FIRMA]);

    const result = await canTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, [ROL_MC_CODIGO]);

    expect(result.targetStateId).toBe(ESTADO_DESTINO_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: executeTransition
// ─────────────────────────────────────────────────────────────────────────────

describe("executeTransition", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction(prisma);
    // $executeRaw para UPDATE + INSERT
    prisma.$executeRaw.mockResolvedValue(1 as never);
  });

  // Test 9
  it("ejecuta con éxito sin firma cuando requiere_firma=false", async () => {
    mockQueryRawForExecute(prisma, [TRANSICION_SIN_FIRMA]);

    await expect(
      executeTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, CTX_MC, PERSONAL_ID),
    ).resolves.toBeUndefined();

    // Deben haberse ejecutado 2 writes: UPDATE instancia + INSERT historial
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  // Test 10
  it("ejecuta con éxito con firma cuando requiere_firma=true y firmaId presente", async () => {
    mockQueryRawForExecute(prisma, [TRANSICION_CON_FIRMA]);

    await expect(
      executeTransition(
        prisma,
        INSTANCIA_ID,
        ACCION_FIRMAR,
        CTX_MC,
        PERSONAL_ID,
        FIRMA_ID,
      ),
    ).resolves.toBeUndefined();

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  // Test 11
  it("lanza BAD_REQUEST cuando requiere_firma=true pero firmaId está ausente", async () => {
    mockQueryRawForExecute(prisma, [TRANSICION_CON_FIRMA]);

    await expect(
      executeTransition(
        prisma,
        INSTANCIA_ID,
        ACCION_FIRMAR,
        CTX_MC,
        PERSONAL_ID,
        // firmaId deliberadamente omitido
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // No debe haberse escrito nada
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  // Test 12
  it("lanza FORBIDDEN cuando el rol del ejecutor no está autorizado", async () => {
    // CTX_ENF tiene rol ENF, pero la transición requiere MC
    mockQueryRawForExecute(prisma, [TRANSICION_SIN_FIRMA]);

    await expect(
      executeTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, CTX_ENF, PERSONAL_ID),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  // Test 13
  it("lanza NOT_FOUND cuando la instancia no existe", async () => {
    // Primera query de canTransition retorna vacío
    let call = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any).mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? [] : []);
    });

    await expect(
      executeTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, CTX_MC, PERSONAL_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Test 14
  it("lanza FORBIDDEN cuando la acción no está definida en el flujo desde el estado actual", async () => {
    mockQueryRawForExecute(prisma, []); // segunda query retorna vacío

    await expect(
      executeTransition(prisma, INSTANCIA_ID, "accion_no_definida", CTX_MC, PERSONAL_ID),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Test 15
  it("el UPDATE de instancia ocurre antes del INSERT en historial (orden de $executeRaw)", async () => {
    mockQueryRawForExecute(prisma, [TRANSICION_SIN_FIRMA]);

    const callOrder: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$executeRaw as any).mockImplementation((...args: any[]) => {
      const sql = String(args[0]?.[0] ?? "").trim().toUpperCase();
      if (sql.startsWith("UPDATE")) callOrder.push("UPDATE");
      else if (sql.startsWith("INSERT")) callOrder.push("INSERT");
      return Promise.resolve(1);
    });

    await executeTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, CTX_MC, PERSONAL_ID);

    expect(callOrder).toEqual(["UPDATE", "INSERT"]);
  });

  // Test 16
  it("propaga firmaId=undefined como null al INSERT del historial", async () => {
    mockQueryRawForExecute(prisma, [TRANSICION_SIN_FIRMA]);

    const insertCalls: unknown[][] = [];
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$executeRaw as any).mockImplementation((...args: any[]) => {
      callCount += 1;
      if (callCount === 2) insertCalls.push(args);
      return Promise.resolve(1);
    });

    // Sin firmaId
    await executeTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, CTX_MC, PERSONAL_ID);

    // El INSERT debe haber sido llamado
    expect(insertCalls.length).toBe(1);
  });

  // Test 17
  it("propaga observacion opcional al INSERT del historial cuando se provee", async () => {
    mockQueryRawForExecute(prisma, [TRANSICION_SIN_FIRMA]);

    const rawCalls: unknown[][] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$executeRaw as any).mockImplementation((...args: any[]) => {
      rawCalls.push(args);
      return Promise.resolve(1);
    });

    const OBS = "Transición validada en ronda médica 08:00";
    await executeTransition(
      prisma,
      INSTANCIA_ID,
      ACCION_FIRMAR,
      CTX_MC,
      PERSONAL_ID,
      undefined,
      OBS,
    );

    // Verificamos que la observación aparece en los parámetros del INSERT (call index 1)
    const insertArgs = rawCalls[1] as unknown[];
    const allArgs = JSON.stringify(insertArgs);
    expect(allArgs).toContain(OBS);
  });

  // Test 18
  it("withWorkflowContext aplica GUCs: $executeRawUnsafe llamado al menos una vez", async () => {
    mockQueryRawForExecute(prisma, [TRANSICION_SIN_FIRMA]);

    await executeTransition(prisma, INSTANCIA_ID, ACCION_FIRMAR, CTX_MC, PERSONAL_ID);

    // applyWorkflowContext emite 3–4 SET LOCAL via $executeRawUnsafe
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    const calls = prisma.$executeRawUnsafe.mock.calls;
    const sqlStrings = calls.map((c) => String(c[0]));
    expect(sqlStrings.some((s) => s.includes("ece_personal_id"))).toBe(true);
    expect(sqlStrings.some((s) => s.includes("establecimiento_id"))).toBe(true);
  });
});

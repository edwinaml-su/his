/**
 * Tests del procedure workflow.instance.proximosDocumentos (Fase 5 — wizard).
 *
 * Estrategia:
 *   - El procedure ejecuta DOS $queryRaw secuenciales dentro de withWorkflowContext:
 *       1) lookup del episodio (paciente_id, modalidad)
 *       2) tipos aplicables + instancia más reciente (LATERAL JOIN)
 *   - Mockeamos $transaction para pasar el mismo prisma como tx (igual que
 *     `workflow-instance.router.test.ts`) y $queryRaw con respuestas en orden.
 *   - Cada it() configura su propio set de mocks; no se reusa entre tests.
 *
 * Cubre clasificación FIRMADO / EN_PROGRESO / LISTO / BLOQUEADO, NOT_FOUND
 * cuando no existe episodio, lista vacía, orden, y conteos del resumen.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowInstanceRouter } from "../workflow-instance.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Mocks colaterales ────────────────────────────────────────────────────────
// workflow-instance.router importa estos módulos; los mockeamos para
// no interferir con otros procedures aunque proximosDocumentos no los use.
vi.mock("../../workflow/transitions", () => ({
  canTransition: vi.fn(),
  executeTransition: vi.fn(),
}));

vi.mock("@his/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@his/database")>();
  return {
    ...original,
    emitDomainEvent: vi.fn().mockResolvedValue({ id: "event-id" }),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EPISODIO_ID = "33333333-3333-3333-3333-333333333333";
const PACIENTE_ID = "44444444-4444-4444-4444-444444444444";

const ECE_TENANT = {
  ...MOCK_TENANT,
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["MC", "DIR"],
};

/** Respuesta estándar del primer $queryRaw (lookup del episodio). */
const EPISODIO_OK = [{ paciente_id: PACIENTE_ID, modalidad: "hospitalario" }];

/** Forma de TipoConEstadoRow (idéntica a la del router). */
type TipoConEstadoRow = {
  tipo_id: string;
  codigo: string;
  nombre: string;
  modalidad: string;
  tipo_registro: string;
  inmutable: boolean;
  depende_de: string[] | null;
  modulo_his_target: string | null;
  instancia_id: string | null;
  estado_codigo: string | null;
  estado_es_final: boolean | null;
};

/** Construye una fila de tipo_documento con sus instance/state campos. */
function buildTipoRow(overrides: Partial<TipoConEstadoRow> = {}): TipoConEstadoRow {
  return {
    tipo_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    codigo: "TIPO_DEFAULT",
    nombre: "Tipo default",
    modalidad: "hospitalario",
    tipo_registro: "clinico",
    inmutable: false,
    depende_de: null,
    modulo_his_target: null,
    instancia_id: null,
    estado_codigo: null,
    estado_es_final: null,
    ...overrides,
  };
}

// ─── Helper de Prisma con $transaction patched ────────────────────────────────

function makeEcePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  // withWorkflowContext abre $transaction(cb); pasamos prisma como tx.
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  // GUC setup (SET LOCAL …) ejecutado por applyWorkflowContext.
  prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("workflowInstanceRouter.proximosDocumentos", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makeEcePrisma();
    vi.clearAllMocks();
  });

  it("lanza NOT_FOUND cuando el episodio no existe", async () => {
    // El primer $queryRaw devuelve [] → episodio no encontrado.
    prisma.$queryRaw.mockResolvedValueOnce([] as never);

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );

    await expect(
      caller.proximosDocumentos({ episodioId: EPISODIO_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("retorna items=[] y resumen en cero cuando ningún tipo aplica a la modalidad", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce(EPISODIO_OK as never)
      .mockResolvedValueOnce([] as never); // ningún tipo aplicable

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );
    const result = await caller.proximosDocumentos({ episodioId: EPISODIO_ID });

    expect(result.items).toEqual([]);
    expect(result.resumen).toEqual({
      firmados: 0,
      enProgreso: 0,
      listos: 0,
      bloqueados: 0,
      total: 0,
    });
    expect(result.modalidad).toBe("hospitalario");
    expect(result.pacienteId).toBe(PACIENTE_ID);
  });

  it("clasifica como LISTO un tipo sin instancia cuyas dependencias están firmadas", async () => {
    // FICHA_ID firmado + HIST_CLIN sin instancia y depende_de:['FICHA_ID'] → LISTO.
    const tipos = [
      buildTipoRow({
        codigo: "FICHA_ID",
        instancia_id: "inst-1",
        estado_codigo: "firmado",
        estado_es_final: false,
      }),
      buildTipoRow({
        codigo: "HIST_CLIN",
        depende_de: ["FICHA_ID"],
      }),
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce(EPISODIO_OK as never)
      .mockResolvedValueOnce(tipos as never);

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );
    const result = await caller.proximosDocumentos({ episodioId: EPISODIO_ID });

    const histClin = result.items.find((i) => i.codigo === "HIST_CLIN")!;
    expect(histClin.estado).toBe("LISTO");
    expect(histClin.dependenciasFaltantes).toEqual([]);
  });

  it("clasifica como BLOQUEADO un tipo cuya dependencia falta firmar", async () => {
    // EVOL_MED depende de HOJA_ING que no existe en el set firmado.
    const tipos = [
      buildTipoRow({
        codigo: "EVOL_MED",
        depende_de: ["HOJA_ING"],
      }),
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce(EPISODIO_OK as never)
      .mockResolvedValueOnce(tipos as never);

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );
    const result = await caller.proximosDocumentos({ episodioId: EPISODIO_ID });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.estado).toBe("BLOQUEADO");
    expect(result.items[0]!.dependenciasFaltantes).toEqual(["HOJA_ING"]);
  });

  it("clasifica como FIRMADO una instancia con estado terminal (es_final=true)", async () => {
    const tipos = [
      buildTipoRow({
        codigo: "EPICRISIS",
        instancia_id: "inst-final",
        estado_codigo: "completado",
        estado_es_final: true,
      }),
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce(EPISODIO_OK as never)
      .mockResolvedValueOnce(tipos as never);

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );
    const result = await caller.proximosDocumentos({ episodioId: EPISODIO_ID });

    expect(result.items[0]!.estado).toBe("FIRMADO");
    expect(result.items[0]!.instanciaId).toBe("inst-final");
  });

  it("clasifica como EN_PROGRESO una instancia en borrador (no terminal)", async () => {
    const tipos = [
      buildTipoRow({
        codigo: "HIST_CLIN",
        instancia_id: "inst-draft",
        estado_codigo: "borrador",
        estado_es_final: false,
      }),
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce(EPISODIO_OK as never)
      .mockResolvedValueOnce(tipos as never);

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );
    const result = await caller.proximosDocumentos({ episodioId: EPISODIO_ID });

    expect(result.items[0]!.estado).toBe("EN_PROGRESO");
    expect(result.items[0]!.estadoActual).toBe("borrador");
  });

  it("ordena LISTO → EN_PROGRESO → BLOQUEADO → FIRMADO", async () => {
    // Mezcla deliberada: 1 firmado prereq + 1 listo + 1 en_progreso + 1
    // bloqueado + 1 firmado terminal.
    const tipos = [
      // Firmado prereq de "LISTO_X" (no aparece como el primer item ordenado
      // porque estado=FIRMADO).
      buildTipoRow({
        codigo: "PREREQ_A",
        instancia_id: "inst-a",
        estado_codigo: "validado",
        estado_es_final: false,
      }),
      buildTipoRow({ codigo: "LISTO_X", depende_de: ["PREREQ_A"] }),
      buildTipoRow({
        codigo: "EN_PROGRESO_Y",
        instancia_id: "inst-y",
        estado_codigo: "borrador",
        estado_es_final: false,
      }),
      buildTipoRow({ codigo: "BLOQUEADO_Z", depende_de: ["MISSING"] }),
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce(EPISODIO_OK as never)
      .mockResolvedValueOnce(tipos as never);

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );
    const result = await caller.proximosDocumentos({ episodioId: EPISODIO_ID });

    const estados = result.items.map((i) => i.estado);
    // Orden esperado: LISTO(0) < EN_PROGRESO(1) < BLOQUEADO(2) < FIRMADO(3).
    expect(estados).toEqual(["LISTO", "EN_PROGRESO", "BLOQUEADO", "FIRMADO"]);
  });

  it("calcula correctamente los contadores del resumen", async () => {
    const tipos = [
      buildTipoRow({
        codigo: "PREREQ_A",
        instancia_id: "i1",
        estado_codigo: "firmado",
        estado_es_final: false,
      }),
      buildTipoRow({ codigo: "LISTO_B", depende_de: ["PREREQ_A"] }),
      buildTipoRow({ codigo: "LISTO_C" }), // sin deps → LISTO
      buildTipoRow({
        codigo: "EN_PROGRESO_D",
        instancia_id: "i2",
        estado_codigo: "borrador",
        estado_es_final: false,
      }),
      buildTipoRow({ codigo: "BLOQUEADO_E", depende_de: ["MISSING"] }),
    ];
    prisma.$queryRaw
      .mockResolvedValueOnce(EPISODIO_OK as never)
      .mockResolvedValueOnce(tipos as never);

    const caller = workflowInstanceRouter.createCaller(
      makeCtx({ prisma, tenant: ECE_TENANT }),
    );
    const result = await caller.proximosDocumentos({ episodioId: EPISODIO_ID });

    expect(result.resumen).toEqual({
      firmados: 1, // PREREQ_A
      enProgreso: 1, // EN_PROGRESO_D
      listos: 2, // LISTO_B + LISTO_C
      bloqueados: 1, // BLOQUEADO_E
      total: 5,
    });
  });
});

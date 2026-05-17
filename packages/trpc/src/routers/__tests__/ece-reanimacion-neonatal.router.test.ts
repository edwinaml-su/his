/**
 * Tests del router eceReanimacionNeonatal (NRP AHA/AAP).
 *
 * Cubre:
 *  1. list — retorna items y total desde raw SQL mock.
 *  2. get — NOT_FOUND cuando no hay filas.
 *  3. crear — BAD_REQUEST si no hay establecimientoId en tenant.
 *  4. registrarPaso — CONFLICT si cerrado_en IS NOT NULL (ya cerrado).
 *  5. registrarPaso — NOT_FOUND cuando el registro no existe.
 *  6. cerrar — NOT_FOUND cuando el registro no existe.
 *  7. cerrar — CONFLICT si ya está cerrado (cerrado_en IS NOT NULL).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceReanimacionNeonatalRouter } from "../ece/reanimacion-neonatal.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const NRP_ID       = "aaaaaaaa-0000-0000-0000-000000000001";
const ATENCION_ID  = "bbbbbbbb-0000-0000-0000-000000000001";
const PERSONAL_ID  = "cccccccc-0000-0000-0000-000000000001";

/** Fila NRP en_curso (cerrado_en = null). */
const rowEnCurso = {
  id: NRP_ID,
  atencion_rn_id: ATENCION_ID,
  apertura_en: new Date(),
  registrado_por: PERSONAL_ID,
  valoracion_inicial_en: null,
  fc_inicial: 80,
  respiracion_inicial: "débil",
  estimulacion_tactil_en: null,
  estimulacion_tactil_nota: null,
  vpp_iniciada_en: null,
  vpp_presion_cmh2o: null,
  vpp_frecuencia_rpm: null,
  vpp_fi_o2_pct: null,
  intubacion_en: null,
  tubo_size_mm: null,
  intubacion_nota: null,
  mce_iniciado_en: null,
  mce_ratio: "3:1",
  adrenalina_dosis_ml: null,
  adrenalina_via: null,
  adrenalina_concentracion: null,
  adrenalina_en: null,
  volumen_expansor_ml: null,
  volumen_expansor_tipo: null,
  volumen_expansor_en: null,
  fc_post_intervencion: null,
  fc_post_en: null,
  resultado: null,
  cerrado_en: null,
  cerrado_por: null,
  notas_cierre: null,
  creado_en: new Date(),
  actualizado_en: new Date(),
};

describe("eceReanimacionNeonatalRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
  });

  // -------------------------------------------------------------------------
  // 1. list — retorna items y total
  // -------------------------------------------------------------------------
  it("list retorna items y total desde raw SQL", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([rowEnCurso])
      .mockResolvedValueOnce([{ total: BigInt(1) }]);

    const caller = eceReanimacionNeonatalRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.list({ atencionRnId: ATENCION_ID });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 2. get — NOT_FOUND cuando no existe
  // -------------------------------------------------------------------------
  it("get lanza NOT_FOUND si no hay filas", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const caller = eceReanimacionNeonatalRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.get({ id: NRP_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------------
  // 3. crear — BAD_REQUEST sin establecimientoId
  // -------------------------------------------------------------------------
  it("crear lanza BAD_REQUEST sin establecimientoId en tenant", async () => {
    const tenantSinEstablecimiento = { ...MOCK_TENANT, establishmentId: undefined };
    const caller = eceReanimacionNeonatalRouter.createCaller(
      makeCtx({ prisma, tenant: tenantSinEstablecimiento }),
    );

    await expect(
      caller.crear({ atencionRnId: ATENCION_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // -------------------------------------------------------------------------
  // 4. registrarPaso — CONFLICT si ya cerrado (cerrado_en IS NOT NULL)
  // -------------------------------------------------------------------------
  it("registrarPaso lanza CONFLICT si registro está cerrado", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([
      { cerrado_en: new Date() },
    ]);

    const caller = eceReanimacionNeonatalRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.registrarPaso({ id: NRP_ID, estimulacionTactilNota: "estimulado" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // -------------------------------------------------------------------------
  // 5. registrarPaso — NOT_FOUND cuando el registro no existe
  // -------------------------------------------------------------------------
  it("registrarPaso lanza NOT_FOUND si el registro no existe", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const caller = eceReanimacionNeonatalRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.registrarPaso({ id: NRP_ID, vppPresionCmh2o: 20 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------------
  // 6. cerrar — NOT_FOUND cuando el registro no existe
  // -------------------------------------------------------------------------
  it("cerrar lanza NOT_FOUND si el registro no existe", async () => {
    // personal_salud query → ok; cerrado_en query → vacío
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: PERSONAL_ID }])  // resolvePersonalId
      .mockResolvedValueOnce([]);                      // cerrar check

    const caller = eceReanimacionNeonatalRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.cerrar({ id: NRP_ID, resultado: "estable" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------------
  // 7. cerrar — CONFLICT si ya está cerrado
  // -------------------------------------------------------------------------
  it("cerrar lanza CONFLICT si registro ya está cerrado", async () => {
    (prisma.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ id: PERSONAL_ID }])           // resolvePersonalId
      .mockResolvedValueOnce([{ cerrado_en: new Date() }]);   // cerrar check

    const caller = eceReanimacionNeonatalRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.cerrar({ id: NRP_ID, resultado: "ucin" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

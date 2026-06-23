/**
 * Tests unitarios del router eceHistoriaClinica.
 *
 * Estrategia:
 *   - withEceContext se mockea para ejecutar el callback directamente con el prisma mock.
 *   - ctx.prisma.$queryRaw y $executeRaw se reemplazan por vi.fn().
 *   - Tenant siempre incluye los roles necesarios para el procedure bajo test.
 *
 * Cobertura:
 *   list (happy + paginación), get (happy + NOT_FOUND), create (happy),
 *   update (happy + CONFLICT estado), firmar (BAD_REQUEST sin firma + happy),
 *   validar (BAD_REQUEST + happy), FORBIDDEN (rol insuficiente).
 *
 * Nota: enviarRevision y anular no existen en este router.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import type { TRPCContext } from "../../context";
import { eceHistoriaClinicaRouter } from "../ece/historia-clinica.router";
import { MOCK_USER_ADMIN } from "@his/test-utils";

// ─── Mock withEceContext ──────────────────────────────────────────────────────

vi.mock("../../ece/rls-context", () => ({
  withEceContext: vi.fn(
    async (
      _prisma: unknown,
      _personalId: unknown,
      _establecimientoId: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => fn(_prisma),
  ),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HC_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PACIENTE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const EPISODIO_ID = "cccccccc-0000-0000-0000-000000000003";
const FIRMA_ID = "dddddddd-0000-0000-0000-000000000004";
const INSTANCIA_ID = "eeeeeeee-0000-0000-0000-000000000005";

// Row shape returned by get procedure (HistoriaClinicaGetOutput) — CC-0001:
// `disposicion` se proyecta como `destino`; se añadió `analisisClinico`.
const SAMPLE_HC_GET = {
  id: HC_ID,
  instanciaId: INSTANCIA_ID,
  episodioId: EPISODIO_ID,
  tipoConsulta: "primera_vez",
  motivoConsulta: "Dolor abdominal severo",
  enfermedadActual: null,
  destino: null,
  analisisClinico: null,
  planManejo: null,
  antecedentes: null,
  examenFisico: null,
  diagnosticos: [],
  registradoPor: MOCK_USER_ADMIN.id,
  registradoEn: new Date("2026-05-17T08:00:00Z"),
  estadoRegistro: "borrador",
  patient: null,
  firmadoEn: null,
  validadoEn: null,
};

// Raw row shape from $queryRaw (used in create/update/firmar/validar)
const SAMPLE_HC_RAW = {
  id: HC_ID,
  instancia_id: INSTANCIA_ID,
  episodio_id: EPISODIO_ID,
  // enum tipo_consulta remapeado a primera_vez|subsecuente (DDL vivo); "ingreso" → subsecuente.
  tipo_consulta: "subsecuente",
  motivo_consulta: "Dolor abdominal severo",
  enfermedad_actual: null,
  disposicion: null,
  analisis_clinico: null,
  plan_manejo: null,
  antecedentes: null,
  examen_fisico: null,
  diagnosticos: null,
  registrado_por: MOCK_USER_ADMIN.id,
  registrado_en: new Date("2026-05-17T08:00:00Z"),
  estado_registro: "borrador",
  // get output maps these from subselects on documento_instancia_historial
  firmado_en: null,
  validado_en: null,
  patient_id: null,
  patient_first_name: null,
  patient_last_name: null,
  patient_mrn: null,
};

// Diagnóstico CIE-11 con tipo Complementario — requerido por RN-03 para firmar.
const DIAGNOSTICOS_RN03 = [
  { codigo: "BA00", descripcion: "Hipertensión esencial", tipo: "COMPLEMENTARIO" },
];

const TENANT_MC = {
  userId: MOCK_USER_ADMIN.id,
  organizationId: "00000000-0000-0000-0000-0000000000aa",
  countryId: "00000000-0000-0000-0000-0000000000bb",
  establishmentId: "00000000-0000-0000-0000-0000000000cc",
  roleCodes: ["MC"],
};

const TENANT_DIR = { ...TENANT_MC, roleCodes: ["DIR"] };
const TENANT_NURSE = { ...TENANT_MC, roleCodes: ["NURSE"] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExecuteRaw(): Mock {
  return vi.fn().mockResolvedValue(1);
}

function makePrisma(queryRawResults: unknown[] = [], executeRaw?: Mock) {
  const $queryRaw = vi.fn();
  queryRawResults.forEach((result, i) => {
    if (i === queryRawResults.length - 1) {
      $queryRaw.mockResolvedValue(result);
    } else {
      $queryRaw.mockResolvedValueOnce(result);
    }
  });
  return {
    $queryRaw,
    $executeRaw: executeRaw ?? makeExecuteRaw(),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw, $executeRaw: executeRaw ?? makeExecuteRaw(), $executeRawUnsafe: vi.fn() }),
    ),
  };
}

function makeCtx(
  roleCodes: string[] = ["MC"],
  queryRawResults: unknown[] = [],
  executeRaw?: Mock,
): TRPCContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = makePrisma(queryRawResults, executeRaw) as any;
  const tenant = { ...TENANT_MC, roleCodes };
  return {
    prisma,
    user: MOCK_USER_ADMIN,
    tenant,
    portalAccount: null,
    ip: "127.0.0.1",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("eceHistoriaClinicaRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("retorna items y nextCursor=null cuando hay exactamente limit resultados", async () => {
      const listRow = {
        id: HC_ID,
        episodio_id: EPISODIO_ID,
        tipo_consulta: "primera_vez",
        motivo_consulta: "Dolor",
        estado_registro: "borrador",
        registrado_en: new Date("2026-05-17T08:00:00Z"),
        patient_first_name: null,
        patient_last_name: null,
      };
      const ctx = makeCtx(["MC"], [[listRow]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.list({ episodioId: EPISODIO_ID, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it("retorna nextCursor cuando hay más registros que limit", async () => {
      const listRow = {
        id: HC_ID,
        episodio_id: EPISODIO_ID,
        tipo_consulta: "primera_vez",
        motivo_consulta: "Dolor",
        estado_registro: "borrador",
        registrado_en: new Date("2026-05-17T08:00:00Z"),
        patient_first_name: null,
        patient_last_name: null,
      };
      const rows = Array.from({ length: 21 }, (_, i) => ({
        ...listRow,
        id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
      }));
      const ctx = makeCtx(["PHYSICIAN"], [rows]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.list({ episodioId: EPISODIO_ID, limit: 20 });

      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).not.toBeNull();
    });
  });

  // ─── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("retorna la historia clínica cuando existe", async () => {
      const ctx = makeCtx(["PHYSICIAN"], [[SAMPLE_HC_RAW]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.get({ id: HC_ID });

      expect(result.id).toBe(HC_ID);
      expect(result.estadoRegistro).toBe("borrador");
    });

    it("proyecta disposicion→destino y expone analisisClinico (CC-0001)", async () => {
      const raw = {
        ...SAMPLE_HC_RAW,
        disposicion: "ALTA_MEDICA",
        analisis_clinico: "Cuadro compatible con resolución.",
        diagnosticos: [{ codigo: "BA00", descripcion: "HTA", tipo: "COMPLEMENTARIO" }],
      };
      const ctx = makeCtx(["MC"], [[raw]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.get({ id: HC_ID });

      expect(result.destino).toBe("ALTA_MEDICA");
      expect(result.analisisClinico).toBe("Cuadro compatible con resolución.");
      expect(result.diagnosticos).toHaveLength(1);
      expect(result.diagnosticos[0]).toMatchObject({ codigo: "BA00", tipo: "COMPLEMENTARIO" });
    });

    it("lanza NOT_FOUND cuando no existe", async () => {
      const ctx = makeCtx(["PHYSICIAN"], [[/*vacío*/]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.get({ id: HC_ID })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("crea historia clínica en estado borrador", async () => {
      const ctx = makeCtx(["MC"], [[SAMPLE_HC_RAW]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.create({
        episodioId: EPISODIO_ID,
        tipoConsulta: "subsecuente",
        motivoConsulta: "Dolor abdominal severo",
      });

      expect(result.id).toBe(HC_ID);
      expect(result.estado_registro).toBe("borrador");
    });

    it("acepta destino, analisisClinico y diagnósticos CIE-11 (CC-0001)", async () => {
      const ctx = makeCtx(["MC"], [[SAMPLE_HC_RAW]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.create({
        episodioId: EPISODIO_ID,
        tipoConsulta: "primera_vez",
        motivoConsulta: "Control prenatal",
        destino: "SEGUIMIENTO",
        analisisClinico: "Embarazo de curso normal.",
        antecedentes: { obstetricos: "G2P1A0", fum: "2026-04-01" },
        diagnosticos: [
          { codigo: "QA40", descripcion: "Embarazo", tipo: "COMPLEMENTARIO" },
        ],
      });

      expect(result.id).toBe(HC_ID);
    });

    it("rechaza destino fuera del catálogo cerrado (RN-08)", async () => {
      const ctx = makeCtx(["MC"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(
        // @ts-expect-error destino inválido — el enum cerrado lo rechaza
        caller.create({ episodioId: EPISODIO_ID, tipoConsulta: "primera_vez", destino: "ALTA" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("lanza FORBIDDEN si el rol es NURSE (no puede crear)", async () => {
      const ctx = makeCtx(["NURSE"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(
        caller.create({ episodioId: EPISODIO_ID, tipoConsulta: "subsecuente", motivoConsulta: "Test" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("actualiza cuando el estado es borrador", async () => {
      const updatedRaw = { ...SAMPLE_HC_RAW, motivo_consulta: "Actualizado" };
      // 1ra call: estado check; 2da call: UPDATE RETURNING
      const ctx = makeCtx(["MC"], [[{ estado_registro: "borrador" }], [updatedRaw]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.update({ id: HC_ID, motivoConsulta: "Actualizado" });

      expect(result.motivo_consulta).toBe("Actualizado");
    });

    it("lanza CONFLICT si el estado es firmado", async () => {
      const ctx = makeCtx(["MC"], [[{ estado_registro: "firmado" }]]);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(
        caller.update({ id: HC_ID, motivoConsulta: "X" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  // ─── firmar ────────────────────────────────────────────────────────────────

  describe("firmar", () => {
    it("lanza BAD_REQUEST si no se proporciona firmaId", async () => {
      const ctx = makeCtx(["MC"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.firmar({ id: HC_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("avanza de borrador a firmado con firmaId", async () => {
      const firmadoRaw = { ...SAMPLE_HC_RAW, estado_registro: "firmado" };
      // 1ra: SELECT estado+diagnosticos (RN-03); 2da: UPDATE RETURNING
      const ctx = makeCtx(
        ["MC"],
        [
          [
            {
              estado_registro: "borrador",
              instancia_id: INSTANCIA_ID,
              motivo_consulta: null,
              enfermedad_actual: null,
              plan_manejo: null,
              diagnosticos: DIAGNOSTICOS_RN03,
            },
          ],
          [firmadoRaw],
        ],
        makeExecuteRaw(),
      );
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.firmar({ id: HC_ID, firmaId: FIRMA_ID });

      expect(result.estado_registro).toBe("firmado");
    });

    it("lanza PRECONDITION_FAILED (RN-03) si no hay diagnóstico Complementario", async () => {
      const ctx = makeCtx(
        ["MC"],
        [
          [
            {
              estado_registro: "borrador",
              instancia_id: INSTANCIA_ID,
              motivo_consulta: null,
              enfermedad_actual: null,
              plan_manejo: null,
              diagnosticos: [
                { codigo: "BA00", descripcion: "Dx", tipo: "DEFINITIVO" },
              ],
            },
          ],
        ],
        makeExecuteRaw(),
      );
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.firmar({ id: HC_ID, firmaId: FIRMA_ID })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    });

    it("lanza FORBIDDEN si el rol es MT (solo MC puede firmar)", async () => {
      const ctx = makeCtx(["MT"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.firmar({ id: HC_ID, firmaId: FIRMA_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // ─── validar ───────────────────────────────────────────────────────────────

  describe("validar", () => {
    it("lanza BAD_REQUEST si no se proporciona firmaId", async () => {
      const ctx = makeCtx(["DIR"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.validar({ id: HC_ID })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("avanza de firmado a validado con firmaId", async () => {
      const validadoRaw = { ...SAMPLE_HC_RAW, estado_registro: "validado" };
      const ctx = makeCtx(
        ["DIR"],
        [[{ estado_registro: "firmado", instancia_id: INSTANCIA_ID }], [validadoRaw]],
        makeExecuteRaw(),
      );
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      const result = await caller.validar({ id: HC_ID, firmaId: FIRMA_ID });

      expect(result.estado_registro).toBe("validado");
    });

    it("lanza FORBIDDEN si el rol es MC (solo DIR puede validar)", async () => {
      const ctx = makeCtx(["MC"], []);
      const caller = eceHistoriaClinicaRouter.createCaller(ctx);

      await expect(caller.validar({ id: HC_ID, firmaId: FIRMA_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});

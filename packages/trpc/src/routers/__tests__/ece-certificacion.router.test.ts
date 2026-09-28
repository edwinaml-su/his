/**
 * Tests del eceCertificacionRouter (Fase 2 — Certificación DIR).
 *
 * Cubre:
 *   listCola:
 *     - devuelve documentos en estado 'validado'
 *     - rechaza si el rol no es DIR (FORBIDDEN)
 *
 *   certificar:
 *     - happy-path: certifica, registra historial, emite evento
 *     - rechaza si documento no está en estado 'validado' (PRECONDITION_FAILED)
 *     - rechaza tipo de documento no certificable (FORBIDDEN)
 *     - rechaza si PIN es incorrecto (UNAUTHORIZED)
 *
 *   certificarBulk (HG-05):
 *     - 3 documentos válidos → todos exitosos, fallidos vacío
 *     - 1 de 3 falla (documento no 'validado') → exitosos=2, fallidos=1
 *     - PIN incorrecto → UNAUTHORIZED, ningún documento procesado
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { eceCertificacionRouter } from "../ece/certificacion.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";
import { argon2 } from "@his/infrastructure";

// Mock argon2 para tests rápidos
vi.mock("@his/infrastructure", () => ({
  argon2: {
    argon2id: 2,
    hash: vi.fn().mockResolvedValue("$argon2id$test$hash"),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

// Mock emitDomainEvent para evitar insertar en BD real
vi.mock("@his/database", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue({ id: "evt-id" }),
}));

const DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR"] };
const NON_DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };

const INSTANCIA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PERSONAL_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FIRMA_ID     = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ESTADO_ID    = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const VALID_PIN    = "123456";

function makeInstanciaRow(overrides: Partial<{
  estado_codigo: string;
  tipo_documento_codigo: string;
}> = {}) {
  return {
    id: INSTANCIA_ID,
    estado_actual_id: ESTADO_ID,
    estado_codigo: overrides.estado_codigo ?? "validado",
    tipo_documento_codigo: overrides.tipo_documento_codigo ?? "FICHA_ID",
    paciente_id: "00000000-0000-0000-0000-000000000010",
    version: 1,
  };
}

describe("eceCertificacionRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();

    // Restaurar verify tras clearAllMocks — usa import estático (no require)
    // para evitar SyntaxError al cargar el módulo ESM de @his/infrastructure.
    vi.mocked(argon2.verify).mockResolvedValue(true);
  });

  // -------------------------------------------------------------------------
  // listCola
  // -------------------------------------------------------------------------
  describe("listCola", () => {
    const PUBLIC_PATIENT_ID = "00000000-0000-0000-0000-000000000010";
    const ECE_PACIENTE_ID = "00000000-0000-0000-0000-0000000000ee"; // ece.paciente.id — espacio DISTINTO de PUBLIC_PATIENT_ID

    /**
     * R1.1 (corregido — P1-1) — `listCola` corre bajo `withWorkflowContext`
     * (resuelve `resolvePersonalSalud` vía `$queryRaw`, aplica el contexto
     * ECE vía `$executeRawUnsafe` dentro de `$transaction`, y consulta la
     * cola vía `tx.$queryRawUnsafe` — esa query YA incluye
     * `validado_por_nombre` resuelto por JOIN a `ece.personal_salud`, mismo
     * espacio de ids que `ejecutado_por`). Solo el nombre de PACIENTE se
     * resuelve aparte con `ctx.prisma.$queryRaw` (BYPASSRLS) sobre
     * `public."Patient"`, cruzando por `public_patient_id` — NUNCA por
     * `paciente_id` (ese es el id de `ece.paciente`, otro espacio — ver
     * cabecera del router).
     */
    function setupWorkflowContext() {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      // resolvePersonalSalud (personal del DIR que llama)
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: PERSONAL_ID, nombre_completo: "Dra. Ana Medina" },
      ]);
    }

    it("devuelve documentos en estado validado", async () => {
      setupWorkflowContext();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        {
          id: INSTANCIA_ID,
          tipo_documento_codigo: "EPICRISIS",
          tipo_documento_nombre: "Epicrisis",
          paciente_id: ECE_PACIENTE_ID,
          public_patient_id: PUBLIC_PATIENT_ID,
          estado_codigo: "validado",
          estado_nombre: "Validado",
          version: 1,
          validado_por: PERSONAL_ID,
          validado_por_nombre: "Dr. Juan Validador",
          creado_en: new Date("2026-05-10T08:00:00Z"),
          ultimo_cambio_en: new Date("2026-05-11T10:00:00Z"),
        },
      ]);
      // Lookup de nombre de paciente — cruza por public_patient_id.
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: PUBLIC_PATIENT_ID, nombre: "Juana Perez" },
      ]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.listCola({});

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.estadoCodigo).toBe("validado");
      expect(result.items[0]?.pacienteId).toBe(ECE_PACIENTE_ID);
      expect(result.items[0]?.pacienteNombre).toBe("Juana Perez");
      // validadoPorNombre viene DIRECTO de la query ECE (join a
      // ece.personal_salud) — no de un segundo lookup a public."User".
      expect(result.items[0]?.validadoPorNombre).toBe("Dr. Juan Validador");
      expect(result.nextCursor).toBeUndefined();
      // Nota: pacienteNombre solo puede resolver a "Juana Perez" si el
      // lookup cruzó por public_patient_id — si usara paciente_id (el id de
      // ece.paciente) a secas, el Map.get fallaría y caería al fallback
      // `r.paciente_id` (ECE_PACIENTE_ID). Esta aserción ES la regresión de P1-1.
    });

    it("aplica el contexto ECE (personal.id real del DIR) ANTES de consultar la cola", async () => {
      setupWorkflowContext();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await caller.listCola({});

      // set_ece_context debe recibir el personal.id REAL (resuelto vía
      // resolvePersonalSalud), no ctx.user.id — bug que motivó P1-1/R1.1.
      const setContextCall = prisma.$executeRawUnsafe.mock.calls.find(
        ([sql]) => typeof sql === "string" && sql.includes("set_ece_context"),
      );
      expect(setContextCall).toBeDefined();
      expect(setContextCall?.[0]).toContain(PERSONAL_ID);

      // Y ese contexto debe aplicarse ANTES de la query de la cola — si una
      // regresión saca la query fuera de `withWorkflowContext`, esta
      // aserción de orden de invocación debe fallar (P2-2).
      const contextCallOrder = prisma.$executeRawUnsafe.mock.invocationCallOrder[0]!;
      const queryCallOrder = prisma.$queryRawUnsafe.mock.invocationCallOrder[0]!;
      expect(contextCallOrder).toBeLessThan(queryCallOrder);
    });

    it("rechaza rol no DIR (FORBIDDEN)", async () => {
      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: NON_DIR_TENANT }),
      );
      await expect(caller.listCola({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rechaza sin establecimiento activo (BAD_REQUEST)", async () => {
      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: { ...DIR_TENANT, establishmentId: undefined } }),
      );
      await expect(caller.listCola({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rechaza si el DIR no tiene personal_salud materializado (PRECONDITION_FAILED)", async () => {
      // resolvePersonalSalud → sin fila (sync R1.1 aún no corrió para este usuario)
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(caller.listCola({})).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    /**
     * D5 (plan de remediación 2026-09) — el cursor debe ser coherente con el
     * ORDER BY. Bug original: WHERE filtraba `di.id > $2` pero el ORDER BY era
     * por `creado_en`/`actualizado_en` (columna sin relación con el id) — la
     * página siguiente podía saltarse filas (id mayor, fecha anterior a la ya
     * listada) o repetirlas (id menor, fecha posterior). Este test falla
     * contra ese código: no había NINGÚN `di.id` en el ORDER BY, y el WHERE
     * usaba solo `di.id`, nunca la columna de orden.
     *
     * `expectedColumn`/`expectedDirection` atan cada modo a su columna y
     * sentido reales (hallazgo menor de revisión) — antes el test solo
     * verificaba consistencia interna (ORDER BY = comparador = WHERE) sin
     * comprobar que CADA modo usara lo que dice su label, así que pasaba
     * igual si alguien intercambiaba las columnas/direcciones entre modos.
     * `expectedColumn` es `creado_en` en ambos porque `ece.documento_instancia`
     * no tiene `actualizado_en` en prod (ver comentario junto a `sortColumn`
     * en el router) — lo que sí debe variar por modo es la dirección.
     */
    it.each([
      {
        incluirCertificados: false,
        label: "creado_en ASC (cola pendiente)",
        expectedColumn: "creado_en",
        expectedDirection: "ASC",
      },
      {
        incluirCertificados: true,
        label: "creado_en DESC (histórico)",
        expectedColumn: "creado_en",
        expectedDirection: "DESC",
      },
    ])(
      "usa un cursor compuesto (columna de orden + id) coherente con el ORDER BY — $label",
      async ({ incluirCertificados, expectedColumn, expectedDirection }) => {
        setupWorkflowContext();
        prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

        const caller = eceCertificacionRouter.createCaller(
          makeCtx({ prisma, tenant: DIR_TENANT }),
        );
        await caller.listCola({ incluirCertificados, cursor: INSTANCIA_ID });

        const call = prisma.$queryRawUnsafe.mock.calls[0]!;
        const [sql, , cursorParam] = call as [string, ...unknown[]];

        // El ORDER BY debe desempatar por `di.id` en el MISMO sentido que la
        // columna de orden principal (si no, el desempate no es determinista).
        const orderMatch = sql.match(
          /ORDER BY di\.(creado_en|actualizado_en) (ASC|DESC), di\.id (ASC|DESC)/,
        );
        expect(orderMatch).not.toBeNull();
        const [, sortColumn, sortDirection, idDirection] = orderMatch!;
        expect(idDirection).toBe(sortDirection);

        // Ata el modo a SU columna y dirección reales — no solo consistencia
        // interna. Detecta un swap entre modos (p.ej. cola pendiente ordenada
        // por DESC, o histórico apuntando de nuevo a una columna inexistente).
        expect(sortColumn).toBe(expectedColumn);
        expect(sortDirection).toBe(expectedDirection);

        // El WHERE del cursor debe filtrar por la MISMA columna del ORDER BY
        // + id (tupla), resolviendo la fecha real de la fila-cursor por PK —
        // nunca solo por `di.id` (ese fue el bug: id sin relación con la
        // fecha de orden).
        const whereRegex = new RegExp(
          `\\(di\\.${sortColumn}, di\\.id\\) (<|>) \\(\\s*SELECT ${sortColumn}, id FROM ece\\.documento_instancia WHERE id = \\$2::uuid\\s*\\)`,
        );
        const whereMatch = sql.match(whereRegex);
        expect(whereMatch).not.toBeNull();

        // Dirección del comparador coherente con el sentido del ORDER BY:
        // ASC → siguiente página es "mayor"; DESC → siguiente página es "menor".
        const comparator = whereMatch![1];
        expect(comparator).toBe(sortDirection === "ASC" ? ">" : "<");

        // El contrato del cursor no cambia: sigue siendo el id plano de la
        // fila (el cliente web lo trata como opaco y lo reenvía tal cual).
        expect(cursorParam).toBe(INSTANCIA_ID);
      },
    );

    /**
     * Hallazgo menor de revisión — el camino SIN cursor (primera página) no
     * tenía cobertura: nada comprobaba que el WHERE no trajera la tupla de
     * paginación, que el ORDER BY igual desempatara por `di.id`, ni que el
     * LIMIT cayera en `$2` con exactamente 2 params (`[estadoFiltro, limit]`).
     */
    it("primera página (sin cursor): sin WHERE de tupla, ORDER BY con desempate por id, LIMIT $2 y 2 params", async () => {
      setupWorkflowContext();
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await caller.listCola({});

      const call = prisma.$queryRawUnsafe.mock.calls[0]!;
      const [sql, ...params] = call as [string, ...unknown[]];

      expect(sql).not.toMatch(/\(di\.\w+, di\.id\)/);
      expect(sql).toMatch(/ORDER BY di\.creado_en ASC, di\.id ASC/);
      expect(sql).toMatch(/LIMIT \$2\s*$/);
      expect(params).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // certificar
  //
  // Orden de llamadas $queryRaw (post-refactor — verificación PIN antes de certificarOneInTx):
  //   1. personal_salud  (findPersonal)
  //   2. firma_electronica  (incluye pin_hash)
  //   3. documento_instancia  (dentro de certificarOneInTx)
  //   4. flujo_estado 'certificado'  (dentro de certificarOneInTx)
  // -------------------------------------------------------------------------
  describe("certificar", () => {
    const FIRMA_ROW = {
      id: FIRMA_ID,
      pin_hash: "$argon2id$test$hash",
      failed_attempts: 0,
      locked_until: null,
      revoked_at: null,
    };

    function setupTransaccion() {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
    }

    function setupFirmaOk() {
      // 1. personal
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // 2. firma
      prisma.$queryRaw.mockResolvedValueOnce([FIRMA_ROW]);
    }

    function setupHappyPath() {
      setupTransaccion();
      setupFirmaOk();
      // 3. instancia
      prisma.$queryRaw.mockResolvedValueOnce([makeInstanciaRow()]);
      // 4. estado 'certificado'
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_ID }]);
      // UPDATE instancia
      prisma.$executeRaw.mockResolvedValueOnce(1);
      // INSERT historial
      prisma.$executeRaw.mockResolvedValueOnce(1);
    }

    it("happy-path: certifica y devuelve ok:true + instanciaId", async () => {
      setupHappyPath();

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.certificar({
        instanciaId: INSTANCIA_ID,
        pin: VALID_PIN,
      });

      expect(result.ok).toBe(true);
      expect(result.instanciaId).toBe(INSTANCIA_ID);
      expect(result.payloadHash).toHaveLength(64);
    });

    it("rechaza documento no en estado 'validado' (PRECONDITION_FAILED)", async () => {
      setupTransaccion();
      setupFirmaOk();
      // instancia en estado 'borrador'
      prisma.$queryRaw.mockResolvedValueOnce([
        makeInstanciaRow({ estado_codigo: "borrador" }),
      ]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("rechaza tipo de documento no certificable (FORBIDDEN)", async () => {
      setupTransaccion();
      setupFirmaOk();
      prisma.$queryRaw.mockResolvedValueOnce([
        makeInstanciaRow({ tipo_documento_codigo: "NOTA_EVOLUCION" }),
      ]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rechaza PIN incorrecto (UNAUTHORIZED)", async () => {
      setupTransaccion();
      // personal + firma (con pin_hash)
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      prisma.$queryRaw.mockResolvedValueOnce([FIRMA_ROW]);

      vi.mocked(argon2.verify).mockResolvedValueOnce(false);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("rechaza si no existe personal ECE asociado (PRECONDITION_FAILED)", async () => {
      setupTransaccion();
      // personal no encontrado (primera llamada $queryRaw en el nuevo orden)
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificar({ instanciaId: INSTANCIA_ID, pin: VALID_PIN }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  // -------------------------------------------------------------------------
  // certificarBulk (HG-05)
  // -------------------------------------------------------------------------
  describe("certificarBulk", () => {
    const ID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const ID_B = "bbbbbbbb-0000-0000-0000-000000000001";
    const ID_C = "cccccccc-0000-0000-0000-000000000002";

    /** Configura el prisma mock para un ciclo de verificación de firma. */
    function setupFirmaVerification() {
      prisma.$transaction.mockImplementation(async (fn: (tx: PrismaClient) => Promise<unknown>) =>
        fn(prisma),
      );
      prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
      // personal_salud (verificación PIN)
      prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]);
      // firma con pin_hash (verificación PIN)
      prisma.$queryRaw.mockResolvedValueOnce([{
        id: FIRMA_ID,
        pin_hash: "$argon2id$test$hash",
        failed_attempts: 0,
        locked_until: null,
        revoked_at: null,
      }]);
    }

    /** Configura el prisma mock para una certificación individual exitosa. */
    function setupDocExitoso(id: string) {
      // instancia
      prisma.$queryRaw.mockResolvedValueOnce([{
        ...makeInstanciaRow(),
        id,
      }]);
      // estado 'certificado'
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_ID }]);
      // UPDATE instancia
      prisma.$executeRaw.mockResolvedValueOnce(1);
      // INSERT historial
      prisma.$executeRaw.mockResolvedValueOnce(1);
    }

    it("3 documentos válidos → todos exitosos, fallidos vacío", async () => {
      setupFirmaVerification();
      setupDocExitoso(ID_A);
      setupDocExitoso(ID_B);
      setupDocExitoso(ID_C);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.certificarBulk({
        instanciaIds: [ID_A, ID_B, ID_C],
        pin: VALID_PIN,
      });

      expect(result.exitosos).toHaveLength(3);
      expect(result.fallidos).toHaveLength(0);
      expect(result.exitosos.map((e) => e.instanciaId)).toEqual(
        expect.arrayContaining([ID_A, ID_B, ID_C]),
      );
    });

    it("1 de 3 falla (documento no validado) → exitosos=2, fallidos=1", async () => {
      setupFirmaVerification();

      // Doc A — exitoso
      setupDocExitoso(ID_A);

      // Doc B — falla: estado 'borrador'
      prisma.$queryRaw.mockResolvedValueOnce([{
        ...makeInstanciaRow({ estado_codigo: "borrador" }),
        id: ID_B,
      }]);

      // Doc C — exitoso
      setupDocExitoso(ID_C);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      const result = await caller.certificarBulk({
        instanciaIds: [ID_A, ID_B, ID_C],
        pin: VALID_PIN,
      });

      expect(result.exitosos).toHaveLength(2);
      expect(result.fallidos).toHaveLength(1);
      expect(result.fallidos[0]?.instanciaId).toBe(ID_B);
    });

    it("PIN incorrecto → UNAUTHORIZED, ningún documento procesado", async () => {
      setupFirmaVerification();

      // PIN incorrecto
      const { argon2: argon2Mod } = await import("@his/infrastructure");
      vi.mocked(argon2Mod.verify).mockResolvedValueOnce(false);

      const caller = eceCertificacionRouter.createCaller(
        makeCtx({ prisma, tenant: DIR_TENANT }),
      );
      await expect(
        caller.certificarBulk({
          instanciaIds: [ID_A, ID_B, ID_C],
          pin: VALID_PIN,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});

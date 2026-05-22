/**
 * Tests unitarios — assertDependenciasFirmadas (Fase 4 workflow-designer).
 *
 * Estrategia de mock:
 *   - `tx.$queryRaw` se mockea como `vi.fn()` con respuestas secuenciales
 *     vía `mockResolvedValueOnce`.
 *   - Llamada 1 → lookup de tipo_documento (`SELECT codigo, depende_de ...`).
 *   - Llamada 2 → query de dependencias pendientes (devuelve solo las que
 *     NO tienen instancia firmada en el episodio/paciente).
 *
 * No se inspecciona el SQL textualmente porque Prisma.sql produce un objeto
 * `Sql` opaco; se valida el contrato a nivel de inputs/outputs y argumentos
 * pasados al template literal (vía `.values` del Sql).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertDependenciasFirmadas } from "../dependencias-enforcement";
import type { Prisma } from "@his/database";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PACIENTE_ID = "11111111-1111-1111-1111-111111111111";
const EPISODIO_ID = "22222222-2222-2222-2222-222222222222";

interface MockTx {
  $queryRaw: ReturnType<typeof vi.fn>;
}

/** Construye un tx mock con $queryRaw vacío — el test configura las respuestas. */
function makeTx(): MockTx {
  return {
    $queryRaw: vi.fn(),
  };
}

/** Extrae los `values` del Prisma.Sql pasado a $queryRaw en la llamada N. */
function getSqlValues(tx: MockTx, callIndex: number): unknown[] {
  const call = tx.$queryRaw.mock.calls[callIndex] as [Prisma.Sql];
  // El objeto Prisma.Sql expone `.values` con los argumentos interpolados.
  return (call[0] as unknown as { values: unknown[] }).values;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertDependenciasFirmadas", () => {
  let tx: MockTx;

  beforeEach(() => {
    tx = makeTx();
  });

  it("no-op cuando depende_de está vacío []", async () => {
    // Tipo de documento existe pero sin dependencias declaradas.
    tx.$queryRaw.mockResolvedValueOnce([{ codigo: "FICHA_ID", depende_de: [] }]);

    await expect(
      assertDependenciasFirmadas({
        tx: tx as unknown as Prisma.TransactionClient,
        tipoDocCodigo: "FICHA_ID",
        episodioId: null,
        pacienteId: PACIENTE_ID,
      }),
    ).resolves.toBeUndefined();

    // Solo se hace la primera query (lookup tipo_doc); la segunda no corre.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("no-op cuando depende_de es null", async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ codigo: "FICHA_ID", depende_de: null }]);

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "FICHA_ID",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("no-op cuando skipEnforcement=true (uso en seeders/migraciones)", async () => {
    // Aunque no haya tipo_doc cargado, skip lo cortocircuita antes del query.
    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "CUALQUIER_COSA",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
      skipEnforcement: true,
    });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("lanza BAD_REQUEST cuando tipoDocCodigo no existe o está inactivo", async () => {
    // Lookup retorna [] → tipo no encontrado.
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      assertDependenciasFirmadas({
        tx: tx as unknown as Prisma.TransactionClient,
        tipoDocCodigo: "INEXISTENTE",
        episodioId: EPISODIO_ID,
        pacienteId: PACIENTE_ID,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("INEXISTENTE"),
    });
  });

  it("lanza PRECONDITION_FAILED con todos los códigos faltantes en mensaje y cause", async () => {
    // depende_de tiene 3 códigos; 2 vienen como pendientes en la segunda query.
    tx.$queryRaw.mockResolvedValueOnce([
      { codigo: "EPICRISIS", depende_de: ["HCC", "EVOL", "IND_MED"] },
    ]);
    tx.$queryRaw.mockResolvedValueOnce([
      { codigo_dependencia: "HCC", nombre_dependencia: "Historia Clínica" },
      { codigo_dependencia: "EVOL", nombre_dependencia: "Evolución Médica" },
    ]);

    try {
      await assertDependenciasFirmadas({
        tx: tx as unknown as Prisma.TransactionClient,
        tipoDocCodigo: "EPICRISIS",
        episodioId: EPISODIO_ID,
        pacienteId: PACIENTE_ID,
      });
      // Si no lanza, el test falla.
      throw new Error("debió lanzar TRPCError");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const tErr = err as TRPCError;
      expect(tErr.code).toBe("PRECONDITION_FAILED");
      // El mensaje incluye AMBOS códigos faltantes.
      expect(tErr.message).toContain("HCC");
      expect(tErr.message).toContain("EVOL");
      expect(tErr.message).toContain("2"); // "faltan 2 dependencia(s)"
      // cause.dependenciasFaltantes es array de 2 códigos.
      const cause = tErr.cause as { dependenciasFaltantes: string[] };
      expect(cause.dependenciasFaltantes).toEqual(["HCC", "EVOL"]);
    }
  });

  it("pasa cuando todas las dependencias están firmadas (segunda query vacía)", async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      { codigo: "EPICRISIS", depende_de: ["HCC", "EVOL"] },
    ]);
    // Sin pendientes → todas firmadas.
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      assertDependenciasFirmadas({
        tx: tx as unknown as Prisma.TransactionClient,
        tipoDocCodigo: "EPICRISIS",
        episodioId: EPISODIO_ID,
        pacienteId: PACIENTE_ID,
      }),
    ).resolves.toBeUndefined();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("pasa cuando los estados terminales son validado o certificado (es_final=true)", async () => {
    // La lógica SQL ya acepta firmado | validado | certificado | es_final=true.
    // Desde la perspectiva del helper, la query devuelve [] cuando esos estados
    // satisfacen la dependencia: replicamos ese contrato.
    tx.$queryRaw.mockResolvedValueOnce([
      { codigo: "ALTA_HOSP", depende_de: ["HCC_VAL", "EPI_CERT"] },
    ]);
    tx.$queryRaw.mockResolvedValueOnce([]); // ambos cubiertos por validado/certificado

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "ALTA_HOSP",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("scoping: con episodioId pasa el UUID al SQL; con null pasa null", async () => {
    // ─── Caso 1: episodioId definido ────────────────────────────────────────
    tx.$queryRaw.mockResolvedValueOnce([{ codigo: "IND_MED", depende_de: ["HCC"] }]);
    tx.$queryRaw.mockResolvedValueOnce([]);

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "IND_MED",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
    });

    // Los `values` de la segunda llamada incluyen el array depende_de,
    // pacienteId y episodioId (2 veces por la condición IS NULL OR ...).
    const values2 = getSqlValues(tx, 1);
    expect(values2).toContain(EPISODIO_ID);
    expect(values2).toContain(PACIENTE_ID);

    // ─── Caso 2: episodioId = null (documento maestro nivel paciente) ───────
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([{ codigo: "FICHA_ID", depende_de: ["CONS_DAT"] }]);
    tx.$queryRaw.mockResolvedValueOnce([]);

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "FICHA_ID",
      episodioId: null,
      pacienteId: PACIENTE_ID,
    });

    const valuesNull = getSqlValues(tx, 1);
    // episodioId=null se pasa literal — el SQL hace `IS NULL OR di.episodio_id = ...`.
    expect(valuesNull).toContain(null);
    expect(valuesNull).toContain(PACIENTE_ID);
    // Y el mensaje de error (cuando aplica) usaría "paciente" en lugar de "episodio";
    // aquí solo verificamos que el scoping llega correctamente al SQL.
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fase 6 — overrides por establecimiento
  // ───────────────────────────────────────────────────────────────────────────

  const ESTABLECIMIENTO_ID = "33333333-3333-3333-3333-333333333333";
  const TIPO_DOC_ID = "44444444-4444-4444-4444-444444444444";

  it("override obligatorio=false hace bypass total (no enforcement)", async () => {
    // 1: lookup tipo_documento (con id ahora)
    tx.$queryRaw.mockResolvedValueOnce([
      { id: TIPO_DOC_ID, codigo: "IND_MED", depende_de: ["HOJA_ING"] },
    ]);
    // 2: lookup override → obligatorio_override=false → bypass
    tx.$queryRaw.mockResolvedValueOnce([
      { obligatorio_override: false, depende_de_override: null },
    ]);

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "IND_MED",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
      establecimientoId: ESTABLECIMIENTO_ID,
    });

    // Solo 2 llamadas: lookup tipo + lookup override. NO se ejecuta el query
    // de dependencias pendientes (3ra llamada).
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("override depende_de_override reemplaza el global", async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      { id: TIPO_DOC_ID, codigo: "IND_MED", depende_de: ["HOJA_ING", "FICHA_ID"] },
    ]);
    // Override: solo FICHA_ID — HOJA_ING ya no aplica en este establecimiento.
    tx.$queryRaw.mockResolvedValueOnce([
      { obligatorio_override: null, depende_de_override: ["FICHA_ID"] },
    ]);
    // Query de dependencias pendientes con depende_de override → ninguna pendiente.
    tx.$queryRaw.mockResolvedValueOnce([]);

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "IND_MED",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
      establecimientoId: ESTABLECIMIENTO_ID,
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    // El 3er query debe usar el override ["FICHA_ID"], no el global.
    const values3 = getSqlValues(tx, 2);
    expect(values3).toContainEqual(["FICHA_ID"]);
  });

  it("sin override registrado → usa depende_de global", async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      { id: TIPO_DOC_ID, codigo: "IND_MED", depende_de: ["HOJA_ING"] },
    ]);
    // Override: no existe fila → array vacío.
    tx.$queryRaw.mockResolvedValueOnce([]);
    // Query de dependencias pendientes con depende_de global.
    tx.$queryRaw.mockResolvedValueOnce([]);

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "IND_MED",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
      establecimientoId: ESTABLECIMIENTO_ID,
    });

    const values3 = getSqlValues(tx, 2);
    expect(values3).toContainEqual(["HOJA_ING"]);
  });

  it("sin establecimientoId no consulta overrides", async () => {
    tx.$queryRaw.mockResolvedValueOnce([
      { id: TIPO_DOC_ID, codigo: "IND_MED", depende_de: ["HOJA_ING"] },
    ]);
    tx.$queryRaw.mockResolvedValueOnce([]);

    await assertDependenciasFirmadas({
      tx: tx as unknown as Prisma.TransactionClient,
      tipoDocCodigo: "IND_MED",
      episodioId: EPISODIO_ID,
      pacienteId: PACIENTE_ID,
      // establecimientoId omitido
    });

    // Solo 2 queries: lookup tipo + query de pendientes (NO override).
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

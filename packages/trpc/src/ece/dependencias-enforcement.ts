/**
 * Dependencias enforcement — Fase 4 del workflow-designer enhancement.
 *
 * Valida que TODAS las dependencias declaradas en `ece.tipo_documento.depende_de`
 * tengan al menos una instancia firmada (o en estado terminal) en el MISMO
 * episodio antes de permitir la creación de una nueva `documento_instancia`.
 *
 * Política de "firmado":
 *   - Una instancia se considera "firmada" si su estado_actual:
 *     a) tiene `codigo = 'firmado'`, O
 *     b) tiene `codigo = 'validado'`, O
 *     c) tiene `es_final = true` (estado terminal del workflow, eg. 'certificado')
 *
 *   El check NO acepta instancias en estado 'anulado', 'borrador' o 'en_revision'.
 *
 * Política de scoping:
 *   - El check se hace SOBRE EL MISMO `episodio_id` cuando el documento
 *     pertenece a un episodio (típico hospitalario/emergencia/quirúrgico).
 *   - Si `episodioId` es null (documento maestro como FICHA_ID), el check
 *     se hace sobre el MISMO `paciente_id` (las dependencias deben existir
 *     a nivel paciente, no episodio).
 *
 * Override (Fase 6):
 *   - Si se pasa `skipEnforcement: true`, la validación se omite (uso típico:
 *     seeders y migraciones).
 *   - En Fase 6 se agregará override por establecimiento vía
 *     `ece.tipo_documento_establecimiento`.
 *
 * Error mode:
 *   - Si falta UNA O MÁS dependencias firmadas → throw `TRPCError` con
 *     code `PRECONDITION_FAILED` y lista de códigos faltantes en `cause`.
 *   - Si el `tipoDocCodigo` no existe → throw con code `BAD_REQUEST`.
 *   - Si `depende_de` está vacío → no-op.
 */

import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import type { PrismaClient } from "@his/database";

export interface AssertDependenciasFirmadasOpts {
  /** Cliente Prisma (típicamente el `tx` dentro de withWorkflowContext). */
  tx: PrismaClient | Prisma.TransactionClient;
  /** Código del tipo_documento que se va a crear (eg. 'IND_MED', 'EPICRISIS'). */
  tipoDocCodigo: string;
  /** Episodio del nuevo documento. Null si es documento maestro nivel paciente. */
  episodioId: string | null;
  /** Paciente del nuevo documento. Siempre obligatorio. */
  pacienteId: string;
  /** Si true, omite el check (uso interno: seeders, migraciones). */
  skipEnforcement?: boolean;
  /**
   * Establecimiento actual — si se provee, el helper aplica overrides de
   * `ece.tipo_documento_establecimiento` (Fase 6). Si es undefined, usa
   * solo el `depende_de` global del catálogo.
   */
  establecimientoId?: string;
}

interface TipoDocRow {
  codigo: string;
  depende_de: string[] | null;
}

interface DependenciaPendienteRow {
  codigo_dependencia: string;
  nombre_dependencia: string;
}

/**
 * Lanza TRPCError PRECONDITION_FAILED si alguna dependencia declarada en
 * `tipo_documento.depende_de` no tiene una instancia firmada/terminal en el
 * mismo episodio o paciente.
 *
 * Esta función debe llamarse DENTRO de la transacción de creación, antes
 * del INSERT a `ece.documento_instancia`.
 */
export async function assertDependenciasFirmadas(
  opts: AssertDependenciasFirmadasOpts,
): Promise<void> {
  if (opts.skipEnforcement === true) return;

  const { tx, tipoDocCodigo, episodioId, pacienteId, establecimientoId } = opts;

  // 1. Obtener depende_de del tipo_documento a crear.
  const tipoRows = await tx.$queryRaw<(TipoDocRow & { id: string })[]>(Prisma.sql`
    SELECT id::text, codigo, depende_de
    FROM ece.tipo_documento
    WHERE codigo = ${tipoDocCodigo} AND activo = true
    LIMIT 1
  `);

  const tipoDoc = tipoRows[0];
  if (!tipoDoc) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Tipo de documento '${tipoDocCodigo}' no existe o está inactivo.`,
    });
  }

  // Fase 6: aplicar override por establecimiento si está disponible.
  // - obligatorio_override=false → bypass total (devuelve array vacío)
  // - depende_de_override !== null → reemplaza el depende_de global
  // - sin override → usa el depende_de global del catálogo
  let dependencias = tipoDoc.depende_de ?? [];
  if (establecimientoId !== undefined) {
    const override = await tx.$queryRaw<
      { obligatorio_override: boolean | null; depende_de_override: string[] | null }[]
    >(Prisma.sql`
      SELECT obligatorio_override, depende_de_override
      FROM ece.tipo_documento_establecimiento
      WHERE tipo_documento_id = ${tipoDoc.id}::uuid
        AND establecimiento_id = ${establecimientoId}::uuid
      LIMIT 1
    `);

    if (override.length > 0) {
      const o = override[0]!;
      if (o.obligatorio_override === false) return;
      if (o.depende_de_override !== null) dependencias = o.depende_de_override;
    }
  }

  if (dependencias.length === 0) return;

  // 2. Para cada CODIGO en depende_de, verificar que exista al menos una
  //    instancia firmada en el mismo episodio (o paciente si episodio=null).
  //
  // Una sola query agregada: devuelve solo los códigos que NO tienen instancia
  // firmada. Si el resultado está vacío, todo OK.
  //
  // Scoping: si episodioId es null → buscar por paciente_id (documentos maestros).
  //          si episodioId !== null → buscar por episodio_id Y paciente_id.
  const pendientes = await tx.$queryRaw<DependenciaPendienteRow[]>(Prisma.sql`
    SELECT td.codigo AS codigo_dependencia, td.nombre AS nombre_dependencia
    FROM ece.tipo_documento td
    WHERE td.codigo = ANY(${dependencias}::text[])
      AND td.activo = true
      AND NOT EXISTS (
        SELECT 1
        FROM ece.documento_instancia di
        JOIN ece.flujo_estado fe ON fe.id = di.estado_actual_id
        WHERE di.tipo_documento_id = td.id
          AND di.paciente_id = ${pacienteId}::uuid
          AND di.estado_registro = 'vigente'
          AND (
            fe.es_final = true
            OR fe.codigo IN ('firmado', 'validado', 'certificado')
          )
          AND (
            ${episodioId}::uuid IS NULL
            OR di.episodio_id = ${episodioId}::uuid
          )
      )
    ORDER BY td.codigo
  `);

  if (pendientes.length === 0) return;

  // 3. Construir mensaje de error con la lista completa.
  const lista = pendientes
    .map((p) => `${p.codigo_dependencia} (${p.nombre_dependencia})`)
    .join(", ");

  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `No se puede crear '${tipoDocCodigo}': faltan ${pendientes.length} ` +
      `dependencia(s) firmada(s) en este ${episodioId ? "episodio" : "paciente"}: ${lista}.`,
    cause: {
      tipoDocCodigo,
      episodioId,
      pacienteId,
      dependenciasFaltantes: pendientes.map((p) => p.codigo_dependencia),
    },
  });
}

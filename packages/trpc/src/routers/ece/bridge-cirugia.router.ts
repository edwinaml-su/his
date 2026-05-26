/**
 * Bridge Orden Quirúrgica (Fase 2 — ECE — Quirófano).
 *
 * Flujo atómico `programarCirugia`:
 *   1. Valida disponibilidad de sala QX (sin overlap de cirugías activas)
 *   2. Crea ece.orden_ingreso (motivo=cirugía)
 *   3. Crea ece.episodio_atencion (modalidad=hospitalario)
 *   4. Crea ece.episodio_hospitalario (linked al episodio)
 *   5. Crea ece.preop_checklist (estado=borrador)
 *   6. Crea ece.reserva_sala_qx (vincula sala, cirujano, anestesiólogo y horario)
 *   → emite ece.cirugia.programada en outbox
 *
 * `cancelarPrograma`:
 *   cascade soft-delete atómico:
 *   1. Cancela reserva_sala_qx (estado=cancelado)
 *   2. Cancela preop_checklist (estado=cancelado)
 *   3. Cierra episodio_atencion (estado=cancelado)
 *   4. Cancela orden_ingreso (estado_registro=cancelado)
 *   → emite ece.cirugia.cancelada en outbox
 *
 * Invariantes:
 *   - Sala QX libre: no debe haber reserva activa con overlap de horario.
 *   - Un paciente puede tener varias cirugías programadas (distintos episodios).
 *   - Toda escritura usa raw SQL (ece.* fuera del schema Prisma principal).
 *   - HE-02 (audit Stream E, 2026-05-19) — `programarCirugia` y
 *     `cancelarPrograma` se envuelven en `withWorkflowContext` para que las
 *     policies RLS de ece.* apliquen. Antes el comentario indicaba "tx Prisma
 *     garantiza atomicidad" pero el rol postgres tiene BYPASSRLS — defensa
 *     solo en JS, frágil ante data corruption en personal_salud.
 *
 * Roles:
 *   programarCirugia  → requireRole(["PHYSICIAN", "ADM"])
 *   listProgramacionDia → requireRole(["PHYSICIAN", "NURSE", "ADM"])
 *   cancelarPrograma  → requireRole(["PHYSICIAN", "ADM"])
 *
 * @QA E2E: flujo completo: programarCirugia → verificar reserva + episodio + preop
 *   en BD; intentar doble-reserva misma sala mismo horario → CONFLICT;
 *   cancelarPrograma → verificar cascade soft-delete.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitDomainEvent } from "@his/database";
import { router, requireRole, tenantProcedure } from "../../trpc";
import { withWorkflowContext } from "../../workflow/context";

// =============================================================================
// Schemas Zod (inline — patrón establecido en bridge-admision.router.ts)
// =============================================================================

const programarCirugiaInput = z.object({
  pacienteId: z.string().uuid(),
  procedimientoCie10: z.string().trim().min(1).max(20),
  fechaProgramada: z.string().datetime({ offset: true }),
  cirujanoId: z.string().uuid(),
  anestesiologoId: z.string().uuid(),
  salaQxId: z.string().uuid(),
  duracionEstimadaMin: z.number().int().min(1).max(1440),
  motivoIngreso: z.string().trim().min(1).max(2000).optional(),
});

const listProgramacionDiaInput = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD requerido"),
  salaQxId: z.string().uuid().optional(),
});

const cancelarProgramaInput = z.object({
  ordenId: z.string().uuid(),
  motivo: z.string().trim().min(1).max(1000),
});

// =============================================================================
// Tipos para filas raw SQL
// =============================================================================

type IdRow = { id: string };

type PersonalSaludRow = {
  id: string;
  nombre_completo: string;
  establecimiento_id: string;
};

type ReservaOverlapRow = { id: string };

type OrdenQxRow = {
  id: string;
  paciente_id: string;
  episodio_id: string | null;
  estado_registro: string;
  reserva_sala_qx_id: string | null;
};

type ProgramacionRow = {
  orden_id: string;
  fecha_programada: Date;
  duracion_min: number;
  procedimiento_cie10: string;
  paciente_nombre: string;
  cirujano_nombre: string;
  anestesiologo_nombre: string | null;
  sala_nombre: string;
  estado: string;
  preop_checklist_id: string | null;
};

type RawClient = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown>;
};

// =============================================================================
// Helpers SQL
// =============================================================================

async function findPersonalSaludPorAuthUser(
  prisma: RawClient,
  authUserId: string,
): Promise<PersonalSaludRow | null> {
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<PersonalSaludRow[]>)`
    SELECT id, nombre_completo, establecimiento_id
    FROM ece.personal_salud
    WHERE auth_user_id = ${authUserId}::uuid
      AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Verifica que la sala QX no tenga reservas activas que se superpongan
 * con el intervalo [fechaInicio, fechaFin). Una reserva se considera
 * activa si estado ∈ {'programado', 'confirmado', 'en_curso'}.
 *
 * Overlap: reserva.fecha_inicio < nuevaFin AND reserva.fecha_fin > nuevaInicio
 */
async function detectarConflictoSala(
  prisma: RawClient,
  salaQxId: string,
  fechaInicio: Date,
  fechaFin: Date,
  excluirOrdenId?: string,
): Promise<boolean> {
  let rows: ReservaOverlapRow[];
  if (excluirOrdenId) {
    rows = await (prisma.$queryRaw as (
      tpl: TemplateStringsArray,
      ...vals: unknown[]
    ) => Promise<ReservaOverlapRow[]>)`
      SELECT r.id
      FROM ece.reserva_sala_qx r
      WHERE r.sala_qx_id = ${salaQxId}::uuid
        AND r.estado IN ('programado', 'confirmado', 'en_curso')
        AND r.orden_qx_id <> ${excluirOrdenId}::uuid
        AND r.fecha_inicio < ${fechaFin}::timestamptz
        AND r.fecha_fin > ${fechaInicio}::timestamptz
      LIMIT 1
    `;
  } else {
    rows = await (prisma.$queryRaw as (
      tpl: TemplateStringsArray,
      ...vals: unknown[]
    ) => Promise<ReservaOverlapRow[]>)`
      SELECT r.id
      FROM ece.reserva_sala_qx r
      WHERE r.sala_qx_id = ${salaQxId}::uuid
        AND r.estado IN ('programado', 'confirmado', 'en_curso')
        AND r.fecha_inicio < ${fechaFin}::timestamptz
        AND r.fecha_fin > ${fechaInicio}::timestamptz
      LIMIT 1
    `;
  }
  return rows.length > 0;
}

async function findOrdenQx(
  prisma: RawClient,
  ordenId: string,
): Promise<OrdenQxRow | null> {
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<OrdenQxRow[]>)`
    SELECT id, paciente_id, episodio_id, estado_registro, reserva_sala_qx_id
    FROM ece.orden_ingreso
    WHERE id = ${ordenId}::uuid
      AND motivo_ingreso_tipo = 'cirugia'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// Router
// =============================================================================

const qxWriteProcedure = requireRole(["PHYSICIAN", "ADM"]);
const qxReadProcedure  = requireRole(["PHYSICIAN", "NURSE", "ADM"]);

export const eceBridgeCirugiaRouter = router({
  /**
   * Programa una cirugía: crea orden_ingreso (motivo=cirugía) + episodio +
   * episodio_hospitalario + preop_checklist + reserva de sala QX.
   * Transacción atómica — si falla cualquier paso, rollback total.
   */
  programarCirugia: qxWriteProcedure
    .input(programarCirugiaInput)
    .mutation(async ({ ctx, input }) => {
      // ── 1. Resolver personal ECE del usuario en sesión ──────────────────
      const personal = await findPersonalSaludPorAuthUser(ctx.prisma, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El usuario no tiene registro en ece.personal_salud activo. " +
            "Contacte al administrador del ECE.",
        });
      }

      const fechaInicio = new Date(input.fechaProgramada);
      const fechaFin    = new Date(fechaInicio.getTime() + input.duracionEstimadaMin * 60_000);

      // ── 2. Verificar disponibilidad de sala QX (pre-tx) ────────────────
      const hayConflicto = await detectarConflictoSala(
        ctx.prisma as unknown as RawClient,
        input.salaQxId,
        fechaInicio,
        fechaFin,
      );
      if (hayConflicto) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "La sala QX ya tiene una cirugía activa en ese intervalo horario.",
        });
      }

      // ── 3. Transacción atómica con contexto ECE ─────────────────────────
      // HE-02 (audit Stream E): withWorkflowContext aplica SET LOCAL ROLE
      // authenticated + GUCs ece (personal_id, establecimiento_id) → las
      // policies RLS de ece.orden_ingreso/episodio/preop_checklist se aplican.
      // Antes se usaba ctx.prisma.$transaction directo, que mantiene el rol
      // postgres.<ref> con BYPASSRLS — defensa solo en JS, frágil.
      return withWorkflowContext(
        ctx.prisma,
        { personalId: personal.id, establecimientoId: personal.establecimiento_id },
        async (tx) => {
        const rawTx = tx as unknown as RawClient;

        // Paso 1: orden_ingreso (motivo=cirugía)
        const motivoTexto = input.motivoIngreso ?? `Procedimiento CIE-10: ${input.procedimientoCie10}`;
        const ordenRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          INSERT INTO ece.orden_ingreso (
            paciente_id,
            establecimiento_id,
            motivo_ingreso,
            motivo_ingreso_tipo,
            procedimiento_cie10,
            circunstancia_ingreso,
            procedencia,
            modalidad,
            estado_registro,
            fecha_hora_orden,
            medico_ordena,
            registrado_en
          ) VALUES (
            ${input.pacienteId}::uuid,
            ${personal.establecimiento_id}::uuid,
            ${motivoTexto},
            'cirugia',
            ${input.procedimientoCie10},
            'programada',
            'interno',
            'hospitalario',
            'borrador',
            ${fechaInicio}::timestamptz,
            ${personal.id}::uuid,
            now()
          )
          RETURNING id
        `;
        const ordenId = ordenRows[0]?.id;
        if (!ordenId) throw new Error("No se pudo crear orden_ingreso.");

        // Paso 2: episodio_atencion
        const episodioRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          INSERT INTO ece.episodio_atencion (
            paciente_id,
            establecimiento_id,
            modalidad,
            servicio_categoria,
            motivo,
            fecha_hora_inicio,
            estado,
            creado_en
          ) VALUES (
            ${input.pacienteId}::uuid,
            ${personal.establecimiento_id}::uuid,
            'hospitalario',
            'cirugia',
            ${motivoTexto},
            ${fechaInicio}::timestamptz,
            'programado',
            now()
          )
          RETURNING id
        `;
        const episodioId = episodioRows[0]?.id;
        if (!episodioId) throw new Error("No se pudo crear episodio_atencion.");

        // Paso 3: episodio_hospitalario
        await (rawTx.$executeRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<number>)`
          INSERT INTO ece.episodio_hospitalario (
            episodio_id,
            circunstancia_ingreso,
            procedencia_ingreso,
            modalidad_hospitalaria,
            fecha_hora_orden_ingreso,
            servicio_ingreso_id
          ) VALUES (
            ${episodioId}::uuid,
            'programada',
            'interno',
            'hospitalario',
            ${fechaInicio}::timestamptz,
            NULL
          )
        `;

        // Paso 4: actualizar orden_ingreso con episodio_id
        await (rawTx.$executeRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<number>)`
          UPDATE ece.orden_ingreso
          SET episodio_id = ${episodioId}::uuid
          WHERE id = ${ordenId}::uuid
        `;

        // Paso 5a: resolver tipo_documento PREOP_CHECK y su estado inicial
        // (HE-11: preop_checklist requiere instancia_id FK a documento_instancia)
        const preOpTipoRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<Array<{ tipo_doc_id: string; estado_inicial_id: string }>>)`
          SELECT td.id::text AS tipo_doc_id, fe.id::text AS estado_inicial_id
          FROM ece.tipo_documento td
          JOIN ece.flujo_estado fe ON fe.tipo_documento_id = td.id AND fe.es_inicial = true
          WHERE td.codigo = 'PREOP_CHECK'
          LIMIT 1
        `;
        if (preOpTipoRows.length === 0) {
          throw new Error("Tipo de documento PREOP_CHECK no configurado en el catálogo ECE.");
        }
        const { tipo_doc_id: preOpTipoId, estado_inicial_id: preOpEstadoId } = preOpTipoRows[0]!;

        // Paso 5b: crear documento_instancia para el checklist
        // episodio_id de documento_instancia referencia episodio_atencion.id (HE-13)
        const preOpInstanciaRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          INSERT INTO ece.documento_instancia
            (tipo_documento_id, episodio_id, paciente_id, estado_actual_id, creado_por)
          VALUES (
            ${preOpTipoId}::uuid,
            ${episodioId}::uuid,
            ${input.pacienteId}::uuid,
            ${preOpEstadoId}::uuid,
            ${personal.id}::uuid
          )
          RETURNING id::text
        `;
        const preOpInstanciaId = preOpInstanciaRows[0]?.id;
        if (!preOpInstanciaId) throw new Error("No se pudo crear documento_instancia para preop_checklist.");

        // Paso 5c: insertar preop_checklist con columnas reales
        // episodio_hospitalario_id = episodioId (PK de episodio_hospitalario es episodio_id = episodioId)
        const preOpRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          INSERT INTO ece.preop_checklist (
            instancia_id,
            episodio_hospitalario_id,
            registrado_por
          ) VALUES (
            ${preOpInstanciaId}::uuid,
            ${episodioId}::uuid,
            ${personal.id}::uuid
          )
          RETURNING id::text
        `;
        const preOpId = preOpRows[0]?.id;
        if (!preOpId) throw new Error("No se pudo crear preop_checklist.");

        // Paso 6: reserva_sala_qx
        const reservaRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          INSERT INTO ece.reserva_sala_qx (
            orden_qx_id,
            episodio_id,
            sala_qx_id,
            cirujano_id,
            anestesiologo_id,
            fecha_inicio,
            fecha_fin,
            duracion_estimada_min,
            procedimiento_cie10,
            estado,
            reservado_por,
            reservado_en
          ) VALUES (
            ${ordenId}::uuid,
            ${episodioId}::uuid,
            ${input.salaQxId}::uuid,
            ${input.cirujanoId}::uuid,
            ${input.anestesiologoId}::uuid,
            ${fechaInicio}::timestamptz,
            ${fechaFin}::timestamptz,
            ${input.duracionEstimadaMin},
            ${input.procedimientoCie10},
            'programado',
            ${personal.id}::uuid,
            now()
          )
          RETURNING id
        `;
        const reservaId = reservaRows[0]?.id;
        if (!reservaId) throw new Error("No se pudo crear reserva_sala_qx.");

        // Paso 7: vincular reserva en orden_ingreso
        await (rawTx.$executeRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<number>)`
          UPDATE ece.orden_ingreso
          SET reserva_sala_qx_id = ${reservaId}::uuid
          WHERE id = ${ordenId}::uuid
        `;

        // Paso 8: outbox — ece.cirugia.programada
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.cirugia.programada",
          aggregateType: "EceCirugiaProgramada",
          aggregateId: ordenId,
          emittedById: ctx.user.id,
          payload: {
            ordenId,
            episodioId,
            preOpId,
            reservaId,
            pacienteId: input.pacienteId,
            salaQxId: input.salaQxId,
            cirujanoId: input.cirujanoId,
            anestesiologoId: input.anestesiologoId,
            procedimientoCie10: input.procedimientoCie10,
            fechaProgramada: fechaInicio.toISOString(),
            duracionEstimadaMin: input.duracionEstimadaMin,
            organizationId: ctx.tenant.organizationId,
          },
        });

        return { ordenId, episodioId, preOpId, reservaId };
        },
      );
    }),

  /**
   * Cronograma del día: lista cirugías ordenadas por hora de inicio.
   * Filtra opcionalmente por sala QX.
   */
  listProgramacionDia: qxReadProcedure
    .input(listProgramacionDiaInput)
    .query(async ({ ctx, input }) => {
      const diaInicio = new Date(`${input.fecha}T00:00:00Z`);
      const diaFin    = new Date(`${input.fecha}T23:59:59.999Z`);

      let rows: ProgramacionRow[];

      if (input.salaQxId) {
        rows = await (ctx.prisma.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<ProgramacionRow[]>)`
          SELECT
            r.orden_qx_id      AS orden_id,
            r.fecha_inicio     AS fecha_programada,
            r.duracion_estimada_min AS duracion_min,
            r.procedimiento_cie10,
            p.nombre_completo  AS paciente_nombre,
            c.nombre_completo  AS cirujano_nombre,
            a.nombre_completo  AS anestesiologo_nombre,
            s.nombre           AS sala_nombre,
            r.estado,
            pc.id              AS preop_checklist_id
          FROM ece.reserva_sala_qx r
          JOIN ece.paciente p       ON p.id = r.episodio_id  -- JOIN via episodio
          -- El paciente se resuelve por la orden_ingreso
          JOIN ece.orden_ingreso oi ON oi.id = r.orden_qx_id
          JOIN ece.paciente pac     ON pac.id = oi.paciente_id
          JOIN ece.personal_salud c ON c.id = r.cirujano_id
          LEFT JOIN ece.personal_salud a ON a.id = r.anestesiologo_id
          JOIN ece.sala_qx s        ON s.id = r.sala_qx_id
          LEFT JOIN ece.preop_checklist pc ON pc.orden_id = r.orden_qx_id
          WHERE r.sala_qx_id = ${input.salaQxId}::uuid
            AND r.fecha_inicio >= ${diaInicio}::timestamptz
            AND r.fecha_inicio <= ${diaFin}::timestamptz
            AND r.estado <> 'cancelado'
          ORDER BY r.fecha_inicio ASC
        `;
      } else {
        rows = await (ctx.prisma.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<ProgramacionRow[]>)`
          SELECT
            r.orden_qx_id      AS orden_id,
            r.fecha_inicio     AS fecha_programada,
            r.duracion_estimada_min AS duracion_min,
            r.procedimiento_cie10,
            pac.nombre_completo AS paciente_nombre,
            c.nombre_completo   AS cirujano_nombre,
            a.nombre_completo   AS anestesiologo_nombre,
            s.nombre            AS sala_nombre,
            r.estado,
            pc.id               AS preop_checklist_id
          FROM ece.reserva_sala_qx r
          JOIN ece.orden_ingreso oi ON oi.id = r.orden_qx_id
          JOIN ece.paciente pac     ON pac.id = oi.paciente_id
          JOIN ece.personal_salud c ON c.id = r.cirujano_id
          LEFT JOIN ece.personal_salud a ON a.id = r.anestesiologo_id
          JOIN ece.sala_qx s        ON s.id = r.sala_qx_id
          LEFT JOIN ece.preop_checklist pc ON pc.orden_id = r.orden_qx_id
          WHERE r.fecha_inicio >= ${diaInicio}::timestamptz
            AND r.fecha_inicio <= ${diaFin}::timestamptz
            AND r.estado <> 'cancelado'
          ORDER BY r.sala_qx_id, r.fecha_inicio ASC
        `;
      }

      return rows.map((row) => ({
        ordenId:           row.orden_id,
        fechaProgramada:   row.fecha_programada.toISOString(),
        duracionMin:       row.duracion_min,
        procedimientoCie10: row.procedimiento_cie10,
        pacienteNombre:    row.paciente_nombre,
        cirujanoNombre:    row.cirujano_nombre,
        anestesiologoNombre: row.anestesiologo_nombre ?? null,
        salaNombre:        row.sala_nombre,
        estado:            row.estado,
        preOpChecklistId:  row.preop_checklist_id ?? null,
      }));
    }),

  /**
   * Cancela una cirugía programada con cascade soft-delete atómico:
   * reserva → preop_checklist → episodio_atencion → orden_ingreso.
   * Solo permite cancelar si estado ∈ {'programado', 'confirmado'}.
   */
  cancelarPrograma: qxWriteProcedure
    .input(cancelarProgramaInput)
    .mutation(async ({ ctx, input }) => {
      // ── 1. Resolver personal ECE ─────────────────────────────────────────
      const personal = await findPersonalSaludPorAuthUser(ctx.prisma, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El usuario no tiene registro en ece.personal_salud activo.",
        });
      }

      // ── 2. Verificar que la orden existe y es cancelable ─────────────────
      const orden = await findOrdenQx(ctx.prisma as unknown as RawClient, input.ordenId);
      if (!orden) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden quirúrgica no encontrada.",
        });
      }
      if (!["borrador", "validado", "programado", "confirmado"].includes(orden.estado_registro)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `La orden en estado '${orden.estado_registro}' no puede cancelarse.`,
        });
      }

      // ── 3. Transacción atómica cascade soft-delete con contexto ECE ──────
      // HE-02 (audit Stream E): withWorkflowContext aplica RLS al cascade.
      return withWorkflowContext(
        ctx.prisma,
        { personalId: personal.id, establecimientoId: personal.establecimiento_id },
        async (tx) => {
        const rawTx = tx as unknown as RawClient;

        // Paso 1: cancelar reserva_sala_qx
        if (orden.reserva_sala_qx_id) {
          await (rawTx.$executeRaw as (
            tpl: TemplateStringsArray,
            ...vals: unknown[]
          ) => Promise<number>)`
            UPDATE ece.reserva_sala_qx
            SET estado = 'cancelado',
                motivo_cancelacion = ${input.motivo},
                cancelado_en = now(),
                cancelado_por = ${personal.id}::uuid
            WHERE id = ${orden.reserva_sala_qx_id}::uuid
          `;
        }

        // Paso 2: cancelar preop_checklist
        // Se filtra por episodio_hospitalario_id (no existe orden_id ni columna estado;
        // el campo correcto es estado_registro — HE-11 fix).
        if (orden.episodio_id) {
          await (rawTx.$executeRaw as (
            tpl: TemplateStringsArray,
            ...vals: unknown[]
          ) => Promise<number>)`
            UPDATE ece.preop_checklist
            SET estado_registro = 'cancelado'
            WHERE episodio_hospitalario_id = ${orden.episodio_id}::uuid
              AND estado_registro <> 'firmado'
          `;
        }

        // Paso 3: cerrar episodio_atencion si existe
        if (orden.episodio_id) {
          await (rawTx.$executeRaw as (
            tpl: TemplateStringsArray,
            ...vals: unknown[]
          ) => Promise<number>)`
            UPDATE ece.episodio_atencion
            SET estado = 'cancelado',
                fecha_hora_fin = now()
            WHERE id = ${orden.episodio_id}::uuid
          `;
        }

        // Paso 4: cancelar orden_ingreso
        await (rawTx.$executeRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<number>)`
          UPDATE ece.orden_ingreso
          SET estado_registro = 'cancelado',
              motivo_cancelacion = ${input.motivo}
          WHERE id = ${input.ordenId}::uuid
        `;

        // Paso 5: outbox — ece.cirugia.cancelada
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.cirugia.cancelada",
          aggregateType: "EceCirugiaProgramada",
          aggregateId: input.ordenId,
          emittedById: ctx.user.id,
          payload: {
            ordenId: input.ordenId,
            episodioId: orden.episodio_id ?? null,
            motivo: input.motivo,
            canceladoPorId: personal.id,
            organizationId: ctx.tenant.organizationId,
          },
        });

        return { ok: true as const, ordenId: input.ordenId };
        },
      );
    }),
});

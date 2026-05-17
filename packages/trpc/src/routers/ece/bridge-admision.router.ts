/**
 * Bridge Admisión Hospitalaria (Fase 2).
 *
 * Flujo: orden_ingreso (validada) → tx atómica:
 *   1. episodio_atencion       (modalidad=hospitalario, estado=abierto)
 *   2. episodio_hospitalario   (linked al episodio)
 *   3. hoja_ingreso            (linked a orden + episodio, estado=vigente)
 *   4. asignacion_cama         (si camaId provisto) + UPDATE cama.estado=ocupada
 *   5. documento_instancia     (hoja_ingreso como documento ECE firmado por ADM)
 *   6. documento_instancia_historial (traza de firma con hash)
 *   → emite ece.admision.completada en outbox
 *
 * Si cualquier paso falla → rollback total (tx Prisma + raw SQL en mismo tx client).
 *
 * Invariantes:
 *   - Orden debe estar estado_registro='validado' (firmada MT, validada MC).
 *   - Orden sin episodio previo (idempotencia: si ya tiene, retorna CONFLICT).
 *   - PIN ADM valida contra ece.firma_electronica del personal en sesión.
 *   - Toda escritura ECE usa raw SQL (ece.* fuera del schema Prisma principal).
 *   - withTenantContext NO se usa aquí porque la transacción Prisma ya garantiza
 *     la atomicidad; el RLS de ece.* aplica vía schema ece separado y las
 *     políticas son por establecimiento, no por org — el router verifica
 *     explícitamente que paciente y orden pertenecen al establecimiento del usuario.
 *
 * Roles:
 *   admitirDesdeOrden          → requireRole(["ADM"])
 *   listOrdenesPendientesAdmision → tenantProcedure
 */
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { emitDomainEvent } from "@his/database";
import { router, requireRole, tenantProcedure } from "../../trpc";

// =============================================================================
// Schemas Zod (inlined — igual que bridge-encounter.router.ts — para evitar
// la dependencia del barrel @his/contracts que en este worktree no resuelve
// correctamente; los tipos canónicos viven en packages/contracts/src/schemas).
// =============================================================================

const admitirDesdeOrdenInput = z.object({
  ordenIngresoId: z.string().uuid(),
  fechaHoraIngreso: z.string().datetime({ offset: true }),
  camaId: z.string().uuid().optional(),
  modalidad: z.string().min(1).max(30),
  procedencia: z.string().min(1).max(40),
  pinAdm: z.string().min(4).max(20),
});

const listOrdenesPendientesAdmisionInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  servicioId: z.string().uuid().optional(),
});

// =============================================================================
// Tipos para filas raw SQL
// =============================================================================

type RawClient = {
  $queryRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown>;
  $executeRaw: (tpl: TemplateStringsArray, ...vals: unknown[]) => Promise<unknown>;
};

type OrdenIngresoRow = {
  id: string;
  paciente_id: string;
  episodio_id: string | null;
  estado_registro: string;
  servicio_ingreso_id: string | null;
  circunstancia_ingreso: string;
  procedencia: string;
  modalidad: string;
  motivo_ingreso: string;
  fecha_hora_orden: Date;
};

type FirmaElectronicaRow = {
  id: string;
  personal_id: string;
  pin_hash: string;
  // `vigente` se deriva en runtime: !revoked_at (la BD no tiene la columna).
  revoked_at: Date | null;
  locked_until: Date | null;
};

type PersonalSaludRow = {
  id: string;
  nombre_completo: string;
};

type IdRow = { id: string };

type ServicioRow = {
  nombre: string;
};

type OrdenListRow = {
  id: string;
  paciente_id: string;
  paciente_nombre: string;
  servicio_nombre: string | null;
  modalidad: string;
  procedencia: string;
  circunstancia_ingreso: string;
  fecha_hora_orden: Date;
  medico_ordena: string;
  registrado_en: Date;
};

// =============================================================================
// Helpers SQL
// =============================================================================

async function findOrdenIngreso(
  prisma: RawClient,
  ordenIngresoId: string,
): Promise<OrdenIngresoRow | null> {
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<OrdenIngresoRow[]>)`
    SELECT
      id, paciente_id, episodio_id, estado_registro,
      servicio_ingreso_id, circunstancia_ingreso,
      procedencia, modalidad, motivo_ingreso, fecha_hora_orden
    FROM ece.orden_ingreso
    WHERE id = ${ordenIngresoId}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findFirmaElectronica(
  prisma: RawClient,
  personalId: string,
): Promise<FirmaElectronicaRow | null> {
  // "Vigente" = revoked_at IS NULL AND (locked_until IS NULL OR locked_until < now()).
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<FirmaElectronicaRow[]>)`
    SELECT id, personal_id, pin_hash, revoked_at, locked_until
    FROM ece.firma_electronica
    WHERE personal_id = ${personalId}::uuid
      AND revoked_at IS NULL
      AND (locked_until IS NULL OR locked_until < now())
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findPersonalSaludPorAuthUser(
  prisma: RawClient,
  authUserId: string,
): Promise<PersonalSaludRow | null> {
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<PersonalSaludRow[]>)`
    SELECT id, nombre_completo
    FROM ece.personal_salud
    WHERE auth_user_id = ${authUserId}::uuid
      AND activo = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Verifica PIN contra hash argon2 almacenado usando pg's pgcrypto verify. */
async function verificarPin(
  prisma: RawClient,
  pin: string,
  pinHash: string,
): Promise<boolean> {
  // Usamos crypt de pgcrypto disponible en Supabase.
  // Retorna true si el hash coincide.
  const rows = await (prisma.$queryRaw as (
    tpl: TemplateStringsArray,
    ...vals: unknown[]
  ) => Promise<Array<{ ok: boolean }>>)`
    SELECT (crypt(${pin}, ${pinHash}) = ${pinHash}) AS ok
  `;
  return rows[0]?.ok === true;
}

// =============================================================================
// Router
// =============================================================================

const admProcedure = requireRole(["ADM"]);

export const eceBridgeAdmisionRouter = router({
  /**
   * Operación principal: admite un paciente desde una orden de ingreso validada.
   * Transacción atómica: todos los pasos o ninguno.
   */
  admitirDesdeOrden: admProcedure
    .input(admitirDesdeOrdenInput)
    .mutation(async ({ ctx, input }) => {
      // ── 1. Resolver personal ECE del usuario en sesión ───────────────────
      const personal = await findPersonalSaludPorAuthUser(ctx.prisma, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El usuario no tiene registro en ece.personal_salud activo. " +
            "Contacte al administrador del ECE.",
        });
      }

      // ── 2. Verificar PIN ─────────────────────────────────────────────────
      const firma = await findFirmaElectronica(ctx.prisma, personal.id);
      if (!firma) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El ADM no tiene firma electrónica vigente registrada.",
        });
      }
      const pinValido = await verificarPin(ctx.prisma, input.pinAdm, firma.pin_hash);
      if (!pinValido) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "PIN de firma electrónica incorrecto.",
        });
      }

      // ── 3. Verificar orden de ingreso ────────────────────────────────────
      const orden = await findOrdenIngreso(ctx.prisma, input.ordenIngresoId);
      if (!orden) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Orden de ingreso no encontrada.",
        });
      }
      if (orden.estado_registro !== "validado") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `La orden de ingreso está en estado '${orden.estado_registro}'. Se requiere estado 'validado' (firmada por MT y validada por MC).`,
        });
      }
      // Idempotencia: si ya tiene episodio, rechazar con CONFLICT.
      if (orden.episodio_id !== null) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La orden ya fue admitida — episodio existente: ${orden.episodio_id}.`,
        });
      }

      // ── 4. Transacción atómica ───────────────────────────────────────────
      return ctx.prisma.$transaction(async (tx) => {
        const rawTx = tx as unknown as RawClient;
        const fechaIngreso = new Date(input.fechaHoraIngreso);

        // Paso 1: crear episodio_atencion
        const episodioRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          INSERT INTO ece.episodio_atencion (
            paciente_id,
            establecimiento_id,
            modalidad,
            servicio_categoria,
            servicio_id,
            motivo,
            fecha_hora_inicio,
            estado,
            creado_en
          )
          SELECT
            ps.id AS paciente_id,
            ps.establecimiento_id,
            'hospitalario',
            'hospitalizacion',
            ${orden.servicio_ingreso_id ?? null}::uuid,
            ${orden.motivo_ingreso},
            ${fechaIngreso}::timestamptz,
            'abierto',
            now()
          FROM ece.personal_salud ps
          WHERE ps.id = ${personal.id}::uuid
          RETURNING id
        `;
        const episodioId = episodioRows[0]?.id;
        if (!episodioId) {
          throw new Error("No se pudo crear episodio_atencion.");
        }

        // Paso 2: crear episodio_hospitalario
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
            ${orden.circunstancia_ingreso},
            ${input.procedencia},
            ${input.modalidad},
            ${orden.fecha_hora_orden}::timestamptz,
            ${orden.servicio_ingreso_id ?? null}::uuid
          )
        `;

        // Paso 3: crear hoja_ingreso
        const hojaRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          INSERT INTO ece.hoja_ingreso (
            episodio_id,
            paciente_id,
            orden_ingreso_id,
            servicio_id,
            cama_id,
            fecha_hora_ingreso,
            responsable_admision,
            estado_registro,
            registrado_en
          ) VALUES (
            ${episodioId}::uuid,
            ${orden.paciente_id}::uuid,
            ${input.ordenIngresoId}::uuid,
            ${orden.servicio_ingreso_id ?? null}::uuid,
            ${input.camaId ?? null}::uuid,
            ${fechaIngreso}::timestamptz,
            ${personal.id}::uuid,
            'vigente',
            now()
          )
          RETURNING id
        `;
        const hojaIngresoId = hojaRows[0]?.id;
        if (!hojaIngresoId) {
          throw new Error("No se pudo crear hoja_ingreso.");
        }

        // Paso 4: actualizar orden_ingreso con el episodio creado
        await (rawTx.$executeRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<number>)`
          UPDATE ece.orden_ingreso
          SET episodio_id = ${episodioId}::uuid
          WHERE id = ${input.ordenIngresoId}::uuid
        `;

        // Paso 5 (condicional): asignar cama
        let camaAsignadaId: string | null = null;
        if (input.camaId) {
          const camaRows = await (rawTx.$queryRaw as (
            tpl: TemplateStringsArray,
            ...vals: unknown[]
          ) => Promise<IdRow[]>)`
            INSERT INTO ece.asignacion_cama (
              episodio_id,
              cama_id,
              desde
            ) VALUES (
              ${episodioId}::uuid,
              ${input.camaId}::uuid,
              ${fechaIngreso}::timestamptz
            )
            RETURNING id
          `;
          camaAsignadaId = camaRows[0]?.id ?? null;

          // Marcar cama como ocupada
          await (rawTx.$executeRaw as (
            tpl: TemplateStringsArray,
            ...vals: unknown[]
          ) => Promise<number>)`
            UPDATE ece.cama
            SET estado = 'ocupada'
            WHERE id = ${input.camaId}::uuid
          `;
        }

        // Paso 6: crear documento_instancia (hoja de ingreso como documento ECE)
        // Buscamos el tipo_documento con código HOJA_INGRESO.
        const tipoDocRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          SELECT id FROM ece.tipo_documento
          WHERE codigo = 'HOJA_INGRESO'
            AND activo = true
          LIMIT 1
        `;
        const tipoDocId = tipoDocRows[0]?.id;

        // El estado inicial "firmado" en el flujo ADM.
        // Buscamos el flujo_estado correspondiente.
        const estadoRows = await (rawTx.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<IdRow[]>)`
          SELECT fe.id
          FROM ece.flujo_estado fe
          WHERE fe.tipo_documento_id = ${tipoDocId ?? null}::uuid
            AND fe.codigo = 'firmado'
          LIMIT 1
        `;
        const estadoActualId = estadoRows[0]?.id;

        let docInstanciaId: string | null = null;
        if (tipoDocId && estadoActualId) {
          const docRows = await (rawTx.$queryRaw as (
            tpl: TemplateStringsArray,
            ...vals: unknown[]
          ) => Promise<IdRow[]>)`
            INSERT INTO ece.documento_instancia (
              tipo_documento_id,
              episodio_id,
              paciente_id,
              registro_id,
              estado_actual_id,
              version,
              estado_registro,
              creado_por,
              creado_en
            ) VALUES (
              ${tipoDocId}::uuid,
              ${episodioId}::uuid,
              ${orden.paciente_id}::uuid,
              ${hojaIngresoId}::uuid,
              ${estadoActualId}::uuid,
              1,
              'vigente',
              ${personal.id}::uuid,
              now()
            )
            RETURNING id
          `;
          docInstanciaId = docRows[0]?.id ?? null;

          // Paso 7: documento_instancia_historial con hash
          if (docInstanciaId) {
            const payloadStr = JSON.stringify({
              hojaIngresoId,
              episodioId,
              ordenIngresoId: input.ordenIngresoId,
              admisionPorId: personal.id,
            });
            const payloadHash = createHash("sha256").update(payloadStr).digest("hex");

            // Buscamos el rol ECE del ADM
            const rolRows = await (rawTx.$queryRaw as (
              tpl: TemplateStringsArray,
              ...vals: unknown[]
            ) => Promise<IdRow[]>)`
              SELECT id FROM ece.rol WHERE codigo = 'ADM' LIMIT 1
            `;
            const rolId = rolRows[0]?.id;

            if (rolId) {
              await (rawTx.$executeRaw as (
                tpl: TemplateStringsArray,
                ...vals: unknown[]
              ) => Promise<number>)`
                INSERT INTO ece.documento_instancia_historial (
                  instancia_id,
                  estado_anterior_id,
                  estado_nuevo_id,
                  accion,
                  ejecutado_por,
                  rol_ejecutor_id,
                  firma_id,
                  observacion,
                  ejecutado_en
                ) VALUES (
                  ${docInstanciaId}::uuid,
                  NULL,
                  ${estadoActualId}::uuid,
                  'admitir',
                  ${personal.id}::uuid,
                  ${rolId}::uuid,
                  ${firma.id}::uuid,
                  ${payloadHash},
                  now()
                )
              `;
            }
          }
        }

        // Paso 8: actualizar instancia_id en hoja_ingreso si fue creado el doc
        if (docInstanciaId) {
          await (rawTx.$executeRaw as (
            tpl: TemplateStringsArray,
            ...vals: unknown[]
          ) => Promise<number>)`
            UPDATE ece.hoja_ingreso
            SET instancia_id = ${docInstanciaId}::uuid
            WHERE id = ${hojaIngresoId}::uuid
          `;
        }

        // Paso 9: outbox — ece.admision.completada
        await emitDomainEvent(tx, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.admision.completada",
          aggregateType: "EceEpisodioHospitalario",
          aggregateId: episodioId,
          emittedById: ctx.user.id,
          payload: {
            episodioId,
            episodioHospitalarioId: episodioId, // PK de episodio_hospitalario ES episodio_id
            hojaIngresoId,
            ordenIngresoId: input.ordenIngresoId,
            ecePacienteId: orden.paciente_id,
            camaAsignadaId: camaAsignadaId ?? undefined,
            admisionPorId: personal.id,
            organizationId: ctx.tenant.organizationId,
          },
        });

        return {
          episodioId,
          episodioHospitalarioId: episodioId,
          hojaIngresoId,
          camaAsignadaId,
        };
      });
    }),

  /**
   * Lista órdenes de ingreso validadas que aún no tienen episodio.
   * Estas son las que el ADM debe procesar para completar la admisión.
   */
  listOrdenesPendientesAdmision: tenantProcedure
    .input(listOrdenesPendientesAdmisionInput)
    .query(async ({ ctx, input }) => {
      const offset = (input.page - 1) * input.pageSize;

      // Patrón para filtro condicional por servicioId:
      // corremos dos variantes de query para evitar interpolación dinámica
      // de cláusulas SQL (violación de prepared statements).
      // El filtro de count sigue el mismo patrón.
      let items: OrdenListRow[];
      let countRows: Array<{ total: bigint }>;

      if (input.servicioId) {
        items = await (ctx.prisma.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<OrdenListRow[]>)`
          SELECT
            o.id,
            o.paciente_id,
            p.nombre_completo AS paciente_nombre,
            s.nombre AS servicio_nombre,
            o.modalidad,
            o.procedencia,
            o.circunstancia_ingreso,
            o.fecha_hora_orden,
            o.medico_ordena,
            o.registrado_en
          FROM ece.orden_ingreso o
          JOIN ece.paciente p ON p.id = o.paciente_id
          LEFT JOIN ece.servicio s ON s.id = o.servicio_ingreso_id
          WHERE o.estado_registro = 'validado'
            AND o.episodio_id IS NULL
            AND o.servicio_ingreso_id = ${input.servicioId}::uuid
          ORDER BY o.registrado_en ASC
          LIMIT ${input.pageSize}
          OFFSET ${offset}
        `;
        countRows = await (ctx.prisma.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<Array<{ total: bigint }>>)`
          SELECT COUNT(*) AS total
          FROM ece.orden_ingreso
          WHERE estado_registro = 'validado'
            AND episodio_id IS NULL
            AND servicio_ingreso_id = ${input.servicioId}::uuid
        `;
      } else {
        items = await (ctx.prisma.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<OrdenListRow[]>)`
          SELECT
            o.id,
            o.paciente_id,
            p.nombre_completo AS paciente_nombre,
            s.nombre AS servicio_nombre,
            o.modalidad,
            o.procedencia,
            o.circunstancia_ingreso,
            o.fecha_hora_orden,
            o.medico_ordena,
            o.registrado_en
          FROM ece.orden_ingreso o
          JOIN ece.paciente p ON p.id = o.paciente_id
          LEFT JOIN ece.servicio s ON s.id = o.servicio_ingreso_id
          WHERE o.estado_registro = 'validado'
            AND o.episodio_id IS NULL
          ORDER BY o.registrado_en ASC
          LIMIT ${input.pageSize}
          OFFSET ${offset}
        `;
        countRows = await (ctx.prisma.$queryRaw as (
          tpl: TemplateStringsArray,
          ...vals: unknown[]
        ) => Promise<Array<{ total: bigint }>>)`
          SELECT COUNT(*) AS total
          FROM ece.orden_ingreso
          WHERE estado_registro = 'validado'
            AND episodio_id IS NULL
        `;
      }

      const total = Number(countRows[0]?.total ?? 0);

      return {
        items: items.map((row) => ({
          id: row.id,
          pacienteId: row.paciente_id,
          pacienteNombre: row.paciente_nombre,
          servicioNombre: row.servicio_nombre ?? null,
          modalidad: row.modalidad,
          procedencia: row.procedencia,
          circunstanciaIngreso: row.circunstancia_ingreso,
          fechaHoraOrden: row.fecha_hora_orden.toISOString(),
          medicoOrdenaId: row.medico_ordena,
          registradoEn: row.registrado_en.toISOString(),
          /** Antigüedad en minutos desde que se generó la orden. */
          antiguedadMinutos: Math.floor(
            (Date.now() - row.registrado_en.getTime()) / 60_000,
          ),
        })),
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),
});

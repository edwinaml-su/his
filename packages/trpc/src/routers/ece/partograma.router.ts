/**
 * Router tRPC — ECE Partograma OMS (NTEC Doc 14).
 *
 * Tabla física: ece.partograma_registro (raw SQL).
 * FK a ece.documentos_obstetricos.id (Doc 14 existente).
 *
 * Procedures:
 *   ecePartograma.list              — serie temporal por docObstetricoId
 *   ecePartograma.get               — registro individual por id
 *   ecePartograma.registrar         — inserta lectura + calcula alerta OMS
 *   ecePartograma.cerrarPartograma  — marca cierre en documentos_obstetricos
 *   ecePartograma.detectarAlertasOMS — re-calcula alertas de la serie activa
 *
 * Curvas OMS (1994):
 *   Fase activa inicia en 4 cm.
 *   Progreso esperado: 1 cm/hora.
 *   Curva alerta  (t_alerta): hora_inicio_fase_activa + (dilatacion_esperada - 4)
 *   Curva acción  (t_accion): t_alerta + 4 horas
 *   Si t_real > t_accion  → zona_accion  (emite evento ece.partograma.alerta)
 *   Si t_real > t_alerta  → zona_alerta
 *   Else                  → normal
 *
 * Autorización: requireRole(["PHYSICIAN","NURSE","MT"]).
 * RLS Cat-E aplicada vía withTenantContext.
 *
 * Outbox: emite `ece.partograma.alerta` cuando alerta_oms ∈ {zona_alerta, zona_accion}.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";
import { withWorkflowContext, type EceContext } from "../../workflow/context";
import type { PrismaClient } from "@prisma/client";
// Schemas inline — evitan dependencia de symlink en worktree
// (patrón establecido en atencion-emergencia.router.ts)

const POSICION_FETAL = [
  "OIA", "OIP", "ODA", "ODP",
  "OIIA", "OIIP", "ODIA", "ODIP",
  "presentacion_cara", "presentacion_frente", "otro",
] as const;

const INTENSIDAD_CONTRACCION = ["leve", "moderada", "fuerte"] as const;

const partogramaRegistrarSchema = z.object({
  docObstetricoId: z.string().uuid(),
  episodioId: z.string().uuid(),
  registradoEn: z.string().datetime({ offset: true }).optional(),
  dilatacionCm: z.number().min(0).max(10),
  borramientoPct: z.number().int().min(0).max(100).optional(),
  posicionFetal: z.enum(POSICION_FETAL).optional(),
  frecuenciaCardiacaFetal: z.number().int().min(60).max(200).optional(),
  contracciones10min: z.number().int().min(0).max(10).optional(),
  intensidad: z.enum(INTENSIDAD_CONTRACCION).optional(),
  dolorPaciente: z.number().int().min(0).max(10).optional(),
  medicamentos: z.string().max(1_000).optional(),
  observaciones: z.string().max(2_000).optional(),
});

const partogramaListSchema = z.object({ docObstetricoId: z.string().uuid() });
const partogramaGetSchema = z.object({ id: z.string().uuid() });

const partogramaCerrarSchema = z.object({
  docObstetricoId: z.string().uuid(),
  motivoCierre: z
    .enum(["parto_vaginal", "cesarea", "traslado", "alta", "otro"])
    .default("parto_vaginal"),
  observacionCierre: z.string().max(1_000).optional(),
});

export interface PartogramaRegistroRow {
  id: string;
  doc_obstetrico_id: string;
  episodio_id: string;
  registrado_en: Date;
  dilatacion_cm: string;
  borramiento_pct: number | null;
  posicion_fetal: string | null;
  frecuencia_cardiaca_fetal: number | null;
  contracciones_10min: number | null;
  intensidad: string | null;
  dolor_paciente: number | null;
  medicamentos: string | null;
  observaciones: string | null;
  alerta_oms: "normal" | "zona_alerta" | "zona_accion";
  registrado_por: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Helpers de curvas OMS
// ---------------------------------------------------------------------------

/**
 * Dado el primer registro en fase activa (≥4 cm) y un registro actual,
 * determina la zona OMS comparando el tiempo transcurrido con el progreso
 * esperado a 1 cm/hora.
 *
 * @param baseTime  timestamp del primer registro con dilatacion_cm >= 4
 * @param baseDialatacion cm en baseTime
 * @param currentTime  timestamp del registro actual
 * @param currentDialatacion  cm actual
 */
export function calcularAlertaOms(
  baseTime: Date,
  baseDilatacion: number,
  currentTime: Date,
  currentDilatacion: number,
): "normal" | "zona_alerta" | "zona_accion" {
  // Fase latente: sin curvas
  if (currentDilatacion < 4) return "normal";
  // Si no hay base de fase activa registrada aún, normal
  if (baseDilatacion < 4) return "normal";

  const horasTranscurridas =
    (currentTime.getTime() - baseTime.getTime()) / 3_600_000;
  // Dilatación esperada según curva alerta (1 cm/hora desde base)
  const dilatacionEsperadaAlerta = baseDilatacion + horasTranscurridas;
  // Curva acción: 4 horas después de la alerta en horas equivalentes
  const dilatacionEsperadaAccion = baseDilatacion + Math.max(0, horasTranscurridas - 4);

  // Si el progreso real es menor que la curva acción → zona_accion
  if (currentDilatacion < dilatacionEsperadaAccion) return "zona_accion";
  // Si el progreso real es menor que la curva alerta → zona_alerta
  if (currentDilatacion < dilatacionEsperadaAlerta) return "zona_alerta";
  return "normal";
}

// ---------------------------------------------------------------------------
// Resolución de contexto ECE
// ---------------------------------------------------------------------------

function resolveEceCtx(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string };
}): { userId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar el partograma.",
    });
  }
  return {
    userId: ctx.user.id,
    establecimientoId: ctx.tenant.establishmentId,
  };
}

/**
 * HF-06 (audit Stream F): resuelve personal_salud del usuario y devuelve
 * EceContext para envolver queries en `withWorkflowContext`. Sin esto las
 * raw queries se ejecutan como rol bypass-RLS y la defensa en BD no aplica.
 */
async function buildEceCtx(
  prisma: PrismaClient,
  userId: string,
  establecimientoId: string,
): Promise<EceContext> {
  const personalRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ece.personal_salud
    WHERE his_user_id = ${userId}::uuid
    LIMIT 1
  `;
  if (personalRows.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No existe registro de personal de salud para este usuario.",
    });
  }
  return { personalId: personalRows[0]!.id, establecimientoId };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const ecePartogramaRouter = router({
  /** Lista la serie temporal del partograma para un documento obstétrico. */
  list: requireRole(["PHYSICIAN", "NURSE", "MT"]).input(partogramaListSchema).query(
    async ({ ctx, input }) => {
      const { userId, establecimientoId } = resolveEceCtx(ctx);
      const parsed = partogramaListSchema.parse(input);
      const eceCtx = await buildEceCtx(ctx.prisma, userId, establecimientoId);

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        return tx.$queryRaw<PartogramaRegistroRow[]>`
          SELECT pr.*
          FROM ece.partograma_registro pr
          JOIN ece.episodio_atencion ep ON ep.id = pr.episodio_id
          WHERE pr.doc_obstetrico_id = ${parsed.docObstetricoId}::uuid
            AND ep.establecimiento_id = ${establecimientoId}::uuid
          ORDER BY pr.registrado_en ASC
        `;
      });
    },
  ),

  /** Obtiene un registro individual por id. */
  get: requireRole(["PHYSICIAN", "NURSE", "MT"]).input(partogramaGetSchema).query(async ({ ctx, input }) => {
    const { userId, establecimientoId } = resolveEceCtx(ctx);
    const parsed = partogramaGetSchema.parse(input);
    const eceCtx = await buildEceCtx(ctx.prisma, userId, establecimientoId);

    const rows = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      return tx.$queryRaw<PartogramaRegistroRow[]>`
        SELECT pr.*
        FROM ece.partograma_registro pr
        JOIN ece.episodio_atencion ep ON ep.id = pr.episodio_id
        WHERE pr.id = ${parsed.id}::uuid
          AND ep.establecimiento_id = ${establecimientoId}::uuid
        LIMIT 1
      `;
    });

    if (rows.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Registro no encontrado." });
    }
    return rows[0];
  }),

  /** Inserta una nueva lectura y calcula la alerta OMS automáticamente. */
  registrar: requireRole(["PHYSICIAN", "NURSE", "MT"]).input(partogramaRegistrarSchema).mutation(
    async ({ ctx, input }) => {
      const { userId, establecimientoId } = resolveEceCtx(ctx);
      const data = partogramaRegistrarSchema.parse(input);
      const eceCtx = await buildEceCtx(ctx.prisma, userId, establecimientoId);
      const personalId = eceCtx.personalId;

      const currentTime = data.registradoEn ? new Date(data.registradoEn) : new Date();

      const { newId, alertaOms } = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        // Verificar que el episodio pertenece al establecimiento
        const epRows = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM ece.episodio_atencion
          WHERE id = ${data.episodioId}::uuid
            AND establecimiento_id = ${establecimientoId}::uuid
          LIMIT 1
        `;
        if (epRows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Episodio no encontrado en este establecimiento.",
          });
        }

        // Calcular alerta OMS: buscar primer registro en fase activa
        let alerta: "normal" | "zona_alerta" | "zona_accion" = "normal";

        if (data.dilatacionCm >= 4) {
          const baseRows = await tx.$queryRaw<
            { registrado_en: Date; dilatacion_cm: string }[]
          >`
            SELECT registrado_en, dilatacion_cm
            FROM ece.partograma_registro
            WHERE doc_obstetrico_id = ${data.docObstetricoId}::uuid
              AND dilatacion_cm >= 4
            ORDER BY registrado_en ASC
            LIMIT 1
          `;

          if (baseRows.length > 0) {
            const base = baseRows[0]!;
            alerta = calcularAlertaOms(
              base.registrado_en,
              Number(base.dilatacion_cm),
              currentTime,
              data.dilatacionCm,
            );
          }
        }

        const insertRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.partograma_registro (
            doc_obstetrico_id, episodio_id, registrado_en,
            dilatacion_cm, borramiento_pct, posicion_fetal,
            frecuencia_cardiaca_fetal, contracciones_10min, intensidad,
            dolor_paciente, medicamentos, observaciones,
            alerta_oms, registrado_por
          ) VALUES (
            ${data.docObstetricoId}::uuid,
            ${data.episodioId}::uuid,
            ${data.registradoEn ? new Date(data.registradoEn) : new Date()},
            ${data.dilatacionCm},
            ${data.borramientoPct ?? null},
            ${data.posicionFetal ?? null},
            ${data.frecuenciaCardiacaFetal ?? null},
            ${data.contracciones10min ?? null},
            ${data.intensidad ?? null},
            ${data.dolorPaciente ?? null},
            ${data.medicamentos ?? null},
            ${data.observaciones ?? null},
            ${alerta},
            ${personalId}::uuid
          )
          RETURNING id
        `;

        return { newId: insertRows[0]!.id, alertaOms: alerta };
      });

      // Emitir evento fuera de la tx (emitDomainEvent abre la suya propia).
      if (alertaOms !== "normal") {
        await emitDomainEvent(ctx.prisma, {
          organizationId: ctx.tenant.organizationId,
          eventType: "ece.partograma.alerta",
          aggregateType: "PartogramaRegistro",
          aggregateId: newId,
          emittedById: userId,
          payload: {
            partogramaRegistroId: newId,
            docObstetricoId: data.docObstetricoId,
            episodioId: data.episodioId,
            alertaOms,
            dilatacionCm: data.dilatacionCm,
            registradoEn: currentTime.toISOString(),
          },
        });
      }

      return { id: newId, alertaOms };
    },
  ),

  /**
   * Marca el cierre del partograma en documentos_obstetricos
   * actualizando labor_parto JSONB con el motivo de cierre.
   */
  cerrarPartograma: requireRole(["PHYSICIAN", "MT"]).input(partogramaCerrarSchema).mutation(
    async ({ ctx, input }) => {
      const { userId, establecimientoId } = resolveEceCtx(ctx);
      const data = partogramaCerrarSchema.parse(input);
      const eceCtx = await buildEceCtx(ctx.prisma, userId, establecimientoId);

      const rows = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        return tx.$queryRaw<{ id: string }[]>`
          UPDATE ece.documentos_obstetricos
          SET labor_parto = COALESCE(labor_parto, '{}'::jsonb) || ${JSON.stringify({
            cierre: data.motivoCierre,
            observacion_cierre: data.observacionCierre ?? null,
            cerrado_en: new Date().toISOString(),
          })}::jsonb,
              estado_registro = 'vigente'
          WHERE id = ${data.docObstetricoId}::uuid
            AND episodio_id IN (
              SELECT id FROM ece.episodio_atencion
              WHERE establecimiento_id = ${establecimientoId}::uuid
            )
          RETURNING id
        `;
      });

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento obstétrico no encontrado.",
        });
      }

      return { docObstetricoId: rows[0]!.id };
    },
  ),

  /**
   * Re-calcula y devuelve el estado de alerta OMS de toda la serie activa
   * (útil para re-renderizar la UI después de importar datos).
   */
  detectarAlertasOMS: requireRole(["PHYSICIAN", "NURSE", "MT"]).input(partogramaListSchema).query(
    async ({ ctx, input }) => {
      const { userId, establecimientoId } = resolveEceCtx(ctx);
      const parsed = partogramaListSchema.parse(input);
      const eceCtx = await buildEceCtx(ctx.prisma, userId, establecimientoId);

      const rows = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        return tx.$queryRaw<PartogramaRegistroRow[]>`
          SELECT pr.*
          FROM ece.partograma_registro pr
          JOIN ece.episodio_atencion ep ON ep.id = pr.episodio_id
          WHERE pr.doc_obstetrico_id = ${parsed.docObstetricoId}::uuid
            AND ep.establecimiento_id = ${establecimientoId}::uuid
          ORDER BY pr.registrado_en ASC
        `;
      });

      if (rows.length === 0) return { registros: [], hayDistocia: false };

      // Primer registro en fase activa como base OMS
      const baseRow = rows.find((r: PartogramaRegistroRow) => Number(r.dilatacion_cm) >= 4);

      const registros = rows.map((r: PartogramaRegistroRow) => {
        const alerta: "normal" | "zona_alerta" | "zona_accion" =
          baseRow && Number(r.dilatacion_cm) >= 4
            ? calcularAlertaOms(
                baseRow.registrado_en,
                Number(baseRow.dilatacion_cm),
                r.registrado_en,
                Number(r.dilatacion_cm),
              )
            : "normal";
        return { ...r, alerta_oms_calc: alerta };
      });

      const hayDistocia = registros.some(
        (r: { alerta_oms_calc: string }) => r.alerta_oms_calc === "zona_accion",
      );

      return { registros, hayDistocia };
    },
  ),
});

export type EcePartogramaRouter = typeof ecePartogramaRouter;

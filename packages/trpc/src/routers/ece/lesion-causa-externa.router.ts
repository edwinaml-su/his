/**
 * Router tRPC — ECE Lesión de Causa Externa (LCE).
 *
 * Documento: REQ-ECE-LCE-001 (CC-0007). Formulario epidemiológico MINSAL ligado
 * a un episodio de atención. Estados: borrador → firmado.
 *
 * Persistencia: ece.lesion_causa_externa (SQL 185). Se opera con el modelo
 * Prisma `eceLesionCausaExterna` DENTRO de `withEceContext`, que abre la
 * transacción, setea el contexto ECE (GUC) y demota a rol `authenticated` para
 * que las policies RLS apliquen. Multi-selects como text[]; mapa corporal JSON.
 *
 * ROLES:
 *   getByEpisodio → PHYSICIAN, MC, MT, NURSE (lectura clínica)
 *   upsert        → PHYSICIAN, MC, MT
 *   firmar        → PHYSICIAN, MC, MT  (valida ≥1 mecanismo de la lesión)
 */
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { router, requireRole } from "../../trpc";
import { withEceContext } from "../../ece/rls-context";
import {
  lceGetByEpisodioInput,
  lceUpsertInput,
  lceFirmarInput,
  type LceDatos,
} from "@his/contracts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Categoría Glasgow derivada del puntaje total (fuente de verdad servidor). */
function glasgowCategoria(total: number | null | undefined): string | null {
  if (total == null) return null;
  if (total >= 13) return "Leve";
  if (total >= 9) return "Moderado";
  return "Severo";
}

/** Mapea el payload de datos clínicos a columnas de la tabla. */
function datosToColumns(datos: LceDatos) {
  return {
    eventoFechaHora: datos.eventoFechaHora ? new Date(datos.eventoFechaHora) : null,
    discapacidad: datos.discapacidad ?? null,
    tipoEvento: datos.tipoEvento,
    tipoEventoOtro: datos.tipoEventoOtro ?? null,
    lugarDepartamento: datos.lugarDepartamento ?? null,
    lugarMunicipio: datos.lugarMunicipio ?? null,
    lugarDireccion: datos.lugarDireccion ?? null,
    mecanismo: datos.mecanismo,
    mecanismoOtro: datos.mecanismoOtro ?? null,
    mecExplosion: datos.mecExplosion,
    mecFuego: datos.mecFuego,
    mecIntoxicacion: datos.mecIntoxicacion,
    mecIntoxicacionOtro: datos.mecIntoxicacionOtro ?? null,
    mecMordedura: datos.mecMordedura,
    mecMordeduraOtro: datos.mecMordeduraOtro ?? null,
    intencionalidad: datos.intencionalidad,
    intencionalidadOtro: datos.intencionalidadOtro ?? null,
    lugar: datos.lugar,
    lugarOtro: datos.lugarOtro ?? null,
    actividad: datos.actividad,
    actividadOtro: datos.actividadOtro ?? null,
    transporteVictima: datos.transporteVictima,
    transporteVictimaOtro: datos.transporteVictimaOtro ?? null,
    contraparte: datos.contraparte,
    contraparteOtro: datos.contraparteOtro ?? null,
    usuarioVia: datos.usuarioVia,
    tipoAccidente: datos.tipoAccidente,
    tipoAccidenteOtro: datos.tipoAccidenteOtro ?? null,
    violenciaRelacion: datos.violenciaRelacion,
    violenciaRelacionOtro: datos.violenciaRelacionOtro ?? null,
    violenciaContexto: datos.violenciaContexto,
    violenciaContextoOtro: datos.violenciaContextoOtro ?? null,
    violenciaAutoinfligida: datos.violenciaAutoinfligida,
    violenciaAutoinfligidaOtro: datos.violenciaAutoinfligidaOtro ?? null,
    severidad: datos.severidad,
    glasgowTotal: datos.glasgowTotal ?? null,
    glasgowCategoria: glasgowCategoria(datos.glasgowTotal),
    mapaCorporalSitios: datos.mapaCorporalSitios as unknown as Prisma.InputJsonValue,
    diagnosticoNaturaleza: datos.diagnosticoNaturaleza ?? null,
    sitioAnatomico: datos.sitioAnatomico ?? null,
    destino: datos.destino,
  };
}

// ─── Roles ────────────────────────────────────────────────────────────────────

const base = requireRole(["PHYSICIAN", "MC", "MT", "NURSE"]);
const write = requireRole(["PHYSICIAN", "MC", "MT"]);

// ─── Helper de contexto ───────────────────────────────────────────────────────

function resolveEceIds(ctx: {
  user: { id: string };
  tenant: { establishmentId?: string };
}): { personalId: string; establecimientoId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar el formulario LCE.",
    });
  }
  return { personalId: ctx.user.id, establecimientoId: ctx.tenant.establishmentId };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const eceLesionCausaExternaRouter = router({
  /** Devuelve el registro LCE más reciente del episodio (o null). */
  getByEpisodio: base
    .input(lceGetByEpisodioInput)
    .query(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);
      return withEceContext(ctx.prisma, personalId, establecimientoId, (tx) =>
        tx.eceLesionCausaExterna.findFirst({
          where: { episodioId: input.episodioId },
          orderBy: { registradoEn: "desc" },
        }),
      );
    }),

  /**
   * Crea o actualiza el formulario LCE del episodio. Si existe un borrador, lo
   * actualiza; si el último registro está firmado (inmutable), crea uno nuevo.
   */
  upsert: write
    .input(lceUpsertInput)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);
      const columns = datosToColumns(input.datos);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const borrador = await tx.eceLesionCausaExterna.findFirst({
          where: { episodioId: input.episodioId, estadoRegistro: "borrador" },
          orderBy: { registradoEn: "desc" },
          select: { id: true },
        });

        if (borrador) {
          await tx.eceLesionCausaExterna.update({
            where: { id: borrador.id },
            data: { ...columns, registradoEn: new Date() },
          });
          return { id: borrador.id };
        }

        const created = await tx.eceLesionCausaExterna.create({
          data: {
            episodioId: input.episodioId,
            pacienteId: input.pacienteId ?? null,
            registradoPorId: personalId,
            estadoRegistro: "borrador",
            ...columns,
          },
          select: { id: true },
        });
        return { id: created.id };
      });
    }),

  /**
   * Firma el formulario (borrador → firmado). Inmutable post-firma.
   * Valida que exista al menos un mecanismo de la lesión.
   */
  firmar: write
    .input(lceFirmarInput)
    .mutation(async ({ ctx, input }) => {
      const { personalId, establecimientoId } = resolveEceIds(ctx);

      return withEceContext(ctx.prisma, personalId, establecimientoId, async (tx) => {
        const row = await tx.eceLesionCausaExterna.findUnique({
          where: { id: input.id },
          select: {
            estadoRegistro: true,
            mecanismo: true,
            mecExplosion: true,
            mecFuego: true,
            mecIntoxicacion: true,
            mecMordedura: true,
          },
        });

        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Formulario LCE no encontrado." });
        }
        if (row.estadoRegistro !== "borrador") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se pueden firmar formularios en 'borrador'. Estado actual: '${row.estadoRegistro}'.`,
          });
        }

        const tieneMecanismo =
          row.mecanismo.length > 0 ||
          row.mecExplosion.length > 0 ||
          row.mecFuego.length > 0 ||
          row.mecIntoxicacion.length > 0 ||
          row.mecMordedura.length > 0;

        if (!tieneMecanismo) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Debe registrar al menos un mecanismo de la lesión antes de firmar.",
          });
        }

        await tx.eceLesionCausaExterna.update({
          where: { id: input.id },
          data: { estadoRegistro: "firmado", firmadoEn: new Date() },
        });

        return { ok: true as const };
      });
    }),
});

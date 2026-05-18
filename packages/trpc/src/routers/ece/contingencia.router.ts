/**
 * Router tRPC — Contingencia Operativa (US.F2.7.26-28).
 *
 * Norma: NTEC Art. 44 — El establecimiento debe garantizar continuidad
 * de registro durante fallos del sistema mediante formularios en papel.
 * TDR §6.4 — El modo contingencia es declarado por ADM o DIR.
 *
 * Procedures:
 *   activar      → requireRole(["ADM","DIR"]) — abre período de contingencia
 *   desactivar   → requireRole(["ADM","DIR"]) — cierra período, alerta retro
 *   estadoActual → tenantProcedure — devuelve evento activo o null
 *   list         → requireRole(["ADM","DIR"]) — historial paginado
 *   registrarRetroactivo → requireRole(["NURSE","PHYSICIAN","ARCH"]) — US.F2.7.27
 *
 * RLS: withTenantContext en todas las mutations.
 * Tablas: ece.contingencia_evento (nueva). Columnas en tablas ECE:
 *   digitado_retroactivamente, timestamp_real_papel, contingencia_evento_id.
 *
 * @QA E2E: apps/web/e2e/fase2/contingencia.spec.ts
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../../trpc";
import { withTenantContext } from "../../rls-context";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const activarInput = z.object({
  motivo: z.string().min(10, "Motivo mínimo 10 caracteres.").max(1000),
  esperadoHasta: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO-8601 datetime estimado de restauración del sistema."),
});

const desactivarInput = z.object({
  contingenciaEventoId: z.string().uuid("ID de evento inválido."),
});

const listInput = z.object({
  soloActivos: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

const tipoDocumentoEnum = z.enum([
  "signos_vitales",
  "hoja_triaje",
  "indicaciones_medicas",
  "evolucion_medica",
]);

const registrarRetroactivoInput = z.object({
  contingenciaEventoId: z.string().uuid(),
  tipoDocumento: tipoDocumentoEnum,
  encounterId: z.string().uuid().optional().describe("ID del episodio ECE."),
  contenido: z
    .record(z.unknown())
    .describe("Payload del documento según su tipo."),
  timestampRealPapel: z
    .string()
    .datetime({ offset: true })
    .describe("Momento real en que se llenó el formulario en papel."),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Devuelve el evento de contingencia activo para la org, o null. */
async function getEventoActivo(
  tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
  organizationId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      motivo: string;
      esperado_hasta: Date | null;
      activado_en: Date;
      activado_por_id: string;
    }>
  >`
    SELECT id, motivo, esperado_hasta, activado_en, activado_por_id
    FROM ece.contingencia_evento
    WHERE organization_id = ${organizationId}::uuid
      AND desactivado_en IS NULL
    ORDER BY activado_en DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const contingenciaRouter = router({
  /** Activa el modo contingencia. Solo un período activo por org. */
  activar: requireRole(["ADM", "DIR"])
    .input(activarInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Guard: no puede haber dos períodos activos simultáneos.
        const activo = await getEventoActivo(tx, orgId);
        if (activo) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe un período de contingencia activo desde ${activo.activado_en.toISOString()}.`,
          });
        }

        const rows = await tx.$queryRaw<[{ id: string }]>`
          INSERT INTO ece.contingencia_evento
            (organization_id, motivo, esperado_hasta, activado_por_id)
          VALUES (
            ${orgId}::uuid,
            ${input.motivo},
            ${input.esperadoHasta ? new Date(input.esperadoHasta) : null},
            ${userId}::uuid
          )
          RETURNING id
        `;
        return { id: rows[0]!.id };
      });
    }),

  /** Desactiva el período de contingencia activo. */
  desactivar: requireRole(["ADM", "DIR"])
    .input(desactivarInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rows = await tx.$queryRaw<[{ id: string; desactivado_en: Date | null }]>`
          SELECT id, desactivado_en
          FROM ece.contingencia_evento
          WHERE id = ${input.contingenciaEventoId}::uuid
            AND organization_id = ${orgId}::uuid
          LIMIT 1
        `;
        const evento = rows[0];

        if (!evento) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Evento de contingencia no encontrado.",
          });
        }
        if (evento.desactivado_en !== null) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "El período de contingencia ya fue desactivado.",
          });
        }

        await tx.$executeRaw`
          UPDATE ece.contingencia_evento
          SET desactivado_en    = now(),
              desactivado_por_id = ${userId}::uuid
          WHERE id = ${input.contingenciaEventoId}::uuid
        `;
        return { ok: true };
      });
    }),

  /** Estado actual de contingencia de la organización. */
  estadoActual: tenantProcedure.query(async ({ ctx }) => {
    const orgId = ctx.tenant.organizationId;

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const activo = await getEventoActivo(tx, orgId);
      return {
        activo: activo !== null,
        evento: activo,
      };
    });
  }),

  /** Historial de eventos de contingencia de la organización. */
  list: requireRole(["ADM", "DIR"])
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        if (input.soloActivos) {
          const rows = await tx.$queryRaw<
            Array<{
              id: string;
              motivo: string;
              esperado_hasta: Date | null;
              activado_en: Date;
            }>
          >`
            SELECT id, motivo, esperado_hasta, activado_en
            FROM ece.contingencia_evento
            WHERE organization_id = ${orgId}::uuid
              AND desactivado_en IS NULL
            ORDER BY activado_en DESC
            LIMIT ${input.limit} OFFSET ${input.offset}
          `;
          return rows;
        }

        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            motivo: string;
            esperado_hasta: Date | null;
            activado_en: Date;
            desactivado_en: Date | null;
          }>
        >`
          SELECT id, motivo, esperado_hasta, activado_en, desactivado_en
          FROM ece.contingencia_evento
          WHERE organization_id = ${orgId}::uuid
          ORDER BY activado_en DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `;
        return rows;
      });
    }),

  /**
   * US.F2.7.27 — Digitalización retroactiva de registro en papel.
   * Solo válido si existe contingencia_evento cubriendo el timestamp_real_papel.
   * El tipo de documento determina la tabla destino donde se actualiza
   * digitado_retroactivamente = true.
   *
   * Nota: el contenido completo del documento debe persistirse mediante
   * su router nativo (signos-vitales, triaje-ece, etc.).
   * Este endpoint registra el marcador de contingencia en el registro existente.
   */
  registrarRetroactivo: requireRole(["NURSE", "PHYSICIAN", "ARCH"])
    .input(registrarRetroactivoInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Verificar que el evento de contingencia pertenece a la org.
        const eventRows = await tx.$queryRaw<
          Array<{
            id: string;
            activado_en: Date;
            desactivado_en: Date | null;
          }>
        >`
          SELECT id, activado_en, desactivado_en
          FROM ece.contingencia_evento
          WHERE id = ${input.contingenciaEventoId}::uuid
            AND organization_id = ${orgId}::uuid
          LIMIT 1
        `;
        const evento = eventRows[0];
        if (!evento) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Evento de contingencia no encontrado para esta organización.",
          });
        }

        const tsReal = new Date(input.timestampRealPapel);
        const fin = evento.desactivado_en ?? new Date();

        // El timestamp real debe estar dentro del período de contingencia.
        if (tsReal < evento.activado_en || tsReal > fin) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `El timestamp del papel (${tsReal.toISOString()}) está fuera del período de contingencia [${evento.activado_en.toISOString()} - ${fin.toISOString()}].`,
          });
        }

        // Mapa de tipo de documento a nombre de tabla ECE.
        const tablaMap: Record<z.infer<typeof tipoDocumentoEnum>, string> = {
          signos_vitales: "signos_vitales",
          hoja_triaje: "hoja_triaje",
          indicaciones_medicas: "indicaciones_medicas",
          evolucion_medica: "evolucion_medica",
        };
        const tabla = tablaMap[input.tipoDocumento];

        // Obtiene el último registro del episodio en esa tabla (candidato a marcar).
        // El caller debe haber creado el registro primero con el router específico.
        if (!input.encounterId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "encounterId requerido para marcar registro retroactivo.",
          });
        }

        const updateResult = await tx.$executeRaw`
          UPDATE ece.${Prisma.raw(tabla)}
          SET digitado_retroactivamente = true,
              timestamp_real_papel      = ${tsReal},
              contingencia_evento_id    = ${input.contingenciaEventoId}::uuid
          WHERE episodio_id = ${input.encounterId}::uuid
            AND digitado_retroactivamente = false
            AND contingencia_evento_id IS NULL
            AND registrado_en = (
              SELECT MAX(registrado_en)
              FROM ece.${Prisma.raw(tabla)}
              WHERE episodio_id = ${input.encounterId}::uuid
            )
        `;

        if (updateResult === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No se encontró registro reciente sin marcar en ${tabla} para el episodio dado.`,
          });
        }

        return { ok: true, tabla };
      });
    }),
});

// Necesario para Prisma.raw en el raw SQL dinámico.
import { Prisma } from "@prisma/client";

export type ContingenciaRouter = typeof contingenciaRouter;

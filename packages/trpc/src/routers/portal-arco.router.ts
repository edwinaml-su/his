/**
 * F2-S15 Stream C — Portal ARCO (US.F2.7.44-45)
 *
 * Derechos ARCO sobre el expediente clínico:
 *   - crearSolicitud   — paciente crea solicitud RECTIFICACION o SUPRESION.
 *   - listMisSolicitudes — paciente lista sus solicitudes propias.
 *   - listParaRevisar  — DIR/ADM lista solicitudes pendientes de la org.
 *   - responder        — DIR/ADM aprueba o rechaza con motivo.
 *
 * Auth:
 *   - portalProcedure para las acciones del paciente (portalAccount).
 *   - tenantProcedure + requireRole para acciones del director.
 *
 * RLS: portalProcedure usa withPortalContext; tenantProcedure usa withTenantContext.
 * El patientId siempre se deriva de ctx.portalAccount.patientId — nunca del input.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, portalProcedure, requireRole } from "../trpc";
import { withPortalContext, withTenantContext } from "../rls-context";

// ─── Inputs ───────────────────────────────────────────────────────────────────

const tipoArco = z.enum(["RECTIFICACION", "SUPRESION"]);
const estadoArco = z.enum(["PENDIENTE", "APROBADA", "RECHAZADA", "EJECUTADA"]);

const crearSolicitudInput = z.object({
  tipo: tipoArco,
  documentoTarget: z.string().max(200).optional(),
  motivo: z.string().min(20, "El motivo debe tener al menos 20 caracteres.").max(2000),
});

const responderInput = z.object({
  solicitudId: z.string().uuid(),
  decision: z.enum(["APROBADA", "RECHAZADA"]),
  motivoRespuesta: z.string().min(10).max(2000),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const portalArcoRouter = router({
  /**
   * US.F2.7.44-45 — Paciente crea solicitud ARCO desde el portal.
   * El organizationId se resuelve desde el Patient.organizationId del portal account.
   */
  crearSolicitud: portalProcedure
    .input(crearSolicitudInput)
    .mutation(async ({ ctx, input }) => {
      const patientId = ctx.portalAccount.patientId;

      return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
        // K-14 (audit Stream K): lookup del paciente DENTRO del withPortalContext.
        // Si lo hacíamos fuera con ctx.prisma directo (BYPASSRLS), una eventual
        // RLS policy sobre Patient para el portal era bypaseada — defense-in-depth.
        const patient = await tx.patient.findUnique({
          where: { id: patientId },
          select: { organizationId: true },
        });
        if (!patient) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
        }

        const solicitud = await tx.solicitudArco.create({
          data: {
            pacienteId: patientId,
            organizacionId: patient.organizationId,
            tipo: input.tipo,
            documentoTarget: input.documentoTarget ?? null,
            motivo: input.motivo,
            estado: "PENDIENTE",
          },
          select: { id: true, tipo: true, estado: true, creadoEn: true },
        });

        // Emitir evento de dominio para notificar al DIR (outbox pattern)
        await tx.domainEvent.create({
          data: {
            eventType: "arco.solicitud.creada",
            aggregateId: solicitud.id,
            aggregateType: "SolicitudArco",
            payload: {
              solicitudId: solicitud.id,
              tipo: input.tipo,
              patientId,
              organizationId: patient.organizationId,
            },
            organizationId: patient.organizationId,
          },
        });

        return solicitud;
      });
    }),

  /**
   * US.F2.7.43 — Paciente lista sus propias solicitudes ARCO.
   */
  listMisSolicitudes: portalProcedure
    .input(z.object({ estado: estadoArco.optional() }))
    .query(async ({ ctx, input }) => {
      const patientId = ctx.portalAccount.patientId;

      return withPortalContext(ctx.prisma, ctx.portalAccount.id, async (tx) => {
        return tx.solicitudArco.findMany({
          where: {
            pacienteId: patientId,
            ...(input.estado ? { estado: input.estado } : {}),
          },
          select: {
            id: true,
            tipo: true,
            documentoTarget: true,
            motivo: true,
            estado: true,
            fechaRespuesta: true,
            motivoRespuesta: true,
            creadoEn: true,
            actualizadoEn: true,
          },
          orderBy: { creadoEn: "desc" },
          take: 50,
        });
      });
    }),

  /**
   * US.F2.7.44-45 — DIR/ADM lista solicitudes pendientes para revisar.
   *
   * HG-28 (LOPD): envuelto en withTenantContext para que RLS aplique vía rol
   * `authenticated`. Sin esto, el rol Postgres (BYPASSRLS) ignoraba las policies
   * y el filtro JS `organizacionId` era la única barrera tenant — defensa débil.
   */
  listParaRevisar: requireRole(["DIR", "ADM", "ADMIN"]).query(async ({ ctx }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      return tx.solicitudArco.findMany({
        where: {
          organizacionId: ctx.tenant.organizationId,
          estado: "PENDIENTE",
        },
        select: {
          id: true,
          tipo: true,
          documentoTarget: true,
          motivo: true,
          estado: true,
          creadoEn: true,
          paciente: {
            select: { id: true, firstName: true, lastName: true, mrn: true },
          },
        },
        orderBy: { creadoEn: "asc" },
        take: 100,
      });
    });
  }),

  /**
   * US.F2.7.44-45 — DIR/ADM responde la solicitud (aprueba o rechaza).
   * Supresión: puede rechazarse con excepción legal (forenses, epidemiológicos, orden judicial).
   * Al aprobar: estado APROBADA (la ejecución real es manual vía flujo US.F2.7.8/US.F2.7.10).
   */
  responder: requireRole(["DIR", "ADM", "ADMIN"])
    .input(responderInput)
    .mutation(async ({ ctx, input }) => {

    const solicitud = await ctx.prisma.solicitudArco.findUnique({
      where: { id: input.solicitudId },
      select: { id: true, estado: true, organizacionId: true, tipo: true, pacienteId: true },
    });
    if (!solicitud) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud ARCO no encontrada." });
    }
    if (solicitud.organizacionId !== ctx.tenant.organizationId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Solicitud fuera del tenant." });
    }
    if (solicitud.estado !== "PENDIENTE") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `La solicitud ya está en estado ${solicitud.estado}.`,
      });
    }

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const updated = await tx.solicitudArco.update({
        where: { id: input.solicitudId },
        data: {
          estado: input.decision,
          revisadoPorId: ctx.user.id,
          fechaRespuesta: new Date(),
          motivoRespuesta: input.motivoRespuesta,
        },
        select: { id: true, estado: true, tipo: true, fechaRespuesta: true },
      });

      // Notificar al paciente vía outbox
      await tx.domainEvent.create({
        data: {
          eventType: "arco.solicitud.respondida",
          aggregateId: input.solicitudId,
          aggregateType: "SolicitudArco",
          payload: {
            solicitudId: input.solicitudId,
            decision: input.decision,
            tipo: solicitud.tipo,
            patientId: solicitud.pacienteId,
            motivoRespuesta: input.motivoRespuesta,
          },
          organizationId: ctx.tenant.organizationId,
        },
      });

      return updated;
    });
  }),
});

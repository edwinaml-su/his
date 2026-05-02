/**
 * US-2.7 — Router de break-glass.
 *
 * Procedures:
 *   - activate: registra el evento en `audit.AuditLog` (action=BREAK_GLASS,
 *               justification, severity=HIGH en afterJson). El seteo de la
 *               cookie httpOnly se hace en el Server Action porque tRPC no
 *               manipula cookies del response — separamos responsabilidades.
 *   - current : lee el contexto actual y reporta si el usuario tiene una
 *               sesión break-glass activa (consulta el último log < 1h).
 *
 * Patrón inspirado en catalog.router.ts: tenantProcedure + TRPCError + Prisma
 * con manejo defensivo. El router NO confía en el cliente: la validación Zod
 * la corre tRPC, y aquí re-validamos paciente y unicidad razonable.
 *
 * IMPORTACIÓN DE SCHEMAS: usamos ruta relativa al paquete contracts porque
 * `schemas/index.ts` (barrel) no exporta este módulo en Sprint 1.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";

// -----------------------------------------------------------------------------
// Schema input local — espejo del schema canónico en
// `packages/contracts/src/schemas/break-glass.ts`. Lo replicamos aquí porque
// `tsconfig.json` de @his/trpc fija `rootDir: src` (no permite imports fuera
// del package) y la barrel `@his/contracts/schemas/index.ts` está congelada
// en Sprint 1. Si divergen, prevalece el de contracts (single source of truth
// para clientes UI).
// -----------------------------------------------------------------------------
const MIN_JUSTIFICATION_LEN = 20;
const MAX_JUSTIFICATION_LEN = 1000;
export const BREAK_GLASS_TTL_SECONDS = 60 * 60; // 1 hora

const breakGlassActivateInput = z.object({
  patientId: z.string().uuid({ message: "patientId debe ser UUID" }),
  justification: z
    .string()
    .trim()
    .min(MIN_JUSTIFICATION_LEN, `Justificación mínima ${MIN_JUSTIFICATION_LEN} caracteres`)
    .max(MAX_JUSTIFICATION_LEN),
  chiefNotifiedAck: z.boolean().refine((v) => v === true, {
    message: "Debe confirmar la notificación al jefe de servicio.",
  }),
});

export const breakGlassRouter = router({
  /**
   * Registra el acceso break-glass en audit log inmutable.
   * Devuelve `{ ok, auditId, activatedAt }` para que el Server Action setee la cookie.
   */
  activate: tenantProcedure
    .input(breakGlassActivateInput)
    .mutation(async ({ ctx, input }) => {
      // Defensa: paciente debe existir. No filtramos por org porque break-glass
      // explícitamente se usa cross-permission; pero sí debe ser un UUID real.
      const patient = await ctx.prisma.patient.findUnique({
        where: { id: input.patientId },
        select: { id: true },
      });
      if (!patient) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Paciente no encontrado.",
        });
      }

      const occurredAt = new Date();
      try {
        const log = await ctx.prisma.auditLog.create({
          data: {
            occurredAt,
            userId: ctx.user.id,
            organizationId: ctx.tenant.organizationId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            action: "BREAK_GLASS",
            entity: "Patient",
            entityId: input.patientId,
            justification: input.justification,
            // afterJson lleva flags semánticos para el job de Sprint 2 que
            // enviará el correo al jefe de servicio.
            afterJson: {
              severity: "HIGH",
              notify_chief: true,
              chief_notified_ack: input.chiefNotifiedAck,
              ttl_seconds: BREAK_GLASS_TTL_SECONDS,
            },
          },
          select: { id: true, occurredAt: true },
        });

        return {
          ok: true as const,
          auditId: log.id.toString(), // BigInt → string para superjson y cliente.
          activatedAt: log.occurredAt.toISOString(),
        };
      } catch (err) {
        // No filtrar detalles: solo loggear.
        // eslint-disable-next-line no-console
        console.error("[break-glass.activate] error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No se pudo registrar el acceso de emergencia.",
        });
      }
    }),

  /**
   * Reporta si el usuario tiene un break-glass vigente (último log < 1h).
   * El cookie real lo lee el Server Action; aquí servimos el "estado oficial"
   * desde la fuente de verdad inmutable (audit log) para que la UI no confíe
   * solo en una cookie potencialmente borrada.
   */
  current: tenantProcedure.query(async ({ ctx }) => {
    const cutoff = new Date(Date.now() - BREAK_GLASS_TTL_SECONDS * 1000);
    const last = await ctx.prisma.auditLog.findFirst({
      where: {
        userId: ctx.user.id,
        organizationId: ctx.tenant.organizationId,
        action: "BREAK_GLASS",
        occurredAt: { gte: cutoff },
      },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        occurredAt: true,
        entityId: true,
        justification: true,
      },
    });

    if (!last || !last.entityId) {
      return { active: false as const };
    }

    const expiresAt = new Date(
      last.occurredAt.getTime() + BREAK_GLASS_TTL_SECONDS * 1000,
    );
    return {
      active: true as const,
      patientId: last.entityId,
      justification: last.justification ?? "",
      activatedAt: last.occurredAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }),
});

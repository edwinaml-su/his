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
import { emitDomainEvent } from "@his/database";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

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
      // R02 (auditoría RLS externa) — decisión (c), documentada con evidencia:
      // esta mutation NO pasa por withTenantContext a propósito.
      //   1) El lookup de paciente es deliberadamente cross-org: break-glass
      //      existe para acceder a un expediente fuera del alcance normal del
      //      usuario, así que demotar a `authenticated` y aplicar RLS de
      //      tenant aquí rompería el propósito mismo del mecanismo.
      //   2) Verificado en prod (2026-08-22, psql read-only vía DIRECT_URL):
      //      el rol `authenticated` NO tiene grant INSERT sobre
      //      `audit."AuditLog"` (solo SELECT). Si esta mutation demotara el
      //      rol, el `ctx.prisma.auditLog.create(...)` de abajo fallaría con
      //      "permission denied" y el acceso de emergencia nunca quedaría
      //      auditado — el peor escenario posible para break-glass.
      // El registro SIGUE siendo seguro: el audit log es inmutable (hash
      // chain, §"Audit hash chain" CLAUDE.md) y `current` (abajo) sí aplica
      // RLS porque solo lee y `authenticated` tiene SELECT + policy
      // `auditlog_tenant_select` (organizationId = current_org_id() OR
      // is_break_glass()).
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

        // CC-0017 F3 — encola notificación al jefe de servicio (fallback
        // DIR/ADMIN/MEDICAL_DIRECTOR de la org, ver
        // docs/CC/0017/REQ-SEC-BG-003-break-glass-funcional.md). Best-effort:
        // el acceso YA quedó auditado arriba — un fallo aquí NO debe
        // convertir la activación (ya exitosa) en un error 500.
        const expiresAt = new Date(
          log.occurredAt.getTime() + BREAK_GLASS_TTL_SECONDS * 1000,
        );
        try {
          await emitDomainEvent(ctx.prisma, {
            organizationId: ctx.tenant.organizationId,
            eventType: "security.breakGlass.activated",
            aggregateType: "Patient",
            aggregateId: input.patientId,
            emittedById: ctx.user.id,
            payload: {
              auditLogId: log.id.toString(),
              userId: ctx.user.id,
              patientId: input.patientId,
              organizationId: ctx.tenant.organizationId,
              establishmentId: ctx.tenant.establishmentId ?? null,
              justification: input.justification,
              activatedAt: log.occurredAt.toISOString(),
              expiresAt: expiresAt.toISOString(),
            },
          });
        } catch (notifyErr) {
          // eslint-disable-next-line no-console
          console.error("[break-glass.activate] error encolando notificación:", notifyErr);
        }

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
    // Solo lectura, ya scoped por organizationId en JS: sí podemos demotar
    // (default withTenantContext) porque `authenticated` tiene grant SELECT
    // sobre audit."AuditLog" + policy auditlog_tenant_select — a diferencia
    // de `activate`, aquí no hay riesgo de "permission denied" (ver comentario
    // arriba con la evidencia verificada en prod).
    const last = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) =>
      tx.auditLog.findFirst({
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
      }),
    );

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

"use server";

/**
 * Server Action — US-2.7 Break-glass.
 *
 * Flujo:
 *   1. Cliente invoca con { patientId, justification, chiefNotifiedAck }.
 *   2. Validamos con Zod (defensa contra invocaciones directas / curl).
 *   3. Resolvemos usuario + tenant; sin sesión → throw.
 *   4. Insertamos audit log inmutable con action=BREAK_GLASS, severity=HIGH y
 *      flag `notify_chief: true` (Sprint 2 emite email).
 *   5. Seteamos cookie httpOnly `his.break_glass` con TTL 1h.
 *   6. revalidatePath para que las Server Components (que leen la cookie y
 *      activan `app.is_break_glass=true` en RLS) re-rendereen.
 *
 * Patrón inspirado en set-organization.ts: cookies httpOnly + secure + lax,
 * upsert defensivo, revalidatePath layout.
 *
 * IMPORTANTE: NO se llama al router tRPC desde aquí (evita un round-trip
 * extra y mantiene la cookie + log en la misma transacción lógica). El
 * router `breakGlass.activate` queda disponible para clientes externos /
 * tests, pero la UI usa este Server Action.
 */
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, emitDomainEvent } from "@his/database";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
// Un archivo "use server" solo puede EXPORTAR funciones async (regla de Next —
// la valida el build de Next/SWC, no `tsc`). Las constantes y el schema del
// cookie viven en el módulo puro `@/lib/auth/break-glass-cookie` y se importan
// aquí; no se re-exportan desde este archivo.
import { BREAK_GLASS_COOKIE_NAME, BREAK_GLASS_TTL_SECONDS } from "@/lib/auth/break-glass-cookie";

// -----------------------------------------------------------------------------
// Schema local — espejo del canónico en
// `packages/contracts/src/schemas/break-glass.ts`. Replicado aquí porque la
// barrel `@his/contracts/schemas/index.ts` está congelada en Sprint 1 y el
// package.json no expone sub-paths individuales. Si divergen, prevalece el
// archivo de contracts. NO se exporta (regla "use server").
// -----------------------------------------------------------------------------
const MIN_JUSTIFICATION_LEN = 20;
const MAX_JUSTIFICATION_LEN = 1000;

const breakGlassActivateInput = z.object({
  patientId: z.string().uuid(),
  justification: z.string().trim().min(MIN_JUSTIFICATION_LEN).max(MAX_JUSTIFICATION_LEN),
  chiefNotifiedAck: z.boolean().refine((v) => v === true),
});
type BreakGlassActivateInput = z.infer<typeof breakGlassActivateInput>;

interface BreakGlassCookiePayload {
  patientId: string;
  justification: string;
  activatedAt: string;
}

export interface BreakGlassActionResult {
  ok: true;
  activatedAt: string;
  expiresAt: string;
}

export async function activateBreakGlass(
  raw: BreakGlassActivateInput,
): Promise<BreakGlassActionResult> {
  // 1. Validación Zod — re-corremos en server por si llega payload mal formado.
  const parsed = breakGlassActivateInput.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    );
  }
  const input = parsed.data;

  // 2. Sesión + tenant.
  const user = await getCurrentUser();
  if (!user) throw new Error("No autenticado");
  const tenant = await getTenantContext();
  if (!tenant) throw new Error("Selecciona una organización antes de continuar.");

  // 3. Verificar paciente.
  const patient = await prisma.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true },
  });
  if (!patient) throw new Error("Paciente no encontrado.");

  // 4. Audit log inmutable. AuditAction.BREAK_GLASS existe en el enum (schema.prisma).
  const occurredAt = new Date();
  const log = await prisma.auditLog.create({
    data: {
      occurredAt,
      userId: user.id,
      organizationId: tenant.organizationId,
      establishmentId: tenant.establishmentId ?? null,
      action: "BREAK_GLASS",
      entity: "Patient",
      entityId: input.patientId,
      justification: input.justification,
      afterJson: {
        severity: "HIGH",
        notify_chief: true,
        chief_notified_ack: input.chiefNotifiedAck,
        ttl_seconds: BREAK_GLASS_TTL_SECONDS,
      },
    },
    select: { id: true, occurredAt: true },
  });

  // 5. Cookie httpOnly con payload tipado.
  const payload: BreakGlassCookiePayload = {
    patientId: input.patientId,
    justification: input.justification,
    activatedAt: log.occurredAt.toISOString(),
  };
  const expiresAt = new Date(log.occurredAt.getTime() + BREAK_GLASS_TTL_SECONDS * 1000);

  // 5b. CC-0017 F3 — encola la notificación al jefe de servicio (fallback
  // DIR/ADMIN/MEDICAL_DIRECTOR de la org — no existe rol "jefe de servicio"
  // seedeado, ver docs/CC/0017/REQ-SEC-BG-003-break-glass-funcional.md).
  // Reutiliza el outbox existente (Beta.15): DomainEvent + dispatcher
  // (packages/infrastructure/notifications), NO un email directo ad-hoc.
  // Best-effort: el acceso YA quedó auditado en el paso 4 — perder la
  // notificación no debe bloquear la atención de emergencia.
  try {
    await emitDomainEvent(prisma, {
      organizationId: tenant.organizationId,
      eventType: "security.breakGlass.activated",
      aggregateType: "Patient",
      aggregateId: input.patientId,
      emittedById: user.id,
      payload: {
        auditLogId: log.id.toString(),
        userId: user.id,
        patientId: input.patientId,
        organizationId: tenant.organizationId,
        establishmentId: tenant.establishmentId ?? null,
        justification: input.justification,
        activatedAt: log.occurredAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[break-glass] error encolando notificación al jefe de servicio:", err);
  }

  cookies().set(BREAK_GLASS_COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BREAK_GLASS_TTL_SECONDS,
  });

  // 6. Refrescar Server Components dependientes (RLS lee la cookie).
  revalidatePath("/", "layout");

  return {
    ok: true,
    activatedAt: log.occurredAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Limpia la sesión break-glass (desactivación manual desde el banner del
 * shell, o al expirar). CC-0017 F3: audita el cierre — lee el payload de la
 * cookie ANTES de borrarla para saber sobre qué paciente se estaba operando.
 * Best-effort: un fallo al auditar NO debe impedir que el usuario cierre su
 * sesión de emergencia.
 */
export async function clearBreakGlass(): Promise<{ ok: true }> {
  const raw = cookies().get(BREAK_GLASS_COOKIE_NAME)?.value;
  cookies().delete(BREAK_GLASS_COOKIE_NAME);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { patientId?: unknown };
      const user = await getCurrentUser();
      const tenant = user ? await getTenantContext() : null;
      if (user && tenant && typeof parsed.patientId === "string") {
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            organizationId: tenant.organizationId,
            establishmentId: tenant.establishmentId ?? null,
            action: "UPDATE",
            entity: "BreakGlassAccess",
            entityId: parsed.patientId,
            justification: "Break-glass desactivado manualmente por el usuario.",
          },
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[break-glass] error auditando desactivación:", err);
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

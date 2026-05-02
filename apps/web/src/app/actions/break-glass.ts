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
import { prisma } from "@his/database";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

// -----------------------------------------------------------------------------
// Schemas locales — espejo del canónico en
// `packages/contracts/src/schemas/break-glass.ts`. Replicados aquí porque la
// barrel `@his/contracts/schemas/index.ts` está congelada en Sprint 1 y el
// package.json no expone sub-paths individuales. Si divergen, prevalece el
// archivo de contracts.
// -----------------------------------------------------------------------------
const MIN_JUSTIFICATION_LEN = 20;
const MAX_JUSTIFICATION_LEN = 1000;
export const BREAK_GLASS_COOKIE_NAME = "his.break_glass";
export const BREAK_GLASS_TTL_SECONDS = 60 * 60;

const breakGlassActivateInput = z.object({
  patientId: z.string().uuid(),
  justification: z.string().trim().min(MIN_JUSTIFICATION_LEN).max(MAX_JUSTIFICATION_LEN),
  chiefNotifiedAck: z.boolean().refine((v) => v === true),
});
export type BreakGlassActivateInput = z.infer<typeof breakGlassActivateInput>;

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

/** Limpia la sesión break-glass (al expirar o al cerrar el caso). */
export async function clearBreakGlass(): Promise<{ ok: true }> {
  cookies().delete(BREAK_GLASS_COOKIE_NAME);
  revalidatePath("/", "layout");
  return { ok: true };
}

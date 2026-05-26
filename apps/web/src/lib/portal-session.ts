/**
 * Bootstrap de sesión del Portal del Paciente (S-K-1, cierra K-01 + K-02).
 *
 * Flujo:
 *   1. `verifyAndCreateSession` (server action) llama al procedure tRPC
 *      `portal.auth.verifyLogin` con `cookieMode=true` → el procedure crea la
 *      PortalSession en BD y devuelve `sessionRaw + expiresAt`.
 *   2. La acción setea cookie HttpOnly con el `sessionRaw` (cliente nunca
 *      lo lee de JS).
 *   3. En cada request al API route `/api/trpc/*`, `resolvePortalContext(req)`
 *      lee la cookie, hashea, valida la sesión contra BD y devuelve el
 *      `PortalAccountContext` para inyectar en el contexto tRPC.
 *
 * Atributos cookie (TDR §6.2 — secretos fuera del browser JS):
 *   - HttpOnly:   bloquea acceso desde `document.cookie` (defensa XSS).
 *   - Secure:     solo HTTPS en producción.
 *   - SameSite=Lax: balance entre seguridad y deep-links del magic email.
 *   - Path=/:     se envía en todas las requests (necesario para /api/trpc).
 */
import { createHash } from "node:crypto";
import { prisma } from "@his/database";
import type { PortalAccountContext } from "@his/trpc";

export const PORTAL_SESSION_COOKIE = "his.portal.session";

/**
 * Hashea el bearer token con SHA-256 (paridad con `hashToken` del router
 * `portal.ts`). El hash es lo que se almacena en `PortalSession.token`.
 */
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Resuelve el contexto del Portal Paciente a partir del request HTTP.
 *
 * Devuelve `null` si no hay cookie, la sesión expiró, fue revocada o el
 * account está suspendido. Cualquier error de BD también devuelve `null` —
 * `portalProcedure` lanzará UNAUTHORIZED downstream.
 */
export async function resolvePortalContext(
  req: Request,
): Promise<PortalAccountContext | null> {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = parseCookies(cookieHeader);
  const raw = cookies[PORTAL_SESSION_COOKIE];
  if (!raw) return null;

  const hashed = hashToken(raw);
  try {
    const session = await prisma.portalSession.findUnique({
      where: { token: hashed },
      select: {
        revokedAt: true,
        expiresAt: true,
        account: {
          select: {
            id: true,
            patientId: true,
            email: true,
            status: true,
          },
        },
      },
    });

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt <= new Date()) return null;
    if (session.account.status !== "ACTIVE") return null;

    return {
      id: session.account.id,
      patientId: session.account.patientId,
      email: session.account.email,
    };
  } catch {
    return null;
  }
}

/**
 * Parsea el header `Cookie` (RFC 6265) a un mapa name→value sin URL-decode
 * (los tokens portal son hex puro, no contienen caracteres especiales).
 */
function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name && value) out[name] = value;
  }
  return out;
}

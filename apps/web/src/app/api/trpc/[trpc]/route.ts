import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@his/trpc";
import { prisma } from "@his/database";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { resolvePortalContext } from "@/lib/portal-session";
import { checkTrpcRateLimit } from "@/lib/trpc/rate-limit-global";
import { redactPhi } from "@/lib/log-redact";
import { cookies } from "next/headers";
import { MFA_COOKIE_NAME, isMfaSatisfied } from "@/lib/auth/mfa-session";

const handler = async (req: Request) => {
  // Resolvemos Supabase user + portal account en paralelo — son fuentes
  // disjuntas (cookie distinta para cada uno) y la mayoría de requests
  // solo activarán una de las dos.
  const [user, portalAccount] = await Promise.all([
    getCurrentUser(),
    resolvePortalContext(req),
  ]);
  const tenant = user ? await getTenantContext() : null;

  // OWASP A06:2025 — tope global anti-bucle antes de tocar el router.
  const ip = req.headers.get("x-forwarded-for");
  const verdict = await checkTrpcRateLimit(prisma, {
    userId: user?.id ?? portalAccount?.id ?? null,
    ip,
  });
  if (!verdict.ok) {
    return new Response(
      JSON.stringify({
        error: {
          message: `Demasiadas solicitudes. Reintente en ${verdict.retryAfterSec} segundos.`,
          code: -32029, // TOO_MANY_REQUESTS en el mapeo de tRPC
        },
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(verdict.retryAfterSec ?? 60),
        },
      },
    );
  }

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () =>
      createTRPCContext({
        user,
        tenant,
        portalAccount,
        ip: ip ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        // A07:2025 — veredicto de la política MFA para esta sesión.
        mfaSatisfied: isMfaSatisfied({
          userId: user?.id ?? null,
          roleCodes: tenant?.roleCodes ?? [],
          cookie: cookies().get(MFA_COOKIE_NAME)?.value,
        }),
      }),
    onError({ error, path }) {
      // OWASP A09:2025 — el log NO debe volverse un almacén PHI: el mensaje de
      // un error puede arrastrar identificadores (uuid de paciente, expediente)
      // y `error` completo incluye el input de la llamada. Loggeamos código +
      // mensaje redactado + stack; el detalle correlacionable va a Sentry, que
      // ya tiene el filtro de PII cableado (Beta.22).
      // eslint-disable-next-line no-console
      console.error(
        `[tRPC] ${error.code} en ${path ?? "<sin-path>"}: ${redactPhi(error.message)}`,
        error.cause instanceof Error ? redactPhi(error.cause.message) : "",
      );
    },
  });
};

export { handler as GET, handler as POST };

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@his/trpc";
import { prisma } from "@his/database";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { resolvePortalContext } from "@/lib/portal-session";
import { checkTrpcRateLimit } from "@/lib/trpc/rate-limit-global";

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
      }),
    onError({ error, path }) {
      // eslint-disable-next-line no-console
      console.error(`[tRPC] error in ${path ?? "<no-path>"}:`, error);
    },
  });
};

export { handler as GET, handler as POST };

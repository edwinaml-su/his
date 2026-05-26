import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@his/trpc";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { resolvePortalContext } from "@/lib/portal-session";

const handler = async (req: Request) => {
  // Resolvemos Supabase user + portal account en paralelo — son fuentes
  // disjuntas (cookie distinta para cada uno) y la mayoría de requests
  // solo activarán una de las dos.
  const [user, portalAccount] = await Promise.all([
    getCurrentUser(),
    resolvePortalContext(req),
  ]);
  const tenant = user ? await getTenantContext() : null;

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () =>
      createTRPCContext({
        user,
        tenant,
        portalAccount,
        ip: req.headers.get("x-forwarded-for") ?? undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
      }),
    onError({ error, path }) {
      // eslint-disable-next-line no-console
      console.error(`[tRPC] error in ${path ?? "<no-path>"}:`, error);
    },
  });
};

export { handler as GET, handler as POST };

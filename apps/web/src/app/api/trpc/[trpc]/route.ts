import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createTRPCContext } from "@his/trpc";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

const handler = async (req: Request) => {
  const user = await getCurrentUser();
  const tenant = user ? await getTenantContext() : null;

  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () =>
      createTRPCContext({
        user,
        tenant,
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

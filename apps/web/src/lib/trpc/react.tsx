"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import type { AppRouter } from "@his/trpc";

export const trpc = createTRPCReact<AppRouter>();

/**
 * QueryClient defaults: no reintentar 4xx (FORBIDDEN, UNAUTHORIZED, BAD_REQUEST).
 * tRPC pone httpStatus en error.data.httpStatus. Sin esto, una query con
 * 403 se reintenta hasta 4 veces (default) generando ruido en consola + carga
 * al backend.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error: unknown) => {
          const status = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

let browserClient: QueryClient | null = null;
function getQueryClient() {
  if (typeof window === "undefined") return createQueryClient();
  if (!browserClient) browserClient = createQueryClient();
  return browserClient;
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = React.useState(() =>
    trpc.createClient({
      links: [
        loggerLink({
          enabled: (op) =>
            (process.env.NODE_ENV === "development" && typeof window !== "undefined") ||
            (op.direction === "down" && op.result instanceof Error),
        }),
        httpBatchLink({
          url: "/api/trpc",
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

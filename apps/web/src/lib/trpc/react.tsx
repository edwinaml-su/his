"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import type { AppRouter } from "@his/trpc";

export const trpc = createTRPCReact<AppRouter>();

let browserClient: QueryClient | null = null;
function getQueryClient() {
  if (typeof window === "undefined") return new QueryClient();
  if (!browserClient) browserClient = new QueryClient();
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

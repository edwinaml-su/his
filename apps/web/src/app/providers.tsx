"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@his/ui/components/tooltip";
import { ToastProvider, ToastViewport } from "@his/ui/components/toast";
import { TRPCProvider } from "@/lib/trpc/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <TRPCProvider>
        <TooltipProvider>
          <ToastProvider>
            {children}
            <ToastViewport />
          </ToastProvider>
        </TooltipProvider>
      </TRPCProvider>
    </ThemeProvider>
  );
}

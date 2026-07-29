"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

/**
 * CC-0010: /login trae su propio wrapper fullscreen (escenario animado
 * 1280x720 + tarjeta) — el contenedor centrado max-w-md de este layout lo
 * recortaría. El resto de rutas (/mfa, /recover, /sso, /signup) conservan
 * el layout original sin cambios.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/login")) {
    return <>{children}</>;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}

"use client";

/**
 * PerfTracker — registra el tiempo de carga (Navigation Timing API) y lo
 * reporta a /api/perf/sample. Se monta una sola vez en el layout admin/
 * clinical para capturar todas las navegaciones.
 *
 * Implementación liviana — el reporte es fire-and-forget con sendBeacon
 * para no bloquear navegación.
 */
import * as React from "react";
import { usePathname } from "next/navigation";

export function PerfTracker() {
  const pathname = usePathname();

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    // Esperar a que el browser termine de medir loadEventEnd.
    const reportIfReady = () => {
      try {
        const nav = performance.getEntriesByType("navigation")[0] as
          | PerformanceNavigationTiming
          | undefined;
        if (!nav) return;
        const durationMs = Math.max(0, nav.loadEventEnd - nav.startTime);
        if (durationMs === 0) return;

        const payload = JSON.stringify({
          route: pathname || "/",
          kind: "pageload",
          durationMs,
        });

        if (navigator.sendBeacon) {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon("/api/perf/sample", blob);
        } else {
          void fetch("/api/perf/sample", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // No-op
      }
    };

    if (document.readyState === "complete") {
      reportIfReady();
      return;
    }
    window.addEventListener("load", reportIfReady, { once: true });
    return () => window.removeEventListener("load", reportIfReady);
  }, [pathname]);

  return null;
}

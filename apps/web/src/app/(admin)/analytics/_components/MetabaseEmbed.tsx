"use client";

/**
 * MetabaseEmbed.tsx — Componente cliente que embebe un dashboard Metabase via iframe.
 */

import * as React from "react";

import { useEffect, useState } from "react";
import { getMetabaseEmbedToken, type KpiId } from "../_actions/metabase-jwt";

interface MetabaseEmbedProps {
  kpiId: KpiId;
  /** Titulo descriptivo del dashboard para lectores de pantalla. */
  title: string;
  /** Altura del iframe en px. Default: 600. */
  height?: number;
}

type EmbedState =
  | { status: "loading" }
  | { status: "ready"; iframeUrl: string }
  | { status: "error"; message: string }
  | { status: "unconfigured" };

export function MetabaseEmbed({ kpiId, title, height = 600 }: MetabaseEmbedProps) {
  const [state, setState] = useState<EmbedState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function fetchToken() {
      setState({ status: "loading" });
      try {
        const result = await getMetabaseEmbedToken(kpiId);
        if (cancelled) return;

        if ("error" in result) {
          // Diferenciar entre "no configurado" (BI todavía no desplegado o
          // env vars faltantes) y error de permiso/sistema.
          const lower = result.error.toLowerCase();
          const isUnconfigured =
            lower.includes("no configurado") ||
            lower.includes("incompleta") ||
            lower.includes("no disponible") ||
            lower.includes("aún no está") ||
            lower.includes("pendiente");
          if (isUnconfigured) {
            setState({ status: "unconfigured" });
          } else {
            setState({ status: "error", message: result.error });
          }
        } else {
          setState({ status: "ready", iframeUrl: result.iframeUrl });
        }
      } catch (err) {
        // Si la Server Action falla (red, hidratación, deploy parcial) NO
        // mostramos "Error de conexión" — degradamos a "unconfigured" que
        // es más útil para el usuario operativo. El detalle se mantiene
        // disponible en console.error para debugging.
        console.error("[MetabaseEmbed] action error", err);
        if (!cancelled) {
          setState({ status: "unconfigured" });
        }
      }
    }

    void fetchToken();
    return () => {
      cancelled = true;
    };
  }, [kpiId]);

  if (state.status === "loading") {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20"
        style={{ height }}
        role="status"
        aria-label={`Cargando dashboard ${title}`}
      >
        <p className="text-sm text-muted-foreground">Configurando dashboard...</p>
      </div>
    );
  }

  if (state.status === "unconfigured") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-8 text-center"
        style={{ height }}
        role="status"
      >
        <div className="rounded-full bg-muted p-3" aria-hidden>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6 text-muted-foreground"
          >
            <path d="M3 3v18h18" />
            <path d="M7 16l4-4 4 4 6-6" />
          </svg>
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold">Dashboard pendiente de configuración</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Este KPI estará disponible cuando el equipo de BI termine de configurar
            Metabase y se carguen las variables de entorno en Vercel
            (<span className="font-mono text-xs">METABASE_SITE_URL</span>,{" "}
            <span className="font-mono text-xs">METABASE_SECRET_KEY</span>,{" "}
            <span className="font-mono text-xs">METABASE_DASHBOARD_{kpiId.replace(/-/g, "_")}</span>).
          </p>
          <p className="text-xs text-muted-foreground">
            Referencia:{" "}
            <span className="font-mono">docs/blueprints/beta19c_metabase_setup.md</span>
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
        style={{ height }}
        role="alert"
        aria-live="assertive"
      >
        <p className="text-sm font-medium text-destructive">No se pudo cargar el dashboard</p>
        <p className="text-xs text-muted-foreground">{state.message}</p>
      </div>
    );
  }

  // state.status === "ready"
  return (
    <iframe
      src={state.iframeUrl}
      title={title}
      width="100%"
      height={height}
      className="rounded-lg border-0"
      allowFullScreen
      // Restringe permisos del iframe al minimo necesario.
      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    />
  );
}

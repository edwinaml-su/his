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
          // Diferenciar entre "no configurado" y error de permiso/sistema.
          if (result.error.includes("no configurado") || result.error.includes("incompleta")) {
            setState({ status: "unconfigured" });
          } else {
            setState({ status: "error", message: result.error });
          }
        } else {
          setState({ status: "ready", iframeUrl: result.iframeUrl });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Error de conexion al cargar el dashboard." });
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
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-6 text-center"
        style={{ height }}
        role="status"
      >
        <p className="text-sm font-medium text-muted-foreground">
          Dashboard en configuracion
        </p>
        <p className="text-xs text-muted-foreground">
          Este KPI estara disponible una vez que el equipo de BI configure el dashboard en
          Metabase. Consulte{" "}
          <span className="font-mono">docs/blueprints/beta19c_metabase_setup.md</span>.
        </p>
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

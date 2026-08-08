"use client";

/**
 * CC-0016 — Parametrización › «📝 Opciones de llenado». Estado
 * obligatorio/opcional/oculto por campo del formulario de solicitud.
 */
import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import { FIELD_META } from "../field-rule-meta";
import type { ImagingFieldEstado } from "@his/contracts";

const ESTADOS: ImagingFieldEstado[] = ["obligatorio", "opcional", "oculto"];
const ESTADO_LABEL: Record<ImagingFieldEstado, string> = {
  obligatorio: "Obligatorio",
  opcional: "Opcional",
  oculto: "Oculto",
};

export function OpcionesLlenado() {
  const utils = trpc.useUtils();
  const listQ = trpc.imagingRequest.fieldConfig.list.useQuery();
  const set = trpc.imagingRequest.fieldConfig.set.useMutation({
    onSuccess: () => utils.imagingRequest.fieldConfig.list.invalidate(),
  });

  return (
    <div className="divide-y rounded-md border">
      {(listQ.data ?? []).map((f) => {
        const meta = FIELD_META[f.fieldKey];
        return (
          <div key={f.fieldKey} className="grid grid-cols-1 items-center gap-2 p-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm font-semibold">{meta.label}</p>
              <p className="text-xs text-muted-foreground">{meta.desc}</p>
            </div>
            <div className="inline-flex overflow-hidden rounded-md border">
              {ESTADOS.map((estado) => (
                <button
                  key={estado}
                  type="button"
                  disabled={set.isPending}
                  onClick={() => set.mutate({ fieldKey: f.fieldKey, estado })}
                  className={`px-3 py-1.5 text-xs font-semibold ${
                    f.estado === estado
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {ESTADO_LABEL[estado]}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

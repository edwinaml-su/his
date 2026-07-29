"use client";

/**
 * CC-0013 — Modal "Solicitud" del tablero de exámenes por cuenta.
 *
 * CC-0013b: extraído de `tablero.tsx` para compartirlo con la vista
 * "Estudios" (grid de consulta a nivel de examen). Comportamiento sin
 * cambios respecto al original — solo movido de archivo.
 *
 * Fuente de verdad: docs/CC/0013/mockup_examenes_laboratorio.html
 * (modal "Solicitud"). Consume `lis.order.updateItems`.
 */

import * as React from "react";
import { Textarea } from "@his/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import { MOCK_LAB_PALETTE as MOCK, ESTADOS_EDITABLES } from "../../_lib/mock-palette";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
export type CuentaRow = RouterOutput["lis"]["order"]["tableroPorCuenta"]["cuentas"][number];

interface SolicitudModalProps {
  cuenta: CuentaRow;
  onClose: () => void;
  onSaved: () => void;
}

export function SolicitudModal({ cuenta, onClose, onSaved }: SolicitudModalProps): React.ReactElement {
  const [nota, setNota] = React.useState(cuenta.clinicalIndication);
  const [rows, setRows] = React.useState(cuenta.examenes.map((e) => ({ ...e })));

  React.useEffect(() => {
    setNota(cuenta.clinicalIndication);
    setRows(cuenta.examenes.map((e) => ({ ...e })));
  }, [cuenta]);

  const update = trpc.lis.order.updateItems.useMutation({ onSuccess: onSaved });

  function guardar(): void {
    update.mutate({
      orderId: cuenta.orderId,
      clinicalIndication: nota,
      items: rows.map((r) => ({
        itemId: r.itemId,
        status: r.estado as "ORDERED" | "IN_PROCESS" | "RESULTED",
        notes: r.notes || undefined,
      })),
    });
  }

  const sexoLabel = cuenta.paciente.sexo === "F" ? "Femenino" : cuenta.paciente.sexo === "M" ? "Masculino" : "—";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {cuenta.paciente.nombre} · {cuenta.numeroCuenta}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {cuenta.paciente.edad ?? "—"} años / {sexoLabel} · Médico: {cuenta.medico} · Ingreso:{" "}
            {new Date(cuenta.ingreso).toLocaleDateString("es-SV")} · Prioridad: {cuenta.prioridad} · Estado
            cuenta: {cuenta.estado}
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: MOCK.teal }}>
              Instrucción general para el laboratorio
            </div>
            <Textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={3}
              placeholder="Ej.: Tomar muestras en ayunas, priorizar por urgencia, notificar resultados críticos al médico tratante..."
            />
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: MOCK.teal }}>
              Exámenes relacionados a la cuenta
            </div>
            <div className="overflow-auto rounded-md border">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr style={{ backgroundColor: "#eef4f5" }}>
                    <th className="px-2 py-1.5 text-left" style={{ color: "#2a4650" }}>
                      #
                    </th>
                    <th className="px-2 py-1.5 text-left" style={{ color: "#2a4650" }}>
                      Examen
                    </th>
                    <th className="px-2 py-1.5 text-left" style={{ color: "#2a4650" }}>
                      Sección
                    </th>
                    <th className="px-2 py-1.5 text-left" style={{ color: "#2a4650" }}>
                      Estado
                    </th>
                    <th className="px-2 py-1.5 text-left" style={{ color: "#2a4650" }}>
                      Instrucción
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.itemId} className="border-t" style={{ borderColor: "#eef1f3" }}>
                      <td className="px-2 py-1.5">{idx + 1}</td>
                      <td className="px-2 py-1.5">{r.nombre}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ backgroundColor: "#e6eef0", color: MOCK.tealDark }}
                        >
                          {r.seccion}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className="w-full rounded border px-1.5 py-1"
                          aria-label={`Estado de ${r.nombre}`}
                          value={r.estado}
                          onChange={(e) => {
                            const nuevoEstado = e.target.value as "ORDERED" | "IN_PROCESS" | "RESULTED";
                            setRows((prev) => prev.map((p, i) => (i === idx ? { ...p, estado: nuevoEstado } : p)));
                          }}
                        >
                          {ESTADOS_EDITABLES.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          className="w-full rounded border px-1.5 py-1"
                          aria-label={`Instrucción de ${r.nombre}`}
                          value={r.notes}
                          placeholder="Indicación..."
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, notes: e.target.value } : p)),
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {update.error ? (
          <p className="text-sm text-destructive" role="alert">
            {update.error.message}
          </p>
        ) : null}

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">{rows.length} examen(es) en esta cuenta</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-4 py-2 text-sm font-medium"
              style={{ color: MOCK.teal, borderColor: MOCK.teal }}
            >
              Cerrar
            </button>
            <button
              type="button"
              disabled={update.isPending}
              onClick={guardar}
              className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: MOCK.teal }}
            >
              {update.isPending ? "Guardando…" : "💾 Guardar cambios"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

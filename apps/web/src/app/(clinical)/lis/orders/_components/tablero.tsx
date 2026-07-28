"use client";

/**
 * §17 LIS — Tablero de exámenes por cuenta (CC-0013).
 *
 * Fuente de verdad: docs/CC/0013/mockup_examenes_laboratorio.html
 * (pantalla "Consultar Tablero" + modal "Solicitud"). Consume
 * `lis.order.tableroPorCuenta` (KPIs + filas por cuenta) y
 * `lis.order.updateItems` (guardado del modal).
 */

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Textarea } from "@his/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import { MOCK_LAB_PALETTE as MOCK, ESTADOS_EDITABLES } from "../../_lib/mock-palette";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type ToastState = { title: string; variant?: "default" | "destructive" } | null;

type RouterOutput = inferRouterOutputs<AppRouter>;
type TableroData = RouterOutput["lis"]["order"]["tableroPorCuenta"];
type CuentaRow = TableroData["cuentas"][number];

export function Tablero(): React.ReactElement {
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [openCuentaId, setOpenCuentaId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<ToastState>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const utils = trpc.useUtils();
  const tablero = trpc.lis.order.tableroPorCuenta.useQuery({ search: debounced || undefined });

  const kpis = tablero.data?.kpis;
  const cuentas = tablero.data?.cuentas ?? [];
  const cuentaAbierta = cuentas.find((c) => c.cuentaId === openCuentaId) ?? null;

  function handleSaved(numeroCuenta: string): void {
    setOpenCuentaId(null);
    void utils.lis.order.tableroPorCuenta.invalidate();
    setToast({ title: `Cambios guardados en la solicitud ${numeroCuenta}.` });
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <span className="text-lg font-semibold">Consultar Tablero</span>
        <Input
          className="min-w-[260px] flex-1 sm:flex-none"
          placeholder="Buscar por cuenta, paciente o médico..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar por cuenta, paciente o médico"
        />
      </div>

      <div className="flex flex-wrap gap-2.5 p-4 pb-1">
        <Kpi n={kpis?.cuentasActivas ?? 0} label="Cuentas activas" />
        <Kpi n={kpis?.examenesTotales ?? 0} label="Exámenes totales" />
        <Kpi n={kpis?.examenesPendientes ?? 0} label="Exámenes pendientes" />
        <Kpi n={kpis?.solicitudesUrgentes ?? 0} label="Solicitudes urgentes" />
      </div>

      <div className="overflow-auto p-4 pt-2">
        {tablero.error ? (
          <p role="alert" className="text-sm text-destructive">
            {tablero.error.message}
          </p>
        ) : null}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Cuenta", "Paciente", "Edad/Sexo", "Médico", "Ingreso", "Prioridad", "Exámenes", "Estado", ""].map(
                (h) => (
                  <th
                    key={h || "acciones"}
                    className="whitespace-nowrap px-3 py-2 text-left font-semibold text-white"
                    style={{ backgroundColor: MOCK.teal }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {!tablero.isLoading && cuentas.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Sin resultados.
                </td>
              </tr>
            ) : null}
            {cuentas.map((c) => (
              <tr key={c.cuentaId} className="border-b" style={{ borderColor: MOCK.line }}>
                <td className="px-3 py-2 font-semibold">{c.numeroCuenta}</td>
                <td className="px-3 py-2">{c.paciente.nombre}</td>
                <td className="px-3 py-2">
                  {c.paciente.edad ?? "—"} / {c.paciente.sexo ?? "—"}
                </td>
                <td className="px-3 py-2">{c.medico}</td>
                <td className="px-3 py-2">{new Date(c.ingreso).toLocaleDateString("es-SV")}</td>
                <td className="px-3 py-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={
                      c.prioridad === "Urgente"
                        ? { backgroundColor: "#fbe4e0", color: "#c0392b" }
                        : { backgroundColor: "#e6eef0", color: MOCK.tealDark }
                    }
                  >
                    {c.prioridad}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.totalExamenes}</td>
                <td className="px-3 py-2">
                  <span
                    className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: "#e0f2e9", color: "#1c7a4a" }}
                  >
                    {c.estado}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenCuentaId(c.cuentaId)}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
                    style={{ backgroundColor: MOCK.teal }}
                  >
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cuentaAbierta ? (
        <SolicitudModal
          cuenta={cuentaAbierta}
          onClose={() => setOpenCuentaId(null)}
          onSaved={() => handleSaved(cuentaAbierta.numeroCuenta)}
        />
      ) : null}

      {toast ? (
        <Toast variant={toast.variant ?? "default"} open onOpenChange={(o) => !o && setToast(null)}>
          <ToastTitle>{toast.title}</ToastTitle>
          <ToastDescription />
        </Toast>
      ) : null}
    </div>
  );
}

function Kpi({ n, label }: { n: number; label: string }): React.ReactElement {
  return (
    <div
      className="min-w-[120px] rounded-lg border p-2.5"
      style={{ borderColor: "#dbe7e9", backgroundColor: "#f0f6f7" }}
    >
      <div className="text-xl font-bold" style={{ color: MOCK.tealDark }}>
        {n}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

interface SolicitudModalProps {
  cuenta: CuentaRow;
  onClose: () => void;
  onSaved: () => void;
}

function SolicitudModal({ cuenta, onClose, onSaved }: SolicitudModalProps): React.ReactElement {
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

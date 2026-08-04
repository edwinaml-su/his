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
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import { MOCK_LAB_PALETTE as MOCK } from "../../_lib/mock-palette";
import { SolicitudModal } from "./solicitud-modal";

type ToastState = { title: string; variant?: "default" | "destructive" } | null;

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


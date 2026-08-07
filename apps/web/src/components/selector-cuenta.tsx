"use client";

/**
 * Selector de cuenta inline — compartido entre `/ece/historia-clinica/nueva`
 * (CC-0007) y `/lis/orders/new` (CC-0013). Busca paciente, elige una de sus
 * cuentas o crea una nueva inline (CC-0015: tipo de cuenta requerido — pivote
 * de lista de precios de los cargos).
 */

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

export interface SelectorCuentaProps {
  onSelect: (cuentaId: string) => void;
  /** Título mostrado sobre el buscador (ej. "Nueva Historia Clínica"). */
  titulo: string;
  /** Subtítulo/instrucción bajo el título. */
  subtitulo: string;
}

const TIPO_SERVICIO_LABELS: Record<string, string> = {
  HOSPITALARIO: "Hospitalario",
  NO_HOSPITALARIO: "No hospitalario",
};

export function SelectorCuenta({ onSelect, titulo, subtitulo }: SelectorCuentaProps) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [pacienteSel, setPacienteSel] = React.useState<{
    id: string;
    nombre: string;
  } | null>(null);
  const [mostrarCrear, setMostrarCrear] = React.useState(false);
  const [tipoCuentaId, setTipoCuentaId] = React.useState("");
  const [tipoServicio, setTipoServicio] = React.useState<"HOSPITALARIO" | "NO_HOSPITALARIO" | "">(
    "",
  );
  const [crearError, setCrearError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const pacientesQ = trpc.patient.search.useQuery(
    { query: debounced },
    { enabled: debounced.length >= 2 && !pacienteSel },
  );

  const cuentasQ = trpc.patientAccount.listarPorPaciente.useQuery(
    { patientId: pacienteSel?.id ?? "" },
    { enabled: !!pacienteSel },
  );

  const tiposCuentaQ = trpc.tipoCuenta.list.useQuery(
    { activeOnly: true },
    { enabled: !!pacienteSel },
  );

  const crearMutation = trpc.patientAccount.crear.useMutation({
    onSuccess: (cuenta) => onSelect(cuenta.id),
    onError: (err) => setCrearError(err.message ?? "Error al crear la cuenta."),
  });

  const sinCuentas = !cuentasQ.isLoading && (cuentasQ.data?.length ?? 0) === 0;

  function handleCrear() {
    setCrearError(null);
    if (!pacienteSel) return;
    if (!tipoCuentaId) {
      setCrearError("Selecciona el tipo de cuenta.");
      return;
    }
    crearMutation.mutate({
      patientId: pacienteSel.id,
      tipoCuentaId,
      ...(tipoServicio ? { servicio: { tipo: tipoServicio } } : {}),
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-lg font-semibold text-foreground">{titulo}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitulo}</p>

      {!pacienteSel ? (
        <div className="mt-5">
          <Input
            autoFocus
            placeholder="Buscar paciente por nombre, expediente o documento…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {debounced.length >= 2 && (
            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              {pacientesQ.isLoading ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Buscando…</p>
              ) : pacientesQ.error ? (
                <p className="px-4 py-3 text-sm text-destructive" role="alert">
                  {pacientesQ.error.message}
                </p>
              ) : (pacientesQ.data?.length ?? 0) === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  Sin resultados para &quot;{debounced}&quot;.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {pacientesQ.data?.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setPacienteSel({
                            id: p.id,
                            nombre: `${p.firstName} ${p.lastName}`.trim(),
                          })
                        }
                        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-muted"
                      >
                        <span className="font-medium text-foreground">
                          {p.firstName} {p.lastName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.mrn}
                          {p.identifiers?.[0]?.value ? ` · ${p.identifiers[0].value}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
            <span className="text-sm font-medium text-foreground">{pacienteSel.nombre}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPacienteSel(null);
                setMostrarCrear(false);
                setCrearError(null);
              }}
            >
              Cambiar paciente
            </Button>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            {cuentasQ.isLoading ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Cargando cuentas…</p>
            ) : cuentasQ.error ? (
              <p className="px-4 py-3 text-sm text-destructive" role="alert">
                {cuentasQ.error.message}
              </p>
            ) : sinCuentas ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Este paciente no tiene cuentas.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {cuentasQ.data?.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium text-foreground">{c.numeroCuenta}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.tipoCuenta?.nombre
                          ? c.tipoCuenta.nombre
                          : c.servicios.length > 0
                            ? c.servicios.map((s) => s.tipo).join(", ")
                            : "Sin servicios"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!mostrarCrear ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setMostrarCrear(true)}
            >
              + Nueva cuenta
            </Button>
          ) : (
            <div className="mt-3 space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-foreground">Nueva cuenta</p>

              {crearError ? (
                <p className="text-sm text-destructive" role="alert">
                  {crearError}
                </p>
              ) : null}

              <div className="space-y-1">
                <Label htmlFor="tipoCuenta">Tipo de cuenta *</Label>
                <Select value={tipoCuentaId || "none"} onValueChange={(v) => setTipoCuentaId(v === "none" ? "" : v)}>
                  <SelectTrigger id="tipoCuenta">
                    <SelectValue placeholder="Selecciona tipo de cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— seleccionar —</SelectItem>
                    {(tiposCuentaQ.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="tipoServicio">Tipo de servicio (opcional)</Label>
                <Select
                  value={tipoServicio || "none"}
                  onValueChange={(v) =>
                    setTipoServicio(v === "none" ? "" : (v as "HOSPITALARIO" | "NO_HOSPITALARIO"))
                  }
                >
                  <SelectTrigger id="tipoServicio">
                    <SelectValue placeholder="Sin especificar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin especificar</SelectItem>
                    {Object.entries(TIPO_SERVICIO_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMostrarCrear(false);
                    setCrearError(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button type="button" size="sm" onClick={handleCrear} disabled={crearMutation.isPending}>
                  {crearMutation.isPending ? "Creando…" : "Crear cuenta"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

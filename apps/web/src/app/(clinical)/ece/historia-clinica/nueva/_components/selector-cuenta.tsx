"use client";

/**
 * Selector de cuenta inline para la Historia Clínica (CC-0007).
 *
 * Se muestra cuando se entra a /ece/historia-clinica/nueva sin `?cuentaId=`.
 * En vez de un callejón sin salida, permite buscar un paciente y elegir una
 * de sus cuentas; al elegirla, navega a `?cuentaId=<uuid>` y la página
 * continúa el flujo normal.
 */

import * as React from "react";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

interface SelectorCuentaProps {
  onSelect: (cuentaId: string) => void;
}

export function SelectorCuenta({ onSelect }: SelectorCuentaProps) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [pacienteSel, setPacienteSel] = React.useState<{
    id: string;
    nombre: string;
  } | null>(null);

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

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-lg font-semibold text-foreground">Nueva Historia Clínica</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Seleccione la cuenta del paciente para iniciar la historia clínica.
      </p>

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
                  Sin resultados para “{debounced}”.
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
            <Button type="button" variant="ghost" size="sm" onClick={() => setPacienteSel(null)}>
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
            ) : (cuentasQ.data?.length ?? 0) === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Este paciente no tiene cuentas. Cree una cuenta desde el expediente
                antes de iniciar la historia clínica.
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
                        {c.servicios.length > 0
                          ? c.servicios.map((s) => s.tipo).join(", ")
                          : "Sin servicios"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * US-1.1 — Tabla de Países.
 *
 * UX:
 *  - Búsqueda por nombre o ISO alpha-3 (server-side).
 *  - Toggle "Mostrar inactivos" (default: muestra todos).
 *  - Acción "Editar" abre el form en modo edit.
 *  - Acción "Desactivar" bloquea con TRPCError BAD_REQUEST si hay organizaciones
 *    activas asociadas al país (validado en el router).
 *  - "Reactivar" para revivir país inactivo.
 *  - Toast Shadcn al completar acciones.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

type CurrencyRow = { id: string; isoCode: string; name: string };
type Row = {
  id: string;
  isoAlpha3: string;
  isoNumeric: number;
  name: string;
  defaultLocale: string;
  defaultTzId: string;
  active: boolean;
  currencies?: Array<{ currency: CurrencyRow; isFunctional: boolean }>;
};

interface CountryTableProps {
  onEdit: (row: Row) => void;
}

export function CountryTable({ onEdit }: CountryTableProps) {
  const [showInactive, setShowInactive] = React.useState(true);
  const [search, setSearch] = React.useState("");

  const utils = trpc.useUtils();
  const query = trpc.country.list.useQuery({
    activeOnly: !showInactive,
    search: search.trim().length > 0 ? search.trim() : undefined,
  });

  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const deactivate = trpc.country.deactivate.useMutation({
    onSuccess: () => {
      utils.country.list.invalidate();
      setToast({ title: "País desactivado", variant: "success" });
    },
    onError: (err) =>
      setToast({ title: "No se puede desactivar", description: err.message, variant: "destructive" }),
  });

  const activate = trpc.country.activate.useMutation({
    onSuccess: () => {
      utils.country.list.invalidate();
      setToast({ title: "País reactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rows = (query.data ?? []) as Row[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por nombre o ISO alpha-3…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Mostrar inactivos
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {query.isLoading ? "Cargando…" : `${rows.length} país(es)`}
        </span>
      </div>

      {query.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Error: {query.error.message}
        </p>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">ISO-3</TableHead>
              <TableHead className="w-20">Numérico</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-28">Locale</TableHead>
              <TableHead className="w-44">Timezone</TableHead>
              <TableHead className="w-28">Moneda</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-44 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !query.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Sin países registrados.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => {
              const fn = row.currencies?.[0]?.currency;
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.isoAlpha3}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {String(row.isoNumeric).padStart(3, "0")}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="font-mono text-xs">{row.defaultLocale}</TableCell>
                  <TableCell className="font-mono text-xs">{row.defaultTzId}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {fn ? fn.isoCode : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {row.active ? (
                      <Badge variant="success">Activo</Badge>
                    ) : (
                      <Badge variant="outline">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => onEdit(row)}>
                        Editar
                      </Button>
                      {row.active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deactivate.mutate({ id: row.id })}
                          disabled={deactivate.isPending}
                        >
                          Desactivar
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => activate.mutate({ id: row.id })}
                          disabled={activate.isPending}
                        >
                          Reactivar
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}

export type { Row as CountryRow };

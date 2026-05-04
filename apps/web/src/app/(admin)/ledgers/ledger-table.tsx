"use client";

/**
 * US-1.4 — Tabla de libros contables por organización.
 *
 * Columnas: kind (badge color-coded) · name · moneda · estado · count cuentas · acciones.
 * Filtros: kind (select), activeOnly (checkbox).
 * Acciones por fila: Ver detalle (link) · Editar (Dialog) · Activar/Desactivar (mutation).
 *
 * Color-coding (variants existentes en `@his/ui/components/badge`):
 *   FISCAL_LOCAL → critical (rojo)  — fiscal/regulatorio
 *   IFRS         → info     (azul)  — estándar internacional
 *   US_GAAP      → secondary        — estándar EE.UU.
 *   MANAGEMENT   → success  (verde) — gerencial
 *   BUDGET       → warning  (ámbar) — presupuesto
 *   STATISTICAL  → outline          — no financiero
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import { LedgerForm } from "./ledger-form";

type LedgerKind =
  | "FISCAL_LOCAL"
  | "IFRS"
  | "US_GAAP"
  | "MANAGEMENT"
  | "BUDGET"
  | "STATISTICAL";

type LedgerRow = {
  id: string;
  organizationId: string;
  kind: LedgerKind;
  code: string;
  name: string;
  currencyId: string;
  active: boolean;
  createdAt: string | Date;
  currency: { id: string; isoCode: string; name: string; symbol: string };
};

const KIND_LABELS: Record<LedgerKind, string> = {
  FISCAL_LOCAL: "Fiscal Local",
  IFRS: "NIIF (IFRS)",
  US_GAAP: "US GAAP",
  MANAGEMENT: "Gerencial",
  BUDGET: "Presupuesto",
  STATISTICAL: "Estadístico",
};

const KIND_VARIANT: Record<
  LedgerKind,
  "critical" | "info" | "secondary" | "success" | "warning" | "outline"
> = {
  FISCAL_LOCAL: "critical",
  IFRS: "info",
  US_GAAP: "secondary",
  MANAGEMENT: "success",
  BUDGET: "warning",
  STATISTICAL: "outline",
};

const KINDS: LedgerKind[] = [
  "FISCAL_LOCAL",
  "IFRS",
  "US_GAAP",
  "MANAGEMENT",
  "BUDGET",
  "STATISTICAL",
];

interface LedgerTableProps {
  organizationId: string;
}

export function LedgerTable({ organizationId }: LedgerTableProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;

  const [kindFilter, setKindFilter] = React.useState<string>("");
  const [activeOnly, setActiveOnly] = React.useState(false);
  const [editing, setEditing] = React.useState<LedgerRow | undefined>(undefined);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const utils = trpc.useUtils();

  const query = trpcAny.ledger.list.useQuery({
    organizationId,
    ...(kindFilter ? { kind: kindFilter } : {}),
    ...(activeOnly ? { activeOnly: true } : {}),
  });

  const activate = trpcAny.ledger.activate.useMutation({
    onSuccess: () => {
      query.refetch?.();
      utils.invalidate();
      setToast({ title: "Libro activado", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deactivate = trpcAny.ledger.deactivate.useMutation({
    onSuccess: () => {
      query.refetch?.();
      utils.invalidate();
      setToast({ title: "Libro desactivado", variant: "success" });
    },
    onError: (err: { message: string }) =>
      setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rows = (query.data ?? []) as LedgerRow[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Tipo de libro</label>
          <Select
            value={kindFilter || "all"}
            onValueChange={(v) => setKindFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Solo activos
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {query.isLoading ? "Cargando…" : `${rows.length} libro(s)`}
        </span>
        <Button onClick={() => setCreateOpen(true)}>+ Nuevo libro</Button>
      </div>

      {query.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Error: {(query.error as { message?: string })?.message ?? "Error al cargar libros."}
        </p>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Tipo</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead className="w-32">Moneda</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-28 text-right">Cuentas</TableHead>
              <TableHead className="w-72 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !query.isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  Sin libros para esta organización. Crea uno con &quot;+ Nuevo libro&quot;.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge variant={KIND_VARIANT[row.kind]}>{KIND_LABELS[row.kind]}</Badge>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/ledgers/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.currency.isoCode} ({row.currency.symbol})
                </TableCell>
                <TableCell>
                  {row.active ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="outline">Inactivo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  0 <span className="text-muted-foreground">(Sprint 5)</span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/ledgers/${row.id}`}>Ver</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(row)}>
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
            ))}
          </TableBody>
        </Table>
      </div>

      <LedgerForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
        onSuccess={() => query.refetch?.()}
      />

      <LedgerForm
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(undefined)}
        organizationId={organizationId}
        initialValue={editing}
        onSuccess={() => query.refetch?.()}
      />

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

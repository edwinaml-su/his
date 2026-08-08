"use client";

/**
 * CC-0017 F2 — CRUD de reglas ABAC (`AbacRule`).
 *
 * Reemplaza la vista solo-lectura de MVP (que listaba `MVP_ABAC_RULES`
 * hardcoded desde `apps/web/src/lib/auth/abac.ts`). Las reglas ahora viven
 * en BD y se evalúan server-side (`packages/trpc/src/abac/motor.ts`),
 * cableadas opt-in en 3 procedures de prueba de concepto (prescripción,
 * dispensación, firma) — ver `docs/CC/0017/REQ-SEC-ABAC-002-*.md`.
 *
 * Patrón espejo de /roles: tabla + filtro + Dialog de alta/edición.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";
import type { AbacRuleRecord } from "@his/contracts";
import { AbacForm } from "./abac-form";

const RECURSOS_FILTRO = ["__all", "patient", "prescription", "dispensation", "service", "signature"] as const;
const ACCIONES_FILTRO = ["__all", "access", "prescribe", "dispense", "sign"] as const;

export default function AbacPage() {
  const [recursoFiltro, setRecursoFiltro] = React.useState<(typeof RECURSOS_FILTRO)[number]>("__all");
  const [accionFiltro, setAccionFiltro] = React.useState<(typeof ACCIONES_FILTRO)[number]>("__all");
  const [showInactive, setShowInactive] = React.useState(true);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AbacRuleRecord | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const utils = trpc.useUtils();
  const query = trpc.abac.list.useQuery({
    recurso: recursoFiltro === "__all" ? undefined : recursoFiltro,
    accion: accionFiltro === "__all" ? undefined : accionFiltro,
    activeOnly: !showInactive,
  });

  const setActiveMut = trpc.abac.setActive.useMutation({
    onSuccess: () => {
      utils.abac.list.invalidate();
      setToast({ title: "Estado actualizado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMut = trpc.abac.delete.useMutation({
    onSuccess: () => {
      utils.abac.list.invalidate();
      setToast({ title: "Regla eliminada", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reglas ABAC</h1>
          <p className="text-sm text-muted-foreground">
            US-2.4 — control de acceso por atributos (TDR §6.2). Editable por
            organización; se evalúa server-side donde se cableó `abacGuard`.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nueva regla
        </Button>
      </div>

      <Alert>
        <AlertTitle>Enforcement parcial (Fase 2)</AlertTitle>
        <AlertDescription>
          Las reglas se evalúan en 3 puntos de prueba de concepto:
          prescripción (indicaciones médicas), dispensación (farmacia) y
          firma electrónica. El resto de recursos aún no consulta esta tabla
          — enforcement es fail-safe: sin regla que aplique, el acceso se
          permite.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={recursoFiltro} onValueChange={(v) => setRecursoFiltro(v as typeof recursoFiltro)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Recurso" /></SelectTrigger>
          <SelectContent>
            {RECURSOS_FILTRO.map((r) => (
              <SelectItem key={r} value={r}>{r === "__all" ? "Todos los recursos" : r}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={accionFiltro} onValueChange={(v) => setAccionFiltro(v as typeof accionFiltro)}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Acción" /></SelectTrigger>
          <SelectContent>
            {ACCIONES_FILTRO.map((a) => (
              <SelectItem key={a} value={a}>{a === "__all" ? "Todas las acciones" : a}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Mostrar inactivas
        </label>

        <span className="ml-auto text-xs text-muted-foreground">
          {query.isLoading ? "Cargando…" : `${rows.length} regla(s)`}
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
              <TableHead className="w-32">Recurso</TableHead>
              <TableHead className="w-28">Acción</TableHead>
              <TableHead className="w-24">Efecto</TableHead>
              <TableHead className="w-20 text-right">Prioridad</TableHead>
              <TableHead>Condiciones</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-56 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !query.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  Sin reglas para este filtro.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.recurso}</TableCell>
                <TableCell className="font-mono text-xs">{r.accion}</TableCell>
                <TableCell>
                  <Badge variant={r.effect === "DENY" ? "destructive" : "success"}>{r.effect}</Badge>
                </TableCell>
                <TableCell className="text-right">{r.prioridad}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {r.condiciones.length === 0
                    ? "(sin condiciones)"
                    : r.condiciones
                        .map((c) => `${c.atributo} ${c.operador} ${JSON.stringify(c.valor)}`)
                        .join(" AND ")}
                </TableCell>
                <TableCell className="text-xs">{r.descripcion}</TableCell>
                <TableCell>
                  {r.active ? (
                    <Badge variant="success">Activa</Badge>
                  ) : (
                    <Badge variant="outline">Inactiva</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveMut.mutate({ id: r.id, active: !r.active })}
                      disabled={setActiveMut.isPending}
                    >
                      {r.active ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (window.confirm("¿Eliminar esta regla ABAC?")) {
                          deleteMut.mutate({ id: r.id });
                        }
                      }}
                      disabled={deleteMut.isPending}
                    >
                      Eliminar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AbacForm
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSuccess={() =>
          setToast({ title: editing ? "Regla actualizada" : "Regla creada", variant: "success" })
        }
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

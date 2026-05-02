"use client";

/**
 * US-1.8 — Visor de cambios estructurales (Organization + Establishment).
 *
 * Filtros:
 *   - Rango: presets (7d / 30d / custom) + datepickers nativos.
 *   - Tipo de entidad: ALL / Organization / Establishment.
 *   - Acción: CREATE / UPDATE / DELETE (resto del enum se omite — no aplica
 *     a estructura organizativa).
 *   - organizationId: opcional, llega via query string desde el tree
 *     (click en "Ver auditoría" en el dialog de detalle).
 *
 * Consume `audit.listOrgChanges`. La tabla muestra timestamp + usuario +
 * acción + entidad + diff resumen leyendo `changedFields` (calculado en
 * server) y un tooltip/expand con los valores antes/después por campo.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

type EntityKind = "ALL" | "Organization" | "Establishment";
type ActionFilter = "ALL" | "CREATE" | "UPDATE" | "DELETE";
type Preset = "7d" | "30d" | "custom";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function OrganizationAuditPage() {
  const params = useSearchParams();
  const organizationIdParam = params.get("organizationId") ?? "";

  const [organizationId, setOrganizationId] = React.useState(organizationIdParam);
  const [entityKind, setEntityKind] = React.useState<EntityKind>("ALL");
  const [action, setAction] = React.useState<ActionFilter>("ALL");
  const [preset, setPreset] = React.useState<Preset>("30d");

  const today = React.useMemo(() => new Date(), []);
  const sevenDaysAgo = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }, []);
  const thirtyDaysAgo = React.useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const [from, setFrom] = React.useState<string>(isoDate(thirtyDaysAgo));
  const [to, setTo] = React.useState<string>(isoDate(today));

  React.useEffect(() => {
    if (preset === "7d") {
      setFrom(isoDate(sevenDaysAgo));
      setTo(isoDate(today));
    } else if (preset === "30d") {
      setFrom(isoDate(thirtyDaysAgo));
      setTo(isoDate(today));
    }
  }, [preset, sevenDaysAgo, thirtyDaysAgo, today]);

  const query = trpc.audit.listOrgChanges.useQuery({
    organizationId: organizationId.trim() || undefined,
    entityKind,
    action: action === "ALL" ? undefined : action,
    from: from ? new Date(from + "T00:00:00.000Z") : undefined,
    to: to ? new Date(to + "T23:59:59.999Z") : undefined,
    page: 1,
    pageSize: 100,
  });

  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Auditoría — Estructura organizativa</h1>
        <p className="text-sm text-muted-foreground">
          Cambios sobre Organization y Establishment (TDR §6.3 / US-1.8). Las
          filas muestran sólo los campos que cambiaron entre antes y después.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="preset">Rango</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger id="preset" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7d">Últimos 7 días</SelectItem>
                  <SelectItem value="30d">Últimos 30 días</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Desde</Label>
              <Input
                id="from"
                type="date"
                value={from}
                disabled={preset !== "custom"}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Hasta</Label>
              <Input
                id="to"
                type="date"
                value={to}
                disabled={preset !== "custom"}
                onChange={(e) => setTo(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entityKind">Entidad</Label>
              <Select
                value={entityKind}
                onValueChange={(v) => setEntityKind(v as EntityKind)}
              >
                <SelectTrigger id="entityKind" className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  <SelectItem value="Organization">Organization</SelectItem>
                  <SelectItem value="Establishment">Establishment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action">Acción</Label>
              <Select
                value={action}
                onValueChange={(v) => setAction(v as ActionFilter)}
              >
                <SelectTrigger id="action" className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  <SelectItem value="CREATE">CREATE</SelectItem>
                  <SelectItem value="UPDATE">UPDATE</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="orgId">ID organización (opcional)</Label>
              <Input
                id="orgId"
                value={organizationId}
                onChange={(e) => setOrganizationId(e.target.value)}
                placeholder="UUID"
                className="w-[320px]"
              />
            </div>
            <Button variant="outline" onClick={() => query.refetch()}>
              Refrescar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Eventos
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {query.isLoading ? "Cargando…" : `${items.length} registros`}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{query.error.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Fecha</TableHead>
                  <TableHead className="w-[110px]">Acción</TableHead>
                  <TableHead className="w-[140px]">Entidad</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Cambios</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Sin eventos en el rango seleccionado.
                    </TableCell>
                  </TableRow>
                ) : null}
                {items.map((it) => (
                  <AuditRow key={it.id} item={it} />
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AuditRow({
  item,
}: {
  item: {
    id: string;
    occurredAt: Date | string;
    action: string;
    entity: string;
    entityId: string | null;
    userLabel: string | null;
    userId: string | null;
    changedFields: string[];
    beforeJson?: unknown;
    afterJson?: unknown;
  };
}) {
  const [open, setOpen] = React.useState(false);
  const dt = new Date(item.occurredAt);
  const before = (item.beforeJson ?? {}) as Record<string, unknown>;
  const after = (item.afterJson ?? {}) as Record<string, unknown>;

  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell className="tabular-nums text-xs">
          {dt.toLocaleString("es-SV")}
        </TableCell>
        <TableCell>
          <Badge
            variant={
              item.action === "DELETE"
                ? "destructive"
                : item.action === "CREATE"
                  ? "success"
                  : "outline"
            }
          >
            {item.action}
          </Badge>
        </TableCell>
        <TableCell>
          <span className="font-medium">{item.entity}</span>
          <div className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">
            {item.entityId ?? "—"}
          </div>
        </TableCell>
        <TableCell className="text-sm">
          {item.userLabel ?? item.userId ?? "—"}
        </TableCell>
        <TableCell className="text-xs">
          {item.changedFields.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="space-x-1">
              {item.changedFields.slice(0, 6).map((f) => (
                <Badge key={f} variant="outline" className="text-[10px]">
                  {f}
                </Badge>
              ))}
              {item.changedFields.length > 6 ? (
                <span className="text-muted-foreground">
                  +{item.changedFields.length - 6}
                </span>
              ) : null}
            </span>
          )}
        </TableCell>
      </TableRow>
      {open && item.changedFields.length > 0 ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="space-y-1 text-xs">
              {item.changedFields.map((f) => (
                <div key={f} className="grid grid-cols-[160px_1fr_1fr] gap-2">
                  <span className="font-mono text-muted-foreground">{f}</span>
                  <span className="font-mono break-all">
                    <span className="text-muted-foreground">antes: </span>
                    {JSON.stringify(before[f] ?? null)}
                  </span>
                  <span className="font-mono break-all">
                    <span className="text-muted-foreground">después: </span>
                    {JSON.stringify(after[f] ?? null)}
                  </span>
                </div>
              ))}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

"use client";

/**
 * US-5.6 — Listado de certificados de defunción emitidos en la organización.
 * Acceso restringido a PHYSICIAN o ADMIN (validado en el router).
 */
import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

type Manner = "natural" | "accident" | "suicide" | "homicide" | "undetermined";

const MANNER_LABEL: Record<Manner, string> = {
  natural: "Natural",
  accident: "Accidente",
  suicide: "Suicidio",
  homicide: "Homicidio",
  undetermined: "Indeterminado",
};

const MANNER_VARIANT: Record<
  Manner,
  "default" | "secondary" | "outline" | "destructive" | "success"
> = {
  natural: "secondary",
  accident: "outline",
  suicide: "destructive",
  homicide: "destructive",
  undetermined: "outline",
};

export default function DeathsListPage() {
  const [manner, setManner] = React.useState<Manner | "">("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);

  const list = trpc.deathCertificate.list.useQuery({
    page,
    pageSize: 20,
    manner: manner || undefined,
    dateFrom: from ? new Date(from) : undefined,
    dateTo: to ? new Date(to) : undefined,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Certificados de defunción</h1>
        <p className="text-sm text-muted-foreground">
          Registro de certificados emitidos. Acceso restringido a personal
          médico y administrativo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="from">Desde</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Hasta</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Modo</Label>
              <Select
                value={manner}
                onValueChange={(v) => setManner(v as Manner | "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Todos</SelectItem>
                  {(Object.keys(MANNER_LABEL) as Manner[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MANNER_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setManner("");
                  setFrom("");
                  setTo("");
                  setPage(1);
                }}
              >
                Limpiar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Resultados {list.data ? `(${list.data.total})` : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : list.error ? (
            <p className="text-sm text-destructive">{list.error.message}</p>
          ) : !list.data || list.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin certificados emitidos para los filtros seleccionados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>MRN</TableHead>
                  <TableHead>Fecha fallecimiento</TableHead>
                  <TableHead>Causa básica</TableHead>
                  <TableHead>Modo</TableHead>
                  <TableHead>Médico certificante</TableHead>
                  <TableHead>Reg. Civil</TableHead>
                  <TableHead aria-label="acciones" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((c) => {
                  const m = c.manner as Manner | null | undefined;
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        {c.patient.firstName} {c.patient.lastName}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.patient.mrn}
                      </TableCell>
                      <TableCell>
                        {new Date(c.occurredAt).toLocaleString("es-SV")}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {c.basicCauseCode}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {c.basicCauseDesc}
                        </span>
                      </TableCell>
                      <TableCell>
                        {m ? (
                          <Badge variant={MANNER_VARIANT[m]}>
                            {MANNER_LABEL[m]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.certifiedById.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        {c.notifiedToCivilRegistryAt ? (
                          <Badge variant="success">Notificado</Badge>
                        ) : (
                          <Badge variant="outline">Pendiente</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          className="text-sm text-primary underline"
                          href={`/deaths/${c.id}`}
                        >
                          Ver
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {list.data && list.data.total > list.data.pageSize ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Página {page}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * list.data.pageSize >= list.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

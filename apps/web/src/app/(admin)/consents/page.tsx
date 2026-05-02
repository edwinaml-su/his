"use client";

/**
 * US-2.9 — Listado paginado de consentimientos firmados.
 *
 * Filtros: paciente (UUID), propósito, estado (vigente/revocado/expirado), rango de fechas.
 * Acción inline: revocar (solo vigentes).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
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
import { trpc } from "@/lib/trpc/react";

type Status = "active" | "revoked" | "expired";
type Purpose = "data-processing" | "mpi-cross-org" | "transfusion" | "research" | "telemedicine";

const PURPOSE_LABEL: Record<Purpose, string> = {
  "data-processing": "Tratamiento de datos",
  "mpi-cross-org": "Compartir entre estab.",
  transfusion: "Transfusión",
  research: "Investigación",
  telemedicine: "Telemedicina",
};

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive"> = {
  active: "default",
  revoked: "destructive",
  expired: "secondary",
};

export default function ConsentsListPage() {
  const [patientId, setPatientId] = React.useState("");
  const [purpose, setPurpose] = React.useState<"" | Purpose>("");
  const [status, setStatus] = React.useState<"" | Status>("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const pageSize = 20;

  const query = trpc.consent.list.useQuery({
    patientId: patientId.trim() || undefined,
    purpose: purpose || undefined,
    status: status || undefined,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    page,
    pageSize,
  });

  const utils = trpc.useUtils();
  const revoke = trpc.consent.revoke.useMutation({
    onSuccess: () => utils.consent.list.invalidate(),
  });

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Consentimientos firmados</h1>
          <p className="text-sm text-muted-foreground">
            Registro de consentimientos de tratamiento de datos (TDR §6.4).
          </p>
        </div>
        <a href="/consents/templates" className="text-sm underline">
          Plantillas vigentes
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-3 md:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              query.refetch();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="patientId">Paciente (UUID)</Label>
              <Input
                id="patientId"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                placeholder="UUID del paciente"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Propósito</Label>
              <Select
                value={purpose || "__all"}
                onValueChange={(v) => setPurpose(v === "__all" ? "" : (v as Purpose))}
              >
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos</SelectItem>
                  {(Object.keys(PURPOSE_LABEL) as Purpose[]).map((p) => (
                    <SelectItem key={p} value={p}>{PURPOSE_LABEL[p]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select
                value={status || "__all"}
                onValueChange={(v) => setStatus(v === "__all" ? "" : (v as Status))}
              >
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos</SelectItem>
                  <SelectItem value="active">Vigente</SelectItem>
                  <SelectItem value="revoked">Revocado</SelectItem>
                  <SelectItem value="expired">Expirado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Desde</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Hasta</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="md:col-span-5">
              <Button type="submit">Aplicar filtros</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Resultados {query.data ? `(${query.data.total})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && <p className="text-sm text-destructive">{query.error.message}</p>}
          {query.data && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha firma</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Propósito</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead>Firmado por</TableHead>
                    <TableHead className="w-32"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Sin consentimientos para los filtros seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    query.data.items.map((row) => {
                      const s = row.status as Status;
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-xs">
                            {new Date(row.signedAt).toLocaleString("es-SV")}
                          </TableCell>
                          <TableCell>
                            {row.patient.lastName}, {row.patient.firstName}
                            <div className="font-mono text-xs text-muted-foreground">
                              MRN {row.patient.mrn}
                            </div>
                          </TableCell>
                          <TableCell>
                            {PURPOSE_LABEL[row.purpose as Purpose] ?? row.purpose}
                          </TableCell>
                          <TableCell>
                            <Badge variant={STATUS_VARIANT[s]}>
                              {s === "active" ? "Vigente" : s === "revoked" ? "Revocado" : "Expirado"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {new Date(row.validFrom).toLocaleDateString("es-SV")}
                            {" → "}
                            {row.validTo
                              ? new Date(row.validTo).toLocaleDateString("es-SV")
                              : "indef."}
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.signedBy?.fullName ?? "—"}
                          </TableCell>
                          <TableCell>
                            {s === "active" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={revoke.isPending}
                                onClick={() => {
                                  if (confirm("¿Revocar este consentimiento? La acción es inmutable.")) {
                                    revoke.mutate({ id: row.id });
                                  }
                                }}
                              >
                                Revocar
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Página {page} de {totalPages}
                </span>
                <div className="space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

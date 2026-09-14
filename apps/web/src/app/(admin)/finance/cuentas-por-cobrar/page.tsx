"use client";

/**
 * CC-0027 — Worklist de Cuentas por Cobrar (ruta B del alta administrativa).
 *
 * `AccountReceivable` se crea desde `patientAccount.altaAdministrativa`
 * (ruta CXC) cuando el paciente/fiador firma pagaré, convenio de pago o
 * reconocimiento de deuda. Esta pantalla es el worklist de cobros: filtro
 * por estado + registro de abonos. UI mínima — patrón de `finance/reportes`
 * y `finance/conciliacion` (tablas Shadcn, sin export).
 */
import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
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

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "outline" | "warning"> = {
  ABIERTA: "warning",
  PAGADA: "default",
  INCOBRABLE: "outline",
};

const DOCUMENTO_LABEL: Record<string, string> = {
  PAGARE: "Pagaré",
  CONVENIO_PAGO: "Convenio de pago",
  RECONOCIMIENTO_DEUDA: "Reconocimiento de deuda",
};

function fmt(n: number): string {
  return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtFecha(v: string | Date): string {
  return new Date(v).toLocaleDateString("es-SV");
}

export default function CuentasPorCobrarPage() {
  const [estado, setEstado] = React.useState<"ABIERTA" | "PAGADA" | "INCOBRABLE" | "todas">(
    "ABIERTA",
  );
  const [abonando, setAbonando] = React.useState<string | null>(null);
  const [monto, setMonto] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const listQ = trpc.cxc.list.useQuery(estado === "todas" ? {} : { estado });

  const abonoMutation = trpc.cxc.registrarAbono.useMutation({
    onSuccess: () => {
      setAbonando(null);
      setMonto("");
      setError(null);
      void listQ.refetch();
    },
    onError: (err) => setError(err.message),
  });

  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cuentas por Cobrar</h1>
        <p className="text-sm text-muted-foreground">
          CC-0027 — Ruta B del alta administrativa: pacientes o fiadores solidarios que
          firmaron un documento de aceptación de deuda por no tener liquidez inmediata al
          egreso.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtro</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs space-y-1">
            <Label htmlFor="estado">Estado</Label>
            <Select value={estado} onValueChange={(v) => setEstado(v as typeof estado)}>
              <SelectTrigger id="estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ABIERTA">Abiertas</SelectItem>
                <SelectItem value="PAGADA">Pagadas</SelectItem>
                <SelectItem value="INCOBRABLE">Incobrables</SelectItem>
                <SelectItem value="todas">Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Cuentas por cobrar</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Firmante</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Cargando…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Sin cuentas por cobrar para este filtro.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        {r.account?.numeroCuenta ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.account?.patient
                          ? `${r.account.patient.firstName} ${r.account.patient.lastName}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {DOCUMENTO_LABEL[r.documentoTipo] ?? r.documentoTipo} — {r.folioDocumento}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.firmanteNombre} ({r.firmanteTipo === "PACIENTE" ? "paciente" : "fiador"})
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${fmt(Number(r.saldoActual))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={ESTADO_VARIANT[r.estado] ?? "secondary"}>{r.estado}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{fmtFecha(r.createdAt)}</TableCell>
                      <TableCell>
                        {r.estado === "ABIERTA" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setAbonando((prev) => (prev === r.id ? null : r.id));
                              setMonto("");
                              setError(null);
                            }}
                          >
                            Abonar
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {abonando === r.id ? (
                      <TableRow>
                        <TableCell colSpan={8}>
                          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                            <div className="space-y-1">
                              <Label htmlFor={`monto-${r.id}`}>Monto del abono *</Label>
                              <Input
                                id={`monto-${r.id}`}
                                type="number"
                                min="0"
                                step="0.01"
                                className="w-40"
                                value={monto}
                                onChange={(e) => setMonto(e.target.value)}
                              />
                            </div>
                            <Button
                              size="sm"
                              disabled={!monto || abonoMutation.isPending}
                              onClick={() =>
                                abonoMutation.mutate({ id: r.id, monto: Number(monto) })
                              }
                            >
                              {abonoMutation.isPending ? "Registrando…" : "Registrar abono"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setAbonando(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

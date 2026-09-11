"use client";

/**
 * Pestaña "Cuentas" de la vista 360° del paciente — UI mínima de cierre y
 * regularización de cuenta (RN-HIS-BOT-001 R11, guion UAT pruebas #4/#7:
 * hasta ahora no existía botón y el cierre requería asistencia técnica).
 *
 * - "Cerrar cuenta" → `patientAccount.cerrar`. Si bloquea con
 *   PRECONDITION_FAILED, el errorFormatter (packages/trpc/src/trpc.ts)
 *   reenvía `data.causas` — las 5 causas de bloqueo se listan en pantalla
 *   (mismo patrón que `interactionAlerts` en indicaciones, ADR 0023).
 * - "Regularizar" (solo cuentas PENDIENTE_REGULARIZAR) → asigna tipo de
 *   cuenta y pasa a ABIERTA. El server exige rol ADMIN/ACCOUNTANT.
 */

import * as React from "react";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
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

interface CausaBloqueo {
  tipo?: string;
  mensaje?: string;
  count?: number;
  codes?: string[];
}

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "outline" | "warning"> = {
  ABIERTA: "default",
  PENDIENTE_REGULARIZAR: "warning",
  CERRADA: "outline",
};

export function PatientCuentas({ patientId }: { patientId: string }) {
  const cuentasQ = trpc.patientAccount.listarPorPaciente.useQuery({ patientId });
  const tiposCuentaQ = trpc.tipoCuenta.list.useQuery({ activeOnly: true });

  // Causas de bloqueo del último intento de cierre, ancladas a la cuenta.
  const [causasCierre, setCausasCierre] = React.useState<{
    accountId: string;
    causas: CausaBloqueo[];
  } | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  // Panel inline de regularización (una cuenta a la vez).
  const [regularizando, setRegularizando] = React.useState<string | null>(null);
  const [tipoCuentaId, setTipoCuentaId] = React.useState("");

  const cerrarMutation = trpc.patientAccount.cerrar.useMutation({
    onSuccess: () => {
      setCausasCierre(null);
      setServerError(null);
      void cuentasQ.refetch();
    },
    onError: (err, input) => {
      const causas = (err.data as { causas?: unknown } | undefined)?.causas;
      if (
        err.data?.code === "PRECONDITION_FAILED" &&
        Array.isArray(causas) &&
        causas.length > 0
      ) {
        setCausasCierre({ accountId: input.accountId, causas: causas as CausaBloqueo[] });
        setServerError(null);
      } else {
        setCausasCierre(null);
        setServerError(err.message);
      }
    },
  });

  const regularizarMutation = trpc.patientAccount.regularizar.useMutation({
    onSuccess: () => {
      setRegularizando(null);
      setTipoCuentaId("");
      setServerError(null);
      void cuentasQ.refetch();
    },
    onError: (err) => setServerError(err.message),
  });

  if (cuentasQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando cuentas…</p>;
  }
  if (cuentasQ.error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {cuentasQ.error.message}
      </p>
    );
  }
  const cuentas = cuentasQ.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuentas del paciente</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cierre de cuenta (RN-HIS-BOT-001 R11): el sistema bloquea el cierre si hay cargos
          sin tarifa, pagador sin definir o inconsistencias de dispensación, y lista todas
          las causas pendientes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {serverError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {serverError}
          </p>
        ) : null}

        {cuentas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este paciente no tiene cuentas.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N.º cuenta</TableHead>
                <TableHead>Tipo de cuenta</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Servicios</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cuentas.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.numeroCuenta}</TableCell>
                  <TableCell>{c.tipoCuenta?.nombre ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={ESTADO_VARIANT[c.status] ?? "secondary"}>
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.servicios.length > 0
                      ? c.servicios.map((s) => s.tipo).join(", ")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      {c.status === "PENDIENTE_REGULARIZAR" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRegularizando((prev) => (prev === c.id ? null : c.id));
                            setTipoCuentaId("");
                            setServerError(null);
                          }}
                        >
                          Regularizar
                        </Button>
                      ) : null}
                      {c.status !== "CERRADA" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={cerrarMutation.isPending}
                          onClick={() => {
                            setServerError(null);
                            setCausasCierre(null);
                            cerrarMutation.mutate({ accountId: c.id });
                          }}
                        >
                          {cerrarMutation.isPending && cerrarMutation.variables?.accountId === c.id
                            ? "Cerrando…"
                            : "Cerrar cuenta"}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {causasCierre !== null ? (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-4"
          >
            <p className="text-sm font-medium text-destructive">
              No se puede cerrar la cuenta{" "}
              {cuentas.find((c) => c.id === causasCierre.accountId)?.numeroCuenta ?? ""}:{" "}
              {causasCierre.causas.length} causa(s) de bloqueo pendientes.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {causasCierre.causas.map((causa, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{causa.tipo ?? "CAUSA"}</span>
                  {" — "}
                  {causa.mensaje ?? ""}
                  {Array.isArray(causa.codes) && causa.codes.length > 0
                    ? ` (${causa.codes.join(", ")})`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {regularizando !== null ? (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-foreground">
              Regularizar cuenta{" "}
              {cuentas.find((c) => c.id === regularizando)?.numeroCuenta ?? ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Asigna el pagador (tipo de cuenta) y la cuenta pasa a ABIERTA. Requiere rol
              administrativo.
            </p>
            <div className="max-w-sm space-y-1">
              <Label htmlFor="reg-tipoCuenta">Tipo de cuenta *</Label>
              <Select
                value={tipoCuentaId || "none"}
                onValueChange={(v) => setTipoCuentaId(v === "none" ? "" : v)}
              >
                <SelectTrigger id="reg-tipoCuenta">
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
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRegularizando(null);
                  setTipoCuentaId("");
                }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={!tipoCuentaId || regularizarMutation.isPending}
                onClick={() =>
                  regularizarMutation.mutate({ accountId: regularizando, tipoCuentaId })
                }
              >
                {regularizarMutation.isPending ? "Regularizando…" : "Regularizar"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

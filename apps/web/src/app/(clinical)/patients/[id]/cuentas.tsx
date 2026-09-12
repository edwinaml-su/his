"use client";

/**
 * Pestaña "Cuentas" de la vista 360° del paciente — UI mínima de cierre,
 * regularización y alta administrativa de cuenta (RN-HIS-BOT-001 R11 +
 * CC-0027).
 *
 * - "Cerrar cuenta" → `patientAccount.cerrar`. Si bloquea con
 *   PRECONDITION_FAILED, el errorFormatter (packages/trpc/src/trpc.ts)
 *   reenvía `data.causas` — las 6 causas de bloqueo se listan en pantalla
 *   (mismo patrón que `interactionAlerts` en indicaciones, ADR 0023).
 * - "Regularizar" (solo cuentas PENDIENTE_REGULARIZAR) → asigna tipo de
 *   cuenta y pasa a ABIERTA. El server exige rol ADMIN/ACCOUNTANT.
 * - "Alta administrativa" (CC-0027, Fase 2) → liquidación de la cuenta
 *   (cargos − pagos − cobertura = saldo) y las dos rutas de cierre:
 *   Ruta A (Cancelación total, saldo ≤ 0) o Ruta B (CxC, documento de
 *   deuda firmado). `altaAdministrativa` reutiliza el mismo bloque de
 *   causas de `cerrar` server-side — las causas se muestran igual que en
 *   "Cerrar cuenta". Al concluir: badge de ruta + "Egreso autorizado" si
 *   el encuentro ya quedó liberado.
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

const RUTA_LABEL: Record<string, string> = {
  CANCELACION_TOTAL: "Cancelación total",
  CXC: "Cuenta por cobrar",
};

const DOCUMENTO_DEUDA_LABEL: Record<string, string> = {
  PAGARE: "Pagaré",
  CONVENIO_PAGO: "Convenio de pago",
  RECONOCIMIENTO_DEUDA: "Reconocimiento de deuda",
};

function fmt(n: number): string {
  return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const RUTA_B_INICIAL = {
  documentoTipo: "PAGARE" as "PAGARE" | "CONVENIO_PAGO" | "RECONOCIMIENTO_DEUDA",
  folioDocumento: "",
  firmanteTipo: "PACIENTE" as "PACIENTE" | "FIADOR",
  firmanteNombre: "",
  firmanteDocumento: "",
  plazoDias: "",
};

const COBERTURA_INICIAL = {
  tipo: "CARTA_COBERTURA" as "CARTA_COBERTURA" | "FINIQUITO",
  montoAprobado: "",
  folio: "",
};

export function PatientCuentas({ patientId }: { patientId: string }) {
  const cuentasQ = trpc.patientAccount.listarPorPaciente.useQuery({ patientId });
  const tiposCuentaQ = trpc.tipoCuenta.list.useQuery({ activeOnly: true });

  // Causas de bloqueo del último intento de cierre/alta administrativa.
  const [causasCierre, setCausasCierre] = React.useState<{
    accountId: string;
    causas: CausaBloqueo[];
  } | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  // Panel inline de regularización (una cuenta a la vez).
  const [regularizando, setRegularizando] = React.useState<string | null>(null);
  const [tipoCuentaId, setTipoCuentaId] = React.useState("");

  // Panel inline de alta administrativa (CC-0027, una cuenta a la vez).
  const [altaAdminId, setAltaAdminId] = React.useState<string | null>(null);
  const [mostrarCobertura, setMostrarCobertura] = React.useState(false);
  const [rutaB, setRutaB] = React.useState(RUTA_B_INICIAL);
  const [cobertura, setCobertura] = React.useState(COBERTURA_INICIAL);

  const liquidacionQ = trpc.patientAccount.liquidacion.useQuery(
    { accountId: altaAdminId ?? "" },
    { enabled: altaAdminId !== null },
  );

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

  const altaAdministrativaMutation = trpc.patientAccount.altaAdministrativa.useMutation({
    onSuccess: () => {
      setAltaAdminId(null);
      setMostrarCobertura(false);
      setRutaB(RUTA_B_INICIAL);
      setCobertura(COBERTURA_INICIAL);
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

  const registrarCartaCoberturaMutation = trpc.patientAccount.registrarCartaCobertura.useMutation({
    onSuccess: () => {
      setCobertura(COBERTURA_INICIAL);
      setMostrarCobertura(false);
      setServerError(null);
      void liquidacionQ.refetch();
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
  const saldo = liquidacionQ.data?.saldo ?? null;
  const puedeCancelacionTotal = saldo !== null && saldo <= 0.005;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cuentas del paciente</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cierre de cuenta (RN-HIS-BOT-001 R11): el sistema bloquea el cierre si hay cargos
          sin tarifa, pagador sin definir o inconsistencias de dispensación, y lista todas
          las causas pendientes. El alta administrativa (CC-0027) exige además la
          conciliación financiera concluida por cancelación total o Cuenta por Cobrar.
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
                <TableHead>Alta administrativa</TableHead>
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
                  <TableCell className="text-xs">
                    {c.altaRuta ? (
                      <div className="flex flex-col gap-1">
                        <Badge variant="secondary">{RUTA_LABEL[c.altaRuta] ?? c.altaRuta}</Badge>
                        {c.encounter && c.encounter.egresoAutorizadoAt ? (
                          <span className="text-emerald-600">Egreso autorizado</span>
                        ) : c.encounter ? (
                          <span className="text-muted-foreground">
                            Egreso pendiente (otra cuenta del encuentro sigue activa)
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
                          onClick={() => {
                            setAltaAdminId((prev) => (prev === c.id ? null : c.id));
                            setMostrarCobertura(false);
                            setRutaB(RUTA_B_INICIAL);
                            setCobertura(COBERTURA_INICIAL);
                            setServerError(null);
                            setCausasCierre(null);
                          }}
                        >
                          Alta administrativa
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
              No se puede concluir el trámite de la cuenta{" "}
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

        {altaAdminId !== null ? (
          <div className="space-y-4 rounded-lg border border-border p-4">
            <p className="text-sm font-medium text-foreground">
              Alta administrativa — cuenta{" "}
              {cuentas.find((c) => c.id === altaAdminId)?.numeroCuenta ?? ""}
            </p>

            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              {liquidacionQ.isLoading ? (
                <p className="text-muted-foreground">Calculando liquidación…</p>
              ) : liquidacionQ.data ? (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  <dt className="text-muted-foreground">Cargos</dt>
                  <dd className="font-mono">${fmt(liquidacionQ.data.totalCargos)}</dd>
                  <dt className="text-muted-foreground">Pagos</dt>
                  <dd className="font-mono">${fmt(liquidacionQ.data.totalPagos)}</dd>
                  <dt className="text-muted-foreground">Cobertura aprobada</dt>
                  <dd className="font-mono">${fmt(liquidacionQ.data.coberturaAprobada)}</dd>
                  <dt className="font-medium text-foreground">Saldo</dt>
                  <dd className="font-mono font-semibold text-foreground">
                    ${fmt(liquidacionQ.data.saldo)}
                  </dd>
                </dl>
              ) : (
                <p className="text-destructive">{liquidacionQ.error?.message}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!puedeCancelacionTotal || altaAdministrativaMutation.isPending}
                onClick={() =>
                  altaAdministrativaMutation.mutate({
                    accountId: altaAdminId,
                    ruta: "CANCELACION_TOTAL",
                  })
                }
              >
                {altaAdministrativaMutation.isPending &&
                altaAdministrativaMutation.variables?.ruta === "CANCELACION_TOTAL"
                  ? "Cerrando…"
                  : "Ruta A — Cancelación total"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMostrarCobertura((v) => !v)}
              >
                {mostrarCobertura ? "Ocultar" : "+ Registrar carta de cobertura / finiquito"}
              </Button>
              {!puedeCancelacionTotal && saldo !== null ? (
                <span className="text-xs text-muted-foreground">
                  Saldo pendiente: ${fmt(saldo)} — registre pago/cobertura o use la Ruta B.
                </span>
              ) : null}
            </div>

            {mostrarCobertura ? (
              <div className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="cob-tipo">Tipo</Label>
                  <Select
                    value={cobertura.tipo}
                    onValueChange={(v) =>
                      setCobertura((s) => ({ ...s, tipo: v as typeof s.tipo }))
                    }
                  >
                    <SelectTrigger id="cob-tipo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CARTA_COBERTURA">Carta de cobertura</SelectItem>
                      <SelectItem value="FINIQUITO">Finiquito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cob-monto">Monto aprobado *</Label>
                  <Input
                    id="cob-monto"
                    type="number"
                    min="0"
                    step="0.01"
                    value={cobertura.montoAprobado}
                    onChange={(e) =>
                      setCobertura((s) => ({ ...s, montoAprobado: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cob-folio">Folio *</Label>
                  <Input
                    id="cob-folio"
                    value={cobertura.folio}
                    onChange={(e) => setCobertura((s) => ({ ...s, folio: e.target.value }))}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    size="sm"
                    disabled={
                      !cobertura.montoAprobado ||
                      !cobertura.folio ||
                      registrarCartaCoberturaMutation.isPending
                    }
                    onClick={() =>
                      registrarCartaCoberturaMutation.mutate({
                        accountId: altaAdminId,
                        tipo: cobertura.tipo,
                        montoAprobado: Number(cobertura.montoAprobado),
                        folio: cobertura.folio,
                      })
                    }
                  >
                    {registrarCartaCoberturaMutation.isPending ? "Guardando…" : "Registrar"}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">
                Ruta B — Cuenta por Cobrar (sin liquidez inmediata)
              </p>
              <p className="text-xs text-muted-foreground">
                El paciente o un fiador solidario firma un documento formal de aceptación de
                deuda. Formaliza la CxC y otorga la autorización de egreso físico.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="rb-tipo">Tipo de documento *</Label>
                  <Select
                    value={rutaB.documentoTipo}
                    onValueChange={(v) =>
                      setRutaB((s) => ({ ...s, documentoTipo: v as typeof s.documentoTipo }))
                    }
                  >
                    <SelectTrigger id="rb-tipo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DOCUMENTO_DEUDA_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rb-folio">Folio del documento *</Label>
                  <Input
                    id="rb-folio"
                    value={rutaB.folioDocumento}
                    onChange={(e) => setRutaB((s) => ({ ...s, folioDocumento: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rb-plazo">Plazo (días)</Label>
                  <Input
                    id="rb-plazo"
                    type="number"
                    min="1"
                    value={rutaB.plazoDias}
                    onChange={(e) => setRutaB((s) => ({ ...s, plazoDias: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rb-firmanteTipo">Firmante *</Label>
                  <Select
                    value={rutaB.firmanteTipo}
                    onValueChange={(v) =>
                      setRutaB((s) => ({ ...s, firmanteTipo: v as typeof s.firmanteTipo }))
                    }
                  >
                    <SelectTrigger id="rb-firmanteTipo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PACIENTE">Paciente</SelectItem>
                      <SelectItem value="FIADOR">Fiador solidario</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rb-nombre">Nombre del firmante *</Label>
                  <Input
                    id="rb-nombre"
                    value={rutaB.firmanteNombre}
                    onChange={(e) => setRutaB((s) => ({ ...s, firmanteNombre: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rb-documento">Documento del firmante (DUI/pasaporte) *</Label>
                  <Input
                    id="rb-documento"
                    value={rutaB.firmanteDocumento}
                    onChange={(e) =>
                      setRutaB((s) => ({ ...s, firmanteDocumento: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={
                    !rutaB.folioDocumento ||
                    !rutaB.firmanteNombre ||
                    !rutaB.firmanteDocumento ||
                    altaAdministrativaMutation.isPending
                  }
                  onClick={() =>
                    altaAdministrativaMutation.mutate({
                      accountId: altaAdminId,
                      ruta: "CXC",
                      documento: {
                        documentoTipo: rutaB.documentoTipo,
                        folioDocumento: rutaB.folioDocumento,
                        firmanteTipo: rutaB.firmanteTipo,
                        firmanteNombre: rutaB.firmanteNombre,
                        firmanteDocumento: rutaB.firmanteDocumento,
                        plazoDias: rutaB.plazoDias ? Number(rutaB.plazoDias) : undefined,
                      },
                    })
                  }
                >
                  {altaAdministrativaMutation.isPending &&
                  altaAdministrativaMutation.variables?.ruta === "CXC"
                    ? "Registrando…"
                    : "Ruta B — Registrar CxC y autorizar egreso"}
                </Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setAltaAdminId(null)}>
                Cerrar panel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

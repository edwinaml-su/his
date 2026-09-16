"use client";

/**
 * Panel de detalle de una ProgramacionTurno — calendario (filas=fecha,
 * columnas=plantilla), publicar/cerrar, asignar/quitar/sustituir
 * (CC-0036, US.AFIL.1.10). El calendario es una tabla simple (no
 * drag&drop) por alcance de la Ola 1A — @QA puede automatizar el flujo
 * completo asignar→publicar→sustituir vía Playwright.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

/** PHYSICIAN cubre Médicos; NURSE cubre Enfermería/Apoyo — selector de usuarios asignables por tipo de plantilla. */
const ROLE_CODE_BY_TIPO: Record<string, string> = {
  MEDICO_GENERAL: "PHYSICIAN",
  ENFERMERIA: "NURSE",
  APOYO: "NURSE",
};

function toDateStr(d: string | Date): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

function enumerateDates(desde: string, hasta: string): string[] {
  const out: string[] = [];
  let cursor = new Date(`${desde}T12:00:00Z`);
  const end = new Date(`${hasta}T12:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return out;
}

interface Asignacion {
  id: string;
  fecha: string;
  plantillaTurnoId: string;
  estado: string;
  inicioReal: string | null;
  finReal: string | null;
  user: { id: string; fullName: string };
  sustituto: { id: string; fullName: string } | null;
}

interface ShortfallCausa {
  plantillaTurnoId: string;
  nombre: string;
  fecha: string;
  dotacionRequerida: number;
  dotacionActual: number;
}

export function ProgramacionPanel({
  programacionId,
  tipo,
  canProgramar,
  onChanged,
}: {
  programacionId: string;
  tipo: string;
  canProgramar: boolean;
  onChanged: () => void;
}) {
  const detail = trpcAny.turno.programacion.get.useQuery({ id: programacionId });
  const prog = detail.data as
    | {
        id: string;
        establishmentId: string;
        estado: "BORRADOR" | "PUBLICADA" | "CERRADA";
        periodoDesde: string | Date;
        periodoHasta: string | Date;
        asignaciones: Asignacion[];
      }
    | undefined;

  // Filtra las columnas del calendario al tipo de plantilla de la pestaña
  // activa (Médicos/Enfermería) — ProgramacionTurno es compartida por sede y
  // período; la pestaña filtra la VISTA, no el modelo de datos.
  const plantillas = trpcAny.turno.plantilla.list.useQuery(
    { establishmentId: prog?.establishmentId, tipo, activeOnly: true },
    { enabled: Boolean(prog?.establishmentId) },
  );

  const [publicarError, setPublicarError] = React.useState<string | null>(null);
  const [causas, setCausas] = React.useState<ShortfallCausa[] | null>(null);
  const [motivo, setMotivo] = React.useState("");

  const publicar = trpcAny.turno.programacion.publicar.useMutation({
    onSuccess: () => {
      setPublicarError(null);
      setCausas(null);
      detail.refetch();
      onChanged();
    },
    onError: (err: { message: string; data?: { causas?: ShortfallCausa[] } }) => {
      setPublicarError(err.message);
      setCausas(err.data?.causas ?? null);
    },
  });

  const cerrar = trpcAny.turno.programacion.cerrar.useMutation({
    onSuccess: () => {
      detail.refetch();
      onChanged();
    },
  });

  const quitar = trpcAny.turno.asignacion.quitar.useMutation({ onSuccess: () => detail.refetch() });
  const marcarInicio = trpcAny.turno.asignacion.marcarInicio.useMutation({ onSuccess: () => detail.refetch() });
  const marcarFin = trpcAny.turno.asignacion.marcarFin.useMutation({ onSuccess: () => detail.refetch() });

  const [asignarCelda, setAsignarCelda] = React.useState<{ fecha: string; plantillaTurnoId: string } | null>(null);
  const [sustituirAsignacion, setSustituirAsignacion] = React.useState<Asignacion | null>(null);

  if (detail.isLoading || !prog) {
    return <p className="text-sm text-muted-foreground">Cargando programación…</p>;
  }

  const fechas = enumerateDates(toDateStr(prog.periodoDesde), toDateStr(prog.periodoHasta));
  const plantillaRows = (plantillas.data ?? []) as Array<{ id: string; nombre: string; dotacionRequerida: number }>;

  const asignacionesPorCelda = new Map<string, Asignacion[]>();
  for (const a of prog.asignaciones) {
    const key = `${toDateStr(a.fecha)}|${a.plantillaTurnoId}`;
    const list = asignacionesPorCelda.get(key) ?? [];
    list.push(a);
    asignacionesPorCelda.set(key, list);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-base">
          Programación {toDateStr(prog.periodoDesde)} — {toDateStr(prog.periodoHasta)}
          <Badge variant={prog.estado === "PUBLICADA" ? "success" : prog.estado === "CERRADA" ? "outline" : "secondary"}>
            {prog.estado}
          </Badge>
        </CardTitle>
        {canProgramar ? (
          <div className="flex gap-2">
            {prog.estado === "BORRADOR" ? (
              <Button
                size="sm"
                disabled={publicar.isPending}
                onClick={() => {
                  setPublicarError(null);
                  setCausas(null);
                  publicar.mutate({ id: prog.id });
                }}
              >
                Publicar
              </Button>
            ) : null}
            {prog.estado === "PUBLICADA" ? (
              <Button size="sm" variant="outline" disabled={cerrar.isPending} onClick={() => cerrar.mutate({ id: prog.id })}>
                Cerrar
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {publicarError ? (
          <Alert variant="destructive">
            <AlertTitle>No se pudo publicar</AlertTitle>
            <AlertDescription>
              <p>{publicarError}</p>
              {causas && causas.length > 0 ? (
                <ul className="mt-2 list-disc pl-4 text-xs">
                  {causas.map((c, i) => (
                    <li key={i}>
                      {c.fecha} — {c.nombre}: {c.dotacionActual}/{c.dotacionRequerida}
                    </li>
                  ))}
                </ul>
              ) : null}
              {causas && causas.length > 0 ? (
                <div className="mt-3 flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label htmlFor="motivo-descubierto">Motivo para autorizar dotación descubierta</Label>
                    <Input
                      id="motivo-descubierto"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="p.ej. cobertura por guardia telefónica"
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={!motivo || publicar.isPending}
                    onClick={() => publicar.mutate({ id: prog.id, autorizaDescubiertoMotivo: motivo })}
                  >
                    Reintentar con autorización
                  </Button>
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Fecha</TableHead>
                {plantillaRows.map((pt) => (
                  <TableHead key={pt.id}>
                    {pt.nombre}
                    <span className="ml-1 text-xs text-muted-foreground">(x{pt.dotacionRequerida})</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {fechas.map((fecha) => (
                <TableRow key={fecha}>
                  <TableCell className="font-mono text-xs">{fecha}</TableCell>
                  {plantillaRows.map((pt) => {
                    const celda = asignacionesPorCelda.get(`${fecha}|${pt.id}`) ?? [];
                    return (
                      <TableCell key={pt.id} className="align-top">
                        <div className="flex flex-col gap-1">
                          {celda.map((a) => (
                            <div key={a.id} className="flex items-center gap-1">
                              <Badge
                                variant={
                                  a.estado === "SUSTITUIDO"
                                    ? "outline"
                                    : a.estado === "AUSENTE"
                                      ? "destructive"
                                      : a.estado === "CUMPLIDO"
                                        ? "success"
                                        : "secondary"
                                }
                                title={a.estado}
                              >
                                {a.estado === "SUSTITUIDO" && a.sustituto
                                  ? `${a.sustituto.fullName} (sust.)`
                                  : a.user.fullName}
                              </Badge>
                              {canProgramar && prog.estado === "BORRADOR" ? (
                                <Button size="sm" variant="ghost" onClick={() => quitar.mutate({ id: a.id })}>
                                  ✕
                                </Button>
                              ) : null}
                              {canProgramar && prog.estado === "PUBLICADA" && a.estado !== "SUSTITUIDO" ? (
                                <>
                                  <Button size="sm" variant="ghost" onClick={() => setSustituirAsignacion(a)}>
                                    Sustituir
                                  </Button>
                                  {!a.inicioReal ? (
                                    <Button size="sm" variant="ghost" onClick={() => marcarInicio.mutate({ id: a.id })}>
                                      Ingreso
                                    </Button>
                                  ) : !a.finReal ? (
                                    <Button size="sm" variant="ghost" onClick={() => marcarFin.mutate({ id: a.id })}>
                                      Cierre
                                    </Button>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          ))}
                          {canProgramar && prog.estado === "BORRADOR" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setAsignarCelda({ fecha, plantillaTurnoId: pt.id })}
                            >
                              + Asignar
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {asignarCelda ? (
        <AsignarDialog
          programacionId={prog.id}
          fecha={asignarCelda.fecha}
          plantillaTurnoId={asignarCelda.plantillaTurnoId}
          roleCode={ROLE_CODE_BY_TIPO[tipo] ?? "PHYSICIAN"}
          onOpenChange={(open) => !open && setAsignarCelda(null)}
          onSaved={() => {
            setAsignarCelda(null);
            detail.refetch();
          }}
        />
      ) : null}

      {sustituirAsignacion ? (
        <SustituirDialog
          asignacion={sustituirAsignacion}
          onOpenChange={(open) => !open && setSustituirAsignacion(null)}
          onSaved={() => {
            setSustituirAsignacion(null);
            detail.refetch();
          }}
        />
      ) : null}
    </Card>
  );
}

function AsignarDialog({
  programacionId,
  fecha,
  plantillaTurnoId,
  roleCode,
  onOpenChange,
  onSaved,
}: {
  programacionId: string;
  fecha: string;
  plantillaTurnoId: string;
  roleCode: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const users = trpcAny.userAdmin.listAll.useQuery({ roleCode, active: true, page: 1, pageSize: 100 });
  const [userId, setUserId] = React.useState("");
  const [justificacion24h, setJustificacion24h] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const asignar = trpcAny.turno.asignacion.asignar.useMutation({
    onSuccess: onSaved,
    onError: (err: { message: string }) => setError(err.message),
  });

  const usuarios = (users.data?.users ?? users.data?.items ?? []) as Array<{ id: string; fullName: string }>;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar turno — {fecha}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label>Usuario</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un usuario" />
              </SelectTrigger>
              <SelectContent>
                {usuarios.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="justificacion24h">
              Justificación si supera 24h continuas (opcional, solo si el sistema lo exige)
            </Label>
            <Input
              id="justificacion24h"
              value={justificacion24h}
              onChange={(e) => setJustificacion24h(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!userId || asignar.isPending}
            onClick={() => {
              setError(null);
              asignar.mutate({
                programacionId,
                plantillaTurnoId,
                userId,
                fecha,
                justificacion24h: justificacion24h || undefined,
              });
            }}
          >
            Asignar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SustituirDialog({
  asignacion,
  onOpenChange,
  onSaved,
}: {
  asignacion: Asignacion;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Mismo rol que el titular original — se asume continuidad de tipo de plantilla.
  const users = trpcAny.userAdmin.listAll.useQuery({ active: true, page: 1, pageSize: 100 });
  const [sustitutoUserId, setSustitutoUserId] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const sustituir = trpcAny.turno.asignacion.sustituir.useMutation({
    onSuccess: onSaved,
    onError: (err: { message: string }) => setError(err.message),
  });

  const usuarios = (users.data?.users ?? users.data?.items ?? []) as Array<{ id: string; fullName: string }>;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sustituir turno de {asignacion.user.fullName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label>Sustituto</Label>
            <Select value={sustitutoUserId} onValueChange={setSustitutoUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un sustituto" />
              </SelectTrigger>
              <SelectContent>
                {usuarios
                  .filter((u) => u.id !== asignacion.user.id)
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="motivo-sustitucion">Motivo</Label>
            <Input id="motivo-sustitucion" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!sustitutoUserId || !motivo || sustituir.isPending}
            onClick={() => {
              setError(null);
              sustituir.mutate({ id: asignacion.id, sustitutoUserId, motivo });
            }}
          >
            Sustituir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

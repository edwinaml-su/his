"use client";

/**
 * /turnos — CC-0036 Ola 1A (REQ-HIS-AFIL-001 Bloque C). Vista de
 * mantenimiento de plantillas de turno + cobertura 24h + lista de
 * programaciones por sede. Al seleccionar una programación, `ProgramacionPanel`
 * muestra el calendario mensual/quincenal y las acciones de asignar/publicar/
 * sustituir. Mismo patrón que `/organizations/habitaciones`
 * (shell cliente + dialog + Server Component `page.tsx` para `roleCodes`).
 */
import * as React from "react";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Tabs, TabsList, TabsTrigger } from "@his/ui/components/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Alert, AlertDescription } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";
import { PlantillaDialog, type PlantillaData } from "./plantilla-dialog";
import { ProgramacionPanel } from "./programacion-panel";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_PROGRAMAR = ["JEFE_MEDICO_SEDE", "ADMIN", "DIR"];

export type TurnoTipo = "MEDICO_GENERAL" | "ENFERMERIA";

const TIPO_LABEL: Record<TurnoTipo, string> = {
  MEDICO_GENERAL: "Médicos",
  ENFERMERIA: "Enfermería",
};

interface PlantillaRow extends PlantillaData {
  active: boolean;
  cruzaMedianoche: boolean;
}

interface ProgramacionRow {
  id: string;
  periodoDesde: string;
  periodoHasta: string;
  estado: "BORRADOR" | "PUBLICADA" | "CERRADA";
}

export function TurnosShell({ roleCodes }: { roleCodes: string[] }) {
  const canProgramar = roleCodes.some((r) => ROLES_PROGRAMAR.includes(r));

  const establishments = trpcAny.establishment.list.useQuery();
  const [establishmentId, setEstablishmentId] = React.useState<string>("");
  const [tipo, setTipo] = React.useState<TurnoTipo>("MEDICO_GENERAL");

  React.useEffect(() => {
    if (!establishmentId && establishments.data?.length) {
      setEstablishmentId(establishments.data[0].id);
    }
  }, [establishmentId, establishments.data]);

  const plantillas = trpcAny.turno.plantilla.list.useQuery(
    { establishmentId, tipo },
    { enabled: Boolean(establishmentId) },
  );
  const cobertura = trpcAny.turno.plantilla.cobertura.useQuery(
    { establishmentId, tipo },
    { enabled: Boolean(establishmentId) },
  );
  const programaciones = trpcAny.turno.programacion.list.useQuery(
    { establishmentId },
    { enabled: Boolean(establishmentId) },
  );

  const setActive = trpcAny.turno.plantilla.setActive.useMutation({
    onSuccess: () => plantillas.refetch(),
  });
  const [setActiveError, setSetActiveError] = React.useState<string | null>(null);

  const [plantillaDialogOpen, setPlantillaDialogOpen] = React.useState(false);
  const [selectedPlantilla, setSelectedPlantilla] = React.useState<PlantillaData | null>(null);

  const [programacionDialogOpen, setProgramacionDialogOpen] = React.useState(false);
  const [selectedProgramacionId, setSelectedProgramacionId] = React.useState<string | null>(null);

  const plantillaRows = (plantillas.data ?? []) as PlantillaRow[];
  const programacionRows = (programaciones.data ?? []) as ProgramacionRow[];
  const huecos = (cobertura.data?.huecos ?? []) as Array<{ desde: string; hasta: string }>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarClock className="h-6 w-6" />
            Turnos 24/7
          </h1>
          <p className="text-sm text-muted-foreground">
            Programación mensual de médicos generales y enfermería por sede
            (CC-0036, REQ-HIS-AFIL-001 Bloque C). Programar/publicar requiere
            rol Jefe Médico de Sede, Admin o Dirección.
          </p>
        </div>
        <div className="w-64">
          <Select
            value={establishmentId}
            onValueChange={(v) => {
              setEstablishmentId(v);
              setSelectedProgramacionId(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecciona una sede" />
            </SelectTrigger>
            <SelectContent>
              {(establishments.data ?? []).map((e: { id: string; code: string; name: string }) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.code} — {e.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!establishmentId ? (
        <p className="text-sm text-muted-foreground">Selecciona una sede para continuar.</p>
      ) : (
        <>
          <Tabs value={tipo} onValueChange={(v) => setTipo(v as TurnoTipo)}>
            <TabsList>
              <TabsTrigger value="MEDICO_GENERAL">{TIPO_LABEL.MEDICO_GENERAL}</TabsTrigger>
              <TabsTrigger value="ENFERMERIA">{TIPO_LABEL.ENFERMERIA}</TabsTrigger>
            </TabsList>
          </Tabs>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">
                Plantillas de turno — {TIPO_LABEL[tipo]}
              </CardTitle>
              {canProgramar ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setSelectedPlantilla(null);
                    setPlantillaDialogOpen(true);
                  }}
                >
                  + Nueva plantilla
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Cobertura 24h:</span>
                {huecos.length === 0 ? (
                  <Badge variant="success">Sin huecos — cobertura completa</Badge>
                ) : (
                  huecos.map((h, i) => (
                    <Badge key={i} variant="destructive">
                      Hueco {h.desde}–{h.hasta}
                    </Badge>
                  ))
                )}
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Código</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="w-32">Horario</TableHead>
                      <TableHead className="w-28">Dotación</TableHead>
                      <TableHead className="w-24">Estado</TableHead>
                      {canProgramar ? <TableHead className="w-40 text-right">Acciones</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plantillaRows.length === 0 && !plantillas.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          Sin plantillas de turno para este tipo.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {plantillaRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.codigo}</TableCell>
                        <TableCell className="font-medium">
                          {row.nombre}
                          {row.cruzaMedianoche ? (
                            <Badge variant="outline" className="ml-2">
                              Cruza medianoche
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.horaInicio}–{row.horaFin}
                        </TableCell>
                        <TableCell>{row.dotacionRequerida}</TableCell>
                        <TableCell>
                          {row.active ? (
                            <Badge variant="success">Activa</Badge>
                          ) : (
                            <Badge variant="outline">Inactiva</Badge>
                          )}
                        </TableCell>
                        {canProgramar ? (
                          <TableCell className="text-right">
                            <div className="inline-flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedPlantilla(row);
                                  setPlantillaDialogOpen(true);
                                }}
                              >
                                Editar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={setActive.isPending}
                                onClick={() => {
                                  setSetActiveError(null);
                                  setActive.mutate(
                                    { id: row.id, active: !row.active },
                                    { onError: (err: { message: string }) => setSetActiveError(err.message) },
                                  );
                                }}
                              >
                                {row.active ? "Desactivar" : "Activar"}
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {setActiveError ? (
                <p className="text-sm text-destructive">{setActiveError}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">Programaciones</CardTitle>
              {canProgramar ? (
                <Button size="sm" onClick={() => setProgramacionDialogOpen(true)}>
                  + Nueva programación
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Período</TableHead>
                      <TableHead className="w-28">Estado</TableHead>
                      <TableHead className="w-32 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {programacionRows.length === 0 && !programaciones.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                          Sin programaciones registradas para esta sede.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {programacionRows.map((row) => (
                      <TableRow key={row.id} className={selectedProgramacionId === row.id ? "bg-muted/50" : undefined}>
                        <TableCell>
                          {row.periodoDesde} — {row.periodoHasta}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.estado === "PUBLICADA"
                                ? "success"
                                : row.estado === "CERRADA"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {row.estado}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setSelectedProgramacionId(row.id)}>
                            Ver
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {selectedProgramacionId ? (
            <ProgramacionPanel
              programacionId={selectedProgramacionId}
              tipo={tipo}
              canProgramar={canProgramar}
              onChanged={() => programaciones.refetch()}
            />
          ) : null}

          <PlantillaDialog
            open={plantillaDialogOpen}
            onOpenChange={setPlantillaDialogOpen}
            plantilla={selectedPlantilla}
            establishmentId={establishmentId}
            tipo={tipo}
            onSaved={() => {
              plantillas.refetch();
              cobertura.refetch();
            }}
          />

          <NuevaProgramacionDialog
            open={programacionDialogOpen}
            onOpenChange={setProgramacionDialogOpen}
            establishmentId={establishmentId}
            onCreated={(id: string) => {
              programaciones.refetch();
              setSelectedProgramacionId(id);
            }}
          />
        </>
      )}
    </div>
  );
}

function NuevaProgramacionDialog({
  open,
  onOpenChange,
  establishmentId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  establishmentId: string;
  onCreated: (id: string) => void;
}) {
  const [periodoDesde, setPeriodoDesde] = React.useState("");
  const [periodoHasta, setPeriodoHasta] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const create = trpcAny.turno.programacion.create.useMutation({
    onSuccess: (result: { id: string }) => {
      onOpenChange(false);
      setPeriodoDesde("");
      setPeriodoHasta("");
      onCreated(result.id);
    },
    onError: (err: { message: string }) => setError(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva programación de turnos</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="periodoDesde">Período desde</Label>
            <Input
              id="periodoDesde"
              type="date"
              value={periodoDesde}
              onChange={(e) => setPeriodoDesde(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="periodoHasta">Período hasta</Label>
            <Input
              id="periodoHasta"
              type="date"
              value={periodoHasta}
              onChange={(e) => setPeriodoHasta(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!periodoDesde || !periodoHasta || create.isPending}
            onClick={() => {
              setError(null);
              create.mutate({ establishmentId, periodoDesde, periodoHasta });
            }}
          >
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

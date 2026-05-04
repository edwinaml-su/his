"use client";

/**
 * US-4.5 — Vacunación PAI: vista por paciente.
 *
 * Muestra:
 *  - Tabla agrupada por vacuna con dosis aplicadas vs esperadas (esquema PAI SV).
 *  - Botón "Aplicar dosis" → form con select de vaccine, doseNumber, fecha, lote, sitio.
 *
 * NOTA INTEGRACIÓN: el router `vaccination` aún no está montado en `_app.ts` (otro
 * equipo lo wirea). Mientras tanto se accede vía `(trpc as any).vaccination.*`. Cuando
 * se integre, basta retirar el cast `as any`.
 */
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { VaccinationForm } from "./vaccination-form";

interface AppliedDose {
  id: string;
  doseNumber: number;
  administeredAt: string | Date;
  lotNumber: string | null;
  anatomicalSite: string | null;
  expirationDate: string | Date | null;
  reactionsObserved: string | null;
  notes: string | null;
}

interface VaccinationGroup {
  vaccineId: string;
  code: string;
  name: string;
  routeOfAdmin: string | null;
  scheduleNote: string | null;
  applied: number;
  expected: number;
  complete: boolean;
  doses: AppliedDose[];
}

export default function PatientVaccinationsPage() {
  const params = useParams<{ id: string }>();
  const patientId = params.id;
  // Cast hasta que vaccination router esté wireado en _app.ts.
  const trpcAny = trpc as unknown as {
    vaccination: {
      byPatient: {
        useQuery: (input: { patientId: string }) => {
          data?: VaccinationGroup[];
          isLoading: boolean;
          error?: { message: string } | null;
        };
      };
    };
  };
  const query = trpcAny.vaccination.byPatient.useQuery({ patientId });

  const [formOpen, setFormOpen] = React.useState(false);
  const [presetVaccineId, setPresetVaccineId] = React.useState<string | undefined>();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Vacunación</h2>
          <p className="text-xs text-muted-foreground">
            Calendario PAI El Salvador 2026 + vacunas universales.
          </p>
        </div>
        <Button
          onClick={() => {
            setPresetVaccineId(undefined);
            setFormOpen(true);
          }}
        >
          Aplicar dosis
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Estado vacunal</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {query.error && (
            <p className="text-sm text-destructive">{query.error.message}</p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin vacunas registradas. Comienza aplicando la primera dosis.
            </p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Código</TableHead>
                  <TableHead>Vacuna</TableHead>
                  <TableHead className="w-28">Vía</TableHead>
                  <TableHead className="w-28">Dosis</TableHead>
                  <TableHead className="w-32">Estado</TableHead>
                  <TableHead className="w-32 text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((g) => (
                  <TableRow key={g.vaccineId}>
                    <TableCell className="font-mono text-xs">{g.code}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{g.name}</p>
                        {g.scheduleNote && (
                          <p className="text-xs text-muted-foreground">
                            {g.scheduleNote}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{g.routeOfAdmin ?? "—"}</TableCell>
                    <TableCell>
                      {g.applied} / {g.expected}
                    </TableCell>
                    <TableCell>
                      {g.complete ? (
                        <Badge variant="success">Completo</Badge>
                      ) : (
                        <Badge variant="outline">Pendiente</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPresetVaccineId(g.vaccineId);
                          setFormOpen(true);
                        }}
                      >
                        + Dosis
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detalle de dosis aplicadas por vacuna (expandido). */}
      {query.data && query.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Detalle de dosis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {query.data.map((g) => (
              <div key={g.vaccineId}>
                <p className="text-sm font-medium">{g.name}</p>
                <ul className="ml-4 mt-1 space-y-1 text-xs">
                  {g.doses.map((d) => (
                    <li key={d.id}>
                      Dosis {d.doseNumber} ·{" "}
                      {new Date(d.administeredAt).toLocaleDateString("es-SV")}
                      {d.lotNumber && ` · Lote ${d.lotNumber}`}
                      {d.anatomicalSite && ` · ${d.anatomicalSite}`}
                      {d.reactionsObserved && (
                        <span className="text-destructive">
                          {" "}
                          · Reacción: {d.reactionsObserved}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <VaccinationForm
        open={formOpen}
        onOpenChange={setFormOpen}
        patientId={patientId}
        presetVaccineId={presetVaccineId}
      />
    </div>
  );
}

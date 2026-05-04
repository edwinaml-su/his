"use client";

/**
 * US-4.7 — Alergias detalladas: vista por paciente.
 *
 * Banner permanente con alergias activas en el top + tabla con severidad
 * color-coded. Botón "Registrar alergia" abre el form.
 *
 * NOTA INTEGRACIÓN: el router `allergy` (sub-router del nuevo `vaccinationRouter` o
 * standalone — se decide en integración) aún no está wireado en `_app.ts`. Se accede
 * vía `(trpc as any).allergy.*` mientras tanto. Como fallback usamos `patient.get`
 * (que ya devuelve `allergies` activas) para no bloquear UI hasta que el router exista.
 */
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { AllergyAlert } from "@his/ui/components/AllergyAlert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { AllergyForm } from "./allergy-form";

type Severity = "mild" | "moderate" | "severe" | "life-threatening";

const SEVERITY_LABEL: Record<Severity, string> = {
  mild: "Leve",
  moderate: "Moderada",
  severe: "Severa",
  "life-threatening": "Anafiláctica",
};

const SEVERITY_VARIANT: Record<Severity, "secondary" | "default" | "destructive"> = {
  mild: "secondary",
  moderate: "default",
  severe: "destructive",
  "life-threatening": "destructive",
};

/** Para alergias anafilácticas pintamos el badge con un realce extra. */
function severityClass(s: Severity): string {
  if (s === "life-threatening") return "ring-2 ring-destructive ring-offset-1";
  return "";
}

export default function PatientAllergiesPage() {
  const params = useParams<{ id: string }>();
  const patientId = params.id;

  // Reusamos patient.get para los datos (más estable que allergy router que aún no se monta).
  const patientQuery = trpc.patient.get.useQuery({ id: patientId });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string } | undefined>(undefined);

  const allergies = patientQuery.data?.allergies ?? [];
  const activeAllergies = allergies
    .filter((a) => a.active)
    .map((a) => ({
      id: a.id,
      substanceText: a.substanceText,
      severity: a.severity as Severity,
      reaction: a.reaction,
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Alergias</h2>
          <p className="text-xs text-muted-foreground">
            Registro detallado conforme US-4.7. Las alergias activas se muestran en banner
            persistente en toda la vista del paciente.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
        >
          Registrar alergia
        </Button>
      </div>

      {/* Banner alergias activas siempre visible al top. */}
      <AllergyAlert allergies={activeAllergies} />

      <Card>
        <CardHeader>
          <CardTitle>Listado completo</CardTitle>
        </CardHeader>
        <CardContent>
          {patientQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {patientQuery.error && (
            <p className="text-sm text-destructive">{patientQuery.error.message}</p>
          )}
          {patientQuery.data && allergies.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sin alergias registradas.
            </p>
          )}
          {patientQuery.data && allergies.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Substancia</TableHead>
                  <TableHead>Reacción</TableHead>
                  <TableHead className="w-32">Severidad</TableHead>
                  <TableHead className="w-28">Estado</TableHead>
                  <TableHead className="w-32 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allergies.map((a) => {
                  const sev = a.severity as Severity;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.substanceText}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.reaction ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={SEVERITY_VARIANT[sev] ?? "secondary"}
                          className={severityClass(sev)}
                        >
                          {SEVERITY_LABEL[sev] ?? sev}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {a.active ? (
                          <Badge variant="default">Activa</Badge>
                        ) : (
                          <Badge variant="outline">Resuelta</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing({ id: a.id });
                            setFormOpen(true);
                          }}
                        >
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AllergyForm
        open={formOpen}
        onOpenChange={setFormOpen}
        patientId={patientId}
        editingId={editing?.id}
      />
    </div>
  );
}

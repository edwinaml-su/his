"use client";

import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

export default function EncounterDetailPage() {
  const params = useParams<{ id: string }>();
  const list = trpc.encounter.list.useQuery({ status: "ALL", page: 1, pageSize: 50 });
  const enc = list.data?.items.find((e) => e.id === params.id);

  if (list.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (!enc) return <p className="text-sm text-destructive">Encuentro no encontrado.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Encuentro {enc.encounterNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {enc.patient.firstName} {enc.patient.lastName} · MRN {enc.patient.mrn}
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Detalle</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm">
          <p><span className="text-muted-foreground">Tipo: </span>{enc.admissionType}</p>
          <p><span className="text-muted-foreground">Servicio: </span>{enc.serviceUnit?.name ?? "—"}</p>
          <p><span className="text-muted-foreground">Admitido: </span>{new Date(enc.admittedAt).toLocaleString("es-SV")}</p>
          <p>
            <span className="text-muted-foreground">Estado: </span>
            {enc.dischargedAt ? (
              <Badge variant="outline">Cerrado</Badge>
            ) : (
              <Badge variant="success">Abierto</Badge>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

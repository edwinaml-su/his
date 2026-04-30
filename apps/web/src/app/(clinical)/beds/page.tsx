"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { BedMap, type BedMapServiceGroup } from "@his/ui/components/BedMap";
import { trpc } from "@/lib/trpc/react";

export default function BedsPage() {
  const map = trpc.bed.getMap.useQuery();
  const groups: BedMapServiceGroup[] =
    map.data?.map((s) => ({
      serviceUnitId: s.id,
      serviceUnitName: s.name,
      beds: s.beds.map((b) => ({
        id: b.id,
        code: b.code,
        status: b.status,
        patientName:
          b.assignments[0]?.encounter.patient
            ? `${b.assignments[0]!.encounter.patient.firstName} ${b.assignments[0]!.encounter.patient.lastName}`
            : null,
      })),
    })) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mapa de camas</h1>
      <Card>
        <CardHeader><CardTitle>Estado de ocupación</CardTitle></CardHeader>
        <CardContent>
          {map.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {map.data && <BedMap groups={groups} />}
        </CardContent>
      </Card>
    </div>
  );
}

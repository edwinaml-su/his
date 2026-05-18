"use client";

/**
 * Kardex — página de selección de paciente.
 * El detalle está en /ece/kardex/[patientId].
 * US.F2.6.31-33.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";

export default function KardexIndexPage() {
  const router = useRouter();
  const [patientId, setPatientId] = React.useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = patientId.trim();
    if (id) router.push(`/ece/kardex/${id}`);
  };

  return (
    <main className="container mx-auto py-6 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Kardex de administraciones</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="patient-id">ID de paciente</Label>
              <Input
                id="patient-id"
                placeholder="UUID del paciente"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={!patientId.trim()}>
              Ver kardex
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

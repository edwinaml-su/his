"use client";

/**
 * US-1.3 — /exchange-rates/new — Crear nueva tasa.
 *
 * Página dedicada (no Dialog) para permitir deep-linking y respetar la
 * indicación explícita de la story de tener una ruta `/new`. Tras crear con
 * éxito, redirige al listado.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { ExchangeRateForm } from "../exchange-rate-form";

export default function NewExchangeRatePage() {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Nueva tasa de cambio</h1>
          <p className="text-sm text-muted-foreground">
            Histórico inmutable: si ya existe una tasa vigente para el mismo par y tipo, su
            "vigente hasta" se cerrará automáticamente al momento de la nueva.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/exchange-rates">Cancelar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la tasa</CardTitle>
        </CardHeader>
        <CardContent>
          <ExchangeRateForm onSuccess={() => router.push("/exchange-rates")} />
        </CardContent>
      </Card>
    </div>
  );
}

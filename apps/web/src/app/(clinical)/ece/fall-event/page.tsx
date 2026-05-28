"use client";

/**
 * Página índice — Reporte de Caídas (IPSG.6 ME 4).
 *
 * Muestra eventos de caída recientes registrados en la organización y un CTA
 * para abrir el formulario de registro (`/ece/fall-event/nuevo`).
 *
 * Antes de este archivo, navegar a `/ece/fall-event` desde el sidebar daba
 * 404 porque solo existía la subruta `/nuevo`. Esta página cierra el gap.
 */
import * as React from "react";
import Link from "next/link";
import { TriangleAlert, Plus, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";
import { FALL_LUGAR, FALL_LESION } from "@his/contracts/schemas/fall-event";

// ---------------------------------------------------------------------------
// Etiquetas en español para los enums (lugar / lesión)
// ---------------------------------------------------------------------------

const LUGAR_LABEL: Record<(typeof FALL_LUGAR)[number], string> = {
  cama:    "Cama",
  "baño":  "Baño",
  pasillo: "Pasillo",
  silla:   "Silla",
  otro:    "Otro",
};

const LESION_LABEL: Record<(typeof FALL_LESION)[number], string> = {
  ninguna:   "Ninguna",
  leve:      "Leve",
  moderada:  "Moderada",
  grave:     "Grave",
  muy_grave: "Muy grave",
};

const LESION_VARIANT: Record<
  (typeof FALL_LESION)[number],
  "default" | "outline" | "warning" | "destructive"
> = {
  ninguna:   "outline",
  leve:      "default",
  moderada:  "warning",
  grave:     "destructive",
  muy_grave: "destructive",
};

export default function FallEventIndexPage() {
  const list = trpc.eceFallEvent.list.useQuery({ limit: 25 });

  const items = (list.data?.items ?? []) as Array<{
    id: string;
    paciente_id: string;
    fecha_hora: string | Date;
    lugar: (typeof FALL_LUGAR)[number];
    lugar_otro: string | null;
    lesion_resultante: (typeof FALL_LESION)[number];
    requirio_atencion_medica: boolean;
    morse_previa: number | null;
    testigo_presente: boolean;
  }>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <TriangleAlert className="h-6 w-6 text-amber-600" aria-hidden />
            Reporte de Caídas
          </h1>
          <p className="text-sm text-muted-foreground">
            JCI IPSG.6 ME 4 — reportes estructurados de caída del paciente con
            valoración Morse previa y desenlace clínico.
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/fall-event/nuevo">
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            Registrar caída
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Eventos recientes</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando eventos…</p>
          ) : list.error ? (
            <p role="alert" className="text-sm text-destructive">
              {list.error.message}
            </p>
          ) : items.length === 0 ? (
            <div className="rounded-md border bg-muted/30 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Sin eventos de caída registrados.
              </p>
              <Link
                href="/ece/fall-event/nuevo"
                className="mt-2 inline-block text-sm font-semibold text-primary hover:underline"
              >
                Registrar el primero →
              </Link>
            </div>
          ) : (
            <ul className="divide-y rounded-md border">
              {items.map((ev) => {
                const lugar =
                  ev.lugar === "otro" && ev.lugar_otro
                    ? `Otro · ${ev.lugar_otro}`
                    : LUGAR_LABEL[ev.lugar] ?? ev.lugar;
                return (
                  <li key={ev.id}>
                    <Link
                      href={`/ece/fall-event/nuevo?prefillFrom=${ev.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-muted/30"
                      aria-label={`Ver caída ${ev.id.slice(0, 8)}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">
                          {new Date(ev.fecha_hora).toLocaleString("es-SV", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })}{" "}
                          <span className="text-muted-foreground">· {lugar}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Paciente{" "}
                          <span className="font-mono">
                            {ev.paciente_id.slice(0, 8)}…
                          </span>
                          {ev.morse_previa !== null && (
                            <> · Morse previa: {ev.morse_previa}</>
                          )}
                          {ev.testigo_presente && <> · con testigo</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={LESION_VARIANT[ev.lesion_resultante]}>
                          {LESION_LABEL[ev.lesion_resultante]}
                        </Badge>
                        {ev.requirio_atencion_medica && (
                          <Badge variant="destructive">Atención médica</Badge>
                        )}
                        <ArrowRight
                          className="h-4 w-4 text-muted-foreground"
                          aria-hidden
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

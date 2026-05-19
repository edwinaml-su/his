"use client";

/**
 * ECE — Detalle de RRI.
 * Muestra estado, datos de solicitud y sección "Respuesta IC" expandible
 * cuando estado=firmado y el usuario tiene rol IC.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ─── Mappings ─────────────────────────────────────────────────────────────────

const TIPO_LABEL: Record<string, string> = {
  referencia: "Referencia",
  retorno: "Retorno",
  interconsulta: "Interconsulta",
};

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  en_revision: "En revision",
  firmado: "Firmado — pendiente respuesta IC",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  en_revision: "secondary",
  firmado: "secondary",
  validado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "long", timeStyle: "short" });

// ─── Sección respuesta IC (expandible) ───────────────────────────────────────

function RespuestaIcSection({
  rri,
}: {
  rri: {
    id: string;
    estado_codigo: string;
    respuesta_interconsultante: string | null;
    respondido_por: string | null;
  };
}) {
  const [open, setOpen] = React.useState(false);
  const hasRespuesta = rri.respuesta_interconsultante !== null;

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/40"
      >
        <span>Respuesta del interconsultante (IC)</span>
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden />
        )}
      </button>

      {open && (
        <div className="border-t px-4 py-3 space-y-3 text-sm">
          {!hasRespuesta ? (
            <p className="text-muted-foreground">
              Sin respuesta aun. El IC debe completarla desde la pagina de respuesta.
            </p>
          ) : (
            <dl className="space-y-2">
              <div>
                <dt className="text-xs text-muted-foreground">Respuesta</dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{rri.respuesta_interconsultante}</dd>
              </div>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function RriDetallePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const { data: rri, isLoading, error } = trpc.eceRri.get.useQuery({ id });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    );
  }

  if (!rri) return null;

  const estado = rri.estado_codigo;
  const puedeResponder = estado === "firmado";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ArrowLeftRight className="h-6 w-6" aria-hidden />
            {TIPO_LABEL[rri.tipo] ?? rri.tipo}
          </h1>
          <p className="text-sm text-muted-foreground">
            RRI — Detalle de solicitud
          </p>
        </div>
        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>
          {ESTADO_LABEL[estado] ?? estado}
        </Badge>
      </div>

      {/* Datos principales */}
      <Card>
        <CardHeader>
          <CardTitle>Datos de la solicitud</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Tipo</dt>
              <dd className="font-medium capitalize">{TIPO_LABEL[rri.tipo] ?? rri.tipo}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Episodio</dt>
              <dd className="font-mono text-xs">{rri.episodio_id}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Registrado</dt>
              <dd className="tabular-nums">
                {dateFmt.format(new Date(rri.registrado_en))}
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-muted-foreground">Motivo</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{rri.motivo}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs text-muted-foreground">Resumen clinico</dt>
              <dd className="mt-0.5 whitespace-pre-wrap">{rri.resumen_clinico}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Respuesta IC — expandible cuando estado=firmado */}
      <RespuestaIcSection rri={rri} />

      {/* Acciones */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Volver
        </Button>
        {puedeResponder && (
          <Button onClick={() => router.push(`/ece/rri/${id}/responder`)}>
            Responder (IC)
          </Button>
        )}
      </div>
    </div>
  );
}

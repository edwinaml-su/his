"use client";

/**
 * Detalle de Acto Quirúrgico — NTEC §3.13.
 *
 * Vista inmutable: una vez firmado el documento no puede editarse.
 * Permite firmar (si es borrador) o validar (si es firmado) desde esta pantalla.
 */
import * as React from "react";
import { use } from "react";
import { Scissors, Lock, CheckCircle2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador",
  firmado: "Firmado",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador: "outline",
  firmado: "secondary",
  validado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "short",
});

function Campo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm">{value ?? "—"}</p>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ActoQxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const utils = trpc.useUtils();

  const query = trpc.eceActoQx.get.useQuery({ id }, { retry: false });
  const firmarMut = trpc.eceActoQx.firmar.useMutation({
    onSuccess: () => {
      void utils.eceActoQx.get.invalidate({ id });
      setPin("");
    },
  });
  const validarMut = trpc.eceActoQx.validar.useMutation({
    onSuccess: () => {
      void utils.eceActoQx.get.invalidate({ id });
    },
  });

  const [pin, setPin] = React.useState("");
  const [actionError, setActionError] = React.useState<string | null>(null);

  async function handleFirmar() {
    setActionError(null);
    try {
      await firmarMut.mutateAsync({ id, pin });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleValidar() {
    setActionError(null);
    try {
      await validarMut.mutateAsync({ id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }

  const aq = query.data;
  if (!aq) return null;

  const estado = aq.estado_codigo ?? "borrador";
  const esFirmado = estado === "firmado" || estado === "validado";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Scissors className="h-6 w-6" aria-hidden />
            Acto quirúrgico
          </h1>
          <p className="text-xs text-muted-foreground font-mono">{aq.id}</p>
        </div>
        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"} className="text-sm">
          {ESTADO_LABEL[estado] ?? estado}
        </Badge>
      </div>

      {/* Banner inmutabilidad */}
      {esFirmado && (
        <div className="flex items-center gap-2 rounded-md border border-amber-400/50 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Documento <strong>inmutable</strong>. Firmado bajo NTEC §3.13 — Acuerdo n.° 1616 MINSAL.
          </span>
        </div>
      )}

      {/* Datos del documento */}
      <Card>
        <CardHeader>
          <CardTitle>Datos clínicos</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Campo
            label="Episodio"
            value={<span className="font-mono">{aq.episodio_id}</span>}
          />
          <Campo
            label="Cirujano"
            value={<span className="font-mono">{aq.cirujano_id}</span>}
          />
          {aq.anestesiologo_id && (
            <Campo
              label="Anestesiólogo"
              value={<span className="font-mono">{aq.anestesiologo_id}</span>}
            />
          )}
          <Campo label="Diagnóstico preoperatorio" value={aq.diagnostico_pre} />
          <Campo label="Diagnóstico postoperatorio" value={aq.diagnostico_post} />
          <Campo label="Procedimiento realizado" value={aq.procedimiento_realizado} />
          <Campo label="Hallazgos" value={aq.hallazgos} />
          <Campo label="Técnica quirúrgica" value={null} />
          <Campo label="Complicaciones" value={null} />
          <Campo
            label="Hora de inicio"
            value={aq.hora_inicio ? dateFmt.format(new Date(aq.hora_inicio)) : null}
          />
          <Campo
            label="Hora de fin"
            value={aq.hora_fin ? dateFmt.format(new Date(aq.hora_fin)) : null}
          />
          <Campo
            label="Registrado en"
            value={aq.registrado_en ? dateFmt.format(new Date(aq.registrado_en)) : null}
          />
        </CardContent>
      </Card>

      {/* Acciones según estado */}
      {estado === "borrador" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Firmar documento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Al firmar, el documento queda <strong>inmutable</strong> según NTEC §3.13.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="pin-firma">PIN de firma electrónica</Label>
              <Input
                id="pin-firma"
                type="password"
                placeholder="6-8 dígitos"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
              />
            </div>
            {actionError && (
              <p role="alert" className="text-sm text-destructive">{actionError}</p>
            )}
            <Button
              onClick={handleFirmar}
              disabled={pin.trim().length < 6 || firmarMut.isPending}
            >
              {firmarMut.isPending ? "Firmando…" : "Firmar"}
            </Button>
          </CardContent>
        </Card>
      )}

      {estado === "firmado" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Validar documento (jefe de servicio)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              La validación por el jefe de servicio completa el ciclo del acto quirúrgico.
            </p>
            {actionError && (
              <p role="alert" className="text-sm text-destructive">{actionError}</p>
            )}
            <Button
              onClick={handleValidar}
              disabled={validarMut.isPending}
            >
              {validarMut.isPending ? "Validando…" : "Validar"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

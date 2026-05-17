"use client";

/**
 * ECE — Detalle de Lista de Verificación Preoperatoria.
 * Permite actualizar en borrador y firmar con PIN electrónico.
 * Post-firma: vista de solo lectura (inmutabilidad NTEC Art. 28).
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ClipboardList, Lock, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Separator } from "@his/ui/components/separator";
import { trpc } from "@/lib/trpc/react";

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "short",
});

function BoolCell({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return value ? (
    <CheckCircle2 className="h-4 w-4 text-green-600" />
  ) : (
    <XCircle className="h-4 w-4 text-destructive" />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export default function PreopChecklistDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [pin, setPin] = React.useState("");
  const [firmaError, setFirmaError] = React.useState<string | null>(null);
  const [firmaOk, setFirmaOk] = React.useState(false);

  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.eceCirugiaPreop.get.useQuery({ id });

  const firmarMutation = trpc.eceCirugiaPreop.firmar.useMutation({
    onSuccess() {
      setFirmaOk(true);
      setPin("");
      void utils.eceCirugiaPreop.get.invalidate({ id });
    },
    onError(err: { message: string }) {
      setFirmaError(err.message);
    },
  });

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando...</p>;
  }

  if (isError || !data) {
    return (
      <p className="p-6 text-sm text-destructive">
        Checklist no encontrado o sin permisos de acceso.
      </p>
    );
  }

  const esFirmado = data.estado_codigo === "firmado" || Boolean(data.firmado_en);

  function handleFirmar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFirmaError(null);
    firmarMutation.mutate({ id, pin });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Checklist preoperatorio</h1>
          <Badge variant={esFirmado ? "default" : "outline"}>
            {esFirmado ? "Firmado" : data.estado_codigo}
          </Badge>
          {esFirmado && <Lock className="h-4 w-4 text-muted-foreground" />}
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push("/ece/quirofano/preop")}>
          Volver
        </Button>
      </div>

      {/* Datos del checklist */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-sm">Datos registrados</CardTitle>
        </CardHeader>
        <CardContent>
          <Row label="ID">{data.id}</Row>
          <Row label="Episodio hospitalario">{data.episodio_hospitalario_id}</Row>
          <Row label="Registrado">
            {data.registrado_en ? dateFmt.format(new Date(data.registrado_en)) : "—"}
          </Row>
          <Row label="Estado">{data.estado_codigo}</Row>
          {data.firmado_en && (
            <Row label="Firmado">
              {dateFmt.format(new Date(data.firmado_en))}
            </Row>
          )}
          <Separator className="my-3" />
          <Row label="Ayuno (horas)">{data.ayuno_horas ?? "—"}</Row>
          <Row label="Riesgo ASA">{data.riesgo_anestesico_asa ?? "—"}</Row>
          <Row label="Alergias">{data.alergias ?? "—"}</Row>
          <Separator className="my-3" />
          <Row label="Marcapasos"><BoolCell value={data.marcapasos ?? null} /></Row>
          <Row label="Anticoagulantes"><BoolCell value={data.anticoagulantes ?? null} /></Row>
          <Row label="Retiro de prótesis"><BoolCell value={data.retiro_protesis ?? null} /></Row>
          <Row label="Identificación verificada">
            <BoolCell value={data.identificacion_paciente_verificada ?? null} />
          </Row>
          <Row label="Sitio quirúrgico marcado"><BoolCell value={data.sitio_marcado ?? null} /></Row>
          <Row label="Consentimiento firmado">
            <BoolCell value={data.consentimiento_firmado ?? null} />
          </Row>
        </CardContent>
      </Card>

      {/* Sección de firma — solo si borrador */}
      {!esFirmado && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-sm">Firmar con PIN electrónico (MC / ANES)</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleFirmar} className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="pin" className="text-xs">
                  PIN electrónico (6-8 dígitos)
                </Label>
                <Input
                  id="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6,8}"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••••"
                  className="mt-1 w-40 font-mono tracking-widest"
                />
              </div>
              <Button
                type="submit"
                disabled={firmarMutation.isPending || pin.length < 6}
              >
                {firmarMutation.isPending ? "Firmando…" : "Firmar checklist"}
              </Button>
            </form>
            {firmaError && <p className="mt-2 text-sm text-destructive">{firmaError}</p>}
            {firmaOk && (
              <p className="mt-2 text-sm text-green-600 font-medium">
                Checklist firmado correctamente. El documento es ahora inmutable.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

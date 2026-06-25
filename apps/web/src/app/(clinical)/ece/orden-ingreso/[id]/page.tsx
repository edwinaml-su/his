"use client";

/**
 * ECE — Detalle de Orden de Ingreso (ORD_ING).
 *
 * Muestra los campos clínicos de la orden. Permite firmar (si borrador)
 * o anular (si firmado, rol DIR) con PinDialog inline.
 */
import { useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";
import type { MODALIDAD_ING, MOTIVO_INGRESO_TIPO, PROCEDENCIA } from "@his/contracts/schemas/orden-ingreso";

// ─── Etiquetas ────────────────────────────────────────────────────────────────

const MODALIDAD_LABEL: Record<typeof MODALIDAD_ING[number], string> = {
  hospitalizacion: "Hospitalización",
  hospital_de_dia: "Hospital de día",
};

const MOTIVO_TIPO_LABEL: Record<typeof MOTIVO_INGRESO_TIPO[number], string> = {
  cirugia:         "Cirugía",
  emergencia:      "Emergencia",
  hospitalizacion: "Hospitalización médica",
  obs:             "Obstetricia",
  otro:            "Otro",
};

const PROCEDENCIA_LABEL: Record<typeof PROCEDENCIA[number], string> = {
  consulta_externa:  "Consulta externa",
  emergencia:        "Emergencia",
  traslado_externo:  "Traslado externo",
  traslado_interno:  "Traslado interno",
  espontaneo:        "Espontáneo",
  otro:              "Otro",
};

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  borrador:    "outline",
  en_revision: "secondary",
  firmado:     "secondary",
  validado:    "default",
  anulado:     "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "long", timeStyle: "short" });

// ─── Componente principal ─────────────────────────────────────────────────────

export default function OrdenIngresoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pinMode, setPinMode]           = useState<"firmar" | "anular" | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState("");

  const query = trpc.eceOrdenIngreso.get.useQuery({ id }, { enabled: !!id });
  const orden = query.data;

  const firmarMutation = trpc.eceOrdenIngreso.firmar.useMutation({
    onSuccess: () => query.refetch(),
  });

  const anularMutation = trpc.eceOrdenIngreso.anular.useMutation({
    onSuccess: () => { query.refetch(); setPinMode(null); setMotivoAnulacion(""); },
  });

  async function handleFirmarPin(pin: string) {
    await firmarMutation.mutateAsync({ id, firmaPin: pin });
    setPinMode(null);
  }

  if (query.isLoading) return <p className="p-4 text-sm text-muted-foreground">Cargando…</p>;
  if (query.error) return <p role="alert" className="p-4 text-sm text-destructive">{query.error.message}</p>;
  if (!orden) return <p className="p-4 text-sm text-muted-foreground">Orden no encontrada.</p>;

  const estado = orden.estado_documento ?? "";
  const canFirmar = estado === "borrador" || estado === "en_revision";
  const canAnular = estado === "firmado";

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      {/* Cabecera */}
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon">
          <Link href="/ece/orden-ingreso" aria-label="Volver">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Orden de Ingreso</h1>
          <p className="font-mono text-xs text-muted-foreground">{id}</p>
        </div>
        <Badge variant={ESTADO_VARIANT[estado] ?? "outline"}>
          {estado.charAt(0).toUpperCase() + estado.slice(1)}
        </Badge>
      </div>

      {/* Datos clínicos */}
      <Card>
        <CardHeader><CardTitle>Datos clínicos</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <DetailRow label="Paciente"          value={orden.paciente_id} mono />
          <DetailRow label="Médico que ordena" value={orden.medico_ordena} mono />
          <DetailRow
            label="Fecha de la orden"
            value={dateFmt.format(new Date(orden.fecha_hora_orden))}
          />
          <DetailRow
            label="Modalidad"
            value={MODALIDAD_LABEL[orden.modalidad as typeof MODALIDAD_ING[number]] ?? orden.modalidad}
          />
          <DetailRow
            label="Tipo de motivo"
            value={MOTIVO_TIPO_LABEL[orden.motivo_ingreso_tipo as typeof MOTIVO_INGRESO_TIPO[number]] ?? (orden.motivo_ingreso_tipo ?? "—")}
          />
          <DetailRow
            label="Procedencia"
            value={PROCEDENCIA_LABEL[orden.procedencia as typeof PROCEDENCIA[number]] ?? orden.procedencia}
          />
          {orden.procedimiento_cie10 && (
            <DetailRow label="Procedimiento CIE-10" value={orden.procedimiento_cie10} />
          )}
          {orden.episodio_origen_id && (
            <DetailRow label="Episodio origen" value={orden.episodio_origen_id} mono />
          )}
          {orden.reserva_sala_qx_id && (
            <DetailRow label="Reserva sala QX" value={orden.reserva_sala_qx_id} mono />
          )}
          <div className="md:col-span-2">
            <DetailRow label="Motivo de ingreso" value={orden.motivo_ingreso} />
          </div>
          <div className="md:col-span-2">
            <DetailRow label="Circunstancia del ingreso" value={orden.circunstancia_ingreso} />
          </div>
        </CardContent>
      </Card>

      {/* Diagnósticos — back-compat: shape legacy { cie10, descripcion, principal }
           y nuevo shape CIE-11 { cie11Codigo, cie11Titulo, tipo } (CC-0005). */}
      {Array.isArray(orden.diagnostico_ingreso) && orden.diagnostico_ingreso.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Diagnósticos de ingreso</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {(
                orden.diagnostico_ingreso as Array<
                  | { cie11Codigo: string; cie11Titulo: string; tipo: string }
                  | { cie10: string; descripcion: string; principal: boolean }
                >
              ).map((d, i) => {
                const esCie11 = "cie11Codigo" in d;
                const codigo   = esCie11 ? d.cie11Codigo : d.cie10;
                const titulo   = esCie11 ? d.cie11Titulo : d.descripcion;
                const esPpal   = esCie11 ? d.tipo === "PRINCIPAL" : d.principal;
                return (
                  <li key={i} className="flex items-start gap-2">
                    <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{codigo}</span>
                    <span>{titulo}</span>
                    {esPpal && <Badge variant="outline" className="ml-auto text-xs">Principal</Badge>}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Acciones */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canFirmar && (
          <Button onClick={() => setPinMode("firmar")} className="flex-1">
            Firmar orden
          </Button>
        )}
        {canAnular && (
          <Button onClick={() => setPinMode("anular")} variant="destructive" className="flex-1">
            Anular orden
          </Button>
        )}
      </div>

      {/* Modal firmar */}
      {pinMode === "firmar" && (
        <PinDialog
          titulo="Firmar Orden de Ingreso — NTEC Art. 33"
          onConfirm={handleFirmarPin}
          onCancel={() => setPinMode(null)}
          error={firmarMutation.error?.message}
        />
      )}

      {/* Modal anular — requiere motivo + confirmación DIR (no PIN en la BD) */}
      {pinMode === "anular" && (
        <AnularDialog
          motivo={motivoAnulacion}
          onMotivoChange={setMotivoAnulacion}
          onConfirm={() => {
            if (motivoAnulacion.trim().length < 10) return;
            anularMutation.mutate({ id, motivoAnulacion: motivoAnulacion.trim() });
          }}
          onCancel={() => { setPinMode(null); setMotivoAnulacion(""); }}
          isPending={anularMutation.isPending}
          error={anularMutation.error?.message}
        />
      )}
    </main>
  );
}

// ─── Helpers de presentación ──────────────────────────────────────────────────

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? "font-mono text-xs break-all" : ""}>{value}</p>
    </div>
  );
}

// ─── PinDialog inline ─────────────────────────────────────────────────────────

function PinDialog({
  titulo,
  onConfirm,
  onCancel,
  error: externalError,
}: {
  titulo: string;
  onConfirm: (pin: string) => Promise<void>;
  onCancel: () => void;
  error?: string;
}) {
  const [pin, setPin]       = useState("");
  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) { setError("El PIN es requerido."); return; }
    setError(null);
    setLoading(true);
    try {
      await onConfirm(pin.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al confirmar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold">{titulo}</h2>
        <div className="space-y-1.5">
          <Label htmlFor="pin-input">PIN de firma electrónica</Label>
          <Input
            id="pin-input"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="4–8 dígitos"
            autoFocus
            required
          />
        </div>
        {(error ?? externalError) && (
          <p role="alert" className="text-sm text-destructive">{error ?? externalError}</p>
        )}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button type="submit" disabled={loading}>{loading ? "Verificando…" : "Confirmar"}</Button>
        </div>
      </form>
    </div>
  );
}

// ─── AnularDialog ─────────────────────────────────────────────────────────────

function AnularDialog({
  motivo,
  onMotivoChange,
  onConfirm,
  onCancel,
  isPending,
  error,
}: {
  motivo: string;
  onMotivoChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  error?: string;
}) {
  const valid = motivo.trim().length >= 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-destructive">Anular orden de ingreso</h2>
        <p className="text-sm text-muted-foreground">
          Esta acción es irreversible. La orden quedará anulada y deberá emitirse una nueva.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="motivo-anulacion">Motivo de anulación (mín. 10 caracteres)</Label>
          <textarea
            id="motivo-anulacion"
            value={motivo}
            onChange={(e) => onMotivoChange(e.target.value)}
            rows={3}
            className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            placeholder="Indique la causa de anulación..."
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>Cancelar</Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={!valid || isPending}
          >
            {isPending ? "Anulando…" : "Confirmar anulación"}
          </Button>
        </div>
      </div>
    </div>
  );
}

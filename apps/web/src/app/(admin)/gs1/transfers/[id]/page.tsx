"use client";

/**
 * GS1 — Detalle de transferencia + recepción/rechazo (Proceso B).
 *
 * El receptor escanea todos los productos con <Gs1Scanner> antes de
 * poder marcar como recibido. La UI lleva conteo de productos verificados.
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Scan, CheckCircle2, XCircle, ArrowLeft, PackageCheck } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

type Producto = {
  gtin: string;
  lote: string;
  fechaVencimiento: string;
  cantidad: number;
  uom: string;
};

// ---------------------------------------------------------------------------
// Gs1Scanner inline (igual que nueva/page.tsx — no extraemos a shared todavía)
// ---------------------------------------------------------------------------

function Gs1Scanner({
  label,
  placeholder,
  onScan,
}: {
  label: string;
  placeholder?: string;
  onScan: (value: string) => void;
}) {
  const [value, setValue] = React.useState("");
  const inputId = React.useId();

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) { onScan(value.trim()); setValue(""); }
    }
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor={inputId}>{label}</Label>
        <div className="relative">
          <Scan className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            id={inputId}
            className="pl-8 font-mono"
            placeholder={placeholder ?? "Escanear..."}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => { if (value.trim()) { onScan(value.trim()); setValue(""); } }}
        aria-label={`Confirmar ${label}`}
      >
        OK
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estadoBadge(estado: string) {
  const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    programado:  "outline",
    en_transito: "secondary",
    recibido:    "default",
    rechazado:   "destructive",
  };
  return <Badge variant={map[estado] ?? "outline"}>{estado.replace("_", " ")}</Badge>;
}

function fmtDate(d: Date | null | string): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV", { dateStyle: "medium", timeStyle: "short" });
}

function parseProductos(raw: unknown): Producto[] {
  if (Array.isArray(raw)) return raw as Producto[];
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Producto[]; } catch { return []; }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TransferenciaDetallePage() {
  const params  = useParams<{ id: string }>();
  const router  = useRouter();
  const [verificados, setVerificados] = React.useState<Set<string>>(new Set());
  const [rechazar, setRechazar]       = React.useState(false);
  const [motivo, setMotivo]           = React.useState("");
  const [error, setError]             = React.useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.gs1ProcesoB.get.useQuery(
    { id: params.id },
    { enabled: !!params.id },
  );

  const recibirMutation = trpc.gs1ProcesoB.recibirTransferencia.useMutation({
    onSuccess: () => { void refetch(); },
    onError: (err) => { setError(err.message); },
  });

  const productos = data ? parseProductos(data.productos) : [];

  // Marcar producto verificado por GTIN scaneado
  function handleProductoScan(gtin: string) {
    const match = productos.find((p) => p.gtin === gtin);
    if (!match) {
      setError(`GTIN ${gtin} no está en esta transferencia.`);
      return;
    }
    setError(null);
    setVerificados((v) => new Set(v).add(gtin));
  }

  const todosVerificados = productos.length > 0 &&
    productos.every((p) => verificados.has(p.gtin));

  function handleConfirmar() {
    setError(null);
    if (!rechazar && !todosVerificados) {
      setError("Escanea todos los productos antes de marcar como recibido.");
      return;
    }
    if (rechazar && !motivo.trim()) {
      setError("El motivo de rechazo es obligatorio.");
      return;
    }
    recibirMutation.mutate({
      id: params.id,
      rechazar,
      motivoRechazo: rechazar ? motivo.trim() : undefined,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <p aria-live="polite" className="text-muted-foreground">
        Cargando transferencia...
      </p>
    );
  }

  if (!data) {
    return (
      <div role="alert" className="text-destructive">
        Transferencia no encontrada.
      </div>
    );
  }

  const puedeRecibir = data.estado === "en_transito";

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            aria-label="Volver a lista de transferencias"
          >
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
          <h1 className="text-2xl font-bold font-mono">
            {params.id.slice(0, 8).toUpperCase()}...
          </h1>
          <div className="mt-1 flex items-center gap-2">
            {estadoBadge(data.estado)}
            {data.sscc_pallet && (
              <Badge variant="outline" className="font-mono text-xs">
                SSCC: {data.sscc_pallet}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Info depósitos */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Origen GLN</p>
            <p className="mt-1 font-mono font-medium">{data.origen_gln}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Destino GLN</p>
            <p className="mt-1 font-mono font-medium">{data.destino_gln}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Fecha envío</p>
            <p className="mt-1 text-sm">{fmtDate(data.fecha_envio)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Fecha recepción</p>
            <p className="mt-1 text-sm">{fmtDate(data.fecha_recepcion)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla productos */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Productos
              <Badge variant="secondary" className="ml-2">
                {verificados.size}/{productos.length} verificados
              </Badge>
            </CardTitle>
            {todosVerificados && (
              <span
                className="flex items-center gap-1 text-sm text-green-600"
                role="status"
                aria-live="polite"
              >
                <PackageCheck className="h-4 w-4" aria-hidden="true" />
                Todos verificados
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div role="region" aria-label="Tabla de productos de la transferencia" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">GTIN</TableHead>
                  <TableHead scope="col">Lote</TableHead>
                  <TableHead scope="col">Vencimiento</TableHead>
                  <TableHead scope="col">Cantidad</TableHead>
                  <TableHead scope="col">UoM</TableHead>
                  <TableHead scope="col">Verificado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productos.map((p) => {
                  const ok = verificados.has(p.gtin);
                  return (
                    <TableRow key={p.gtin + p.lote} className={ok ? "bg-green-50 dark:bg-green-950/20" : ""}>
                      <TableCell className="font-mono text-xs">{p.gtin}</TableCell>
                      <TableCell className="text-xs">{p.lote}</TableCell>
                      <TableCell className="text-xs">{p.fechaVencimiento}</TableCell>
                      <TableCell className="tabular-nums">{p.cantidad}</TableCell>
                      <TableCell className="text-xs">{p.uom}</TableCell>
                      <TableCell>
                        {ok ? (
                          <CheckCircle2 className="h-5 w-5 text-green-600" aria-label="Verificado" />
                        ) : (
                          <XCircle className="h-5 w-5 text-muted-foreground/40" aria-label="Pendiente" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Panel de recepción — solo si en_transito */}
      {puedeRecibir && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Confirmar recepción</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Scanner para verificar productos */}
            <Gs1Scanner
              label="Escanear GTIN del producto para verificar"
              placeholder="Escanear GTIN..."
              onScan={handleProductoScan}
            />

            {/* Toggle rechazo */}
            <div className="flex items-center gap-3">
              <input
                id="rechazar-toggle"
                type="checkbox"
                role="switch"
                aria-checked={rechazar}
                checked={rechazar}
                onChange={(e) => {
                  setRechazar(e.target.checked);
                  setError(null);
                }}
                className="h-4 w-4 cursor-pointer rounded border-border accent-destructive"
              />
              <Label htmlFor="rechazar-toggle" className="cursor-pointer text-destructive">
                Rechazar transferencia
              </Label>
            </div>

            {rechazar && (
              <div className="space-y-1.5">
                <Label htmlFor="motivo-rechazo">Motivo de rechazo *</Label>
                <Textarea
                  id="motivo-rechazo"
                  required
                  maxLength={1000}
                  rows={3}
                  placeholder="Describa el motivo del rechazo..."
                  aria-required="true"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant={rechazar ? "destructive" : "default"}
                disabled={recibirMutation.isPending}
                aria-busy={recibirMutation.isPending}
                onClick={handleConfirmar}
              >
                {recibirMutation.isPending
                  ? "Guardando..."
                  : rechazar
                  ? "Rechazar transferencia"
                  : "Confirmar recepción"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Motivo rechazo si ya fue rechazada */}
      {data.estado === "rechazado" && data.motivo_rechazo && (
        <Card className="border-destructive">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">Motivo de rechazo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{data.motivo_rechazo}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

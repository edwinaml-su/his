"use client";

/**
 * GS1 — Formulario nueva transferencia (Proceso B).
 *
 * Incluye scanner GS1 para leer SSCC/GTIN del pallet y productos.
 * La verificación de productos se hace vía input manual o escaneo.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Scan, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type ProductoRow = {
  gtin: string;
  lote: string;
  fechaVencimiento: string;
  cantidad: number;
  uom: string;
};

type FormState = {
  origenGln: string;
  destinoGln: string;
  ssccPallet: string;
  productos: ProductoRow[];
  fechaEnvio: string;
};

const PRODUCTO_EMPTY: ProductoRow = {
  gtin: "",
  lote: "",
  fechaVencimiento: "",
  cantidad: 1,
  uom: "EA",
};

// ---------------------------------------------------------------------------
// Componente scanner GS1 (stub — integrar con lector HID/barcode real)
// ---------------------------------------------------------------------------

/**
 * Gs1Scanner — captura scan de código GS1-128 / QR GS1 y emite el valor.
 *
 * En producción se conecta al evento `keydown` del lector HID o a
 * una API de cámara. Por ahora es un input de texto que simula el scan.
 *
 * El `aria-label` describe el tipo de código esperado.
 */
function Gs1Scanner({
  label,
  placeholder,
  onScan,
  "aria-label": ariaLabel,
}: {
  label: string;
  placeholder?: string;
  onScan: (value: string) => void;
  "aria-label"?: string;
}) {
  const [value, setValue] = React.useState("");
  const inputId = React.useId();

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Los lectores HID terminan con Enter
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) {
        onScan(value.trim());
        setValue("");
      }
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Scan
            className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={inputId}
            className="pl-8 font-mono"
            placeholder={placeholder ?? "Escanear o escribir..."}
            aria-label={ariaLabel ?? label}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (value.trim()) {
              onScan(value.trim());
              setValue("");
            }
          }}
          aria-label={`Confirmar ${label}`}
        >
          OK
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Escanea con lector o escribe y presiona Enter / OK.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NuevaTransferenciaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>({
    origenGln: "",
    destinoGln: "",
    ssccPallet: "",
    productos: [{ ...PRODUCTO_EMPTY }],
    fechaEnvio: new Date().toISOString().slice(0, 16),
  });
  const [error, setError] = React.useState<string | null>(null);

  const enviarMutation = trpc.gs1ProcesoB.enviarTransferencia.useMutation({
    onSuccess: (data) => {
      router.push(`/gs1/transfers/${data.id}`);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // ── Handlers de productos ──────────────────────────────────────────────

  function addProducto() {
    setForm((f) => ({ ...f, productos: [...f.productos, { ...PRODUCTO_EMPTY }] }));
  }

  function removeProducto(idx: number) {
    setForm((f) => ({
      ...f,
      productos: f.productos.filter((_, i) => i !== idx),
    }));
  }

  function updateProducto(idx: number, field: keyof ProductoRow, value: string | number) {
    setForm((f) => ({
      ...f,
      productos: f.productos.map((p, i) =>
        i === idx ? { ...p, [field]: value } : p,
      ),
    }));
  }

  function handleGtinScan(idx: number, gtin: string) {
    updateProducto(idx, "gtin", gtin);
  }

  function handleSsccScan(sscc: string) {
    setForm((f) => ({ ...f, ssccPallet: sscc }));
  }

  // ── Submit ────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const productosValidos = form.productos.filter(
      (p) => p.gtin && p.lote && p.fechaVencimiento && p.cantidad > 0,
    );

    if (productosValidos.length === 0) {
      setError("Agrega al menos un producto con GTIN, lote, vencimiento y cantidad.");
      return;
    }

    enviarMutation.mutate({
      origenGln:  form.origenGln.trim(),
      destinoGln: form.destinoGln.trim(),
      ssccPallet: form.ssccPallet.trim() || undefined,
      productos:  productosValidos,
      fechaEnvio: new Date(form.fechaEnvio),
    });
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Truck className="h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Nueva transferencia GS1</h1>
          <p className="text-sm text-muted-foreground">
            Proceso B — envío entre depósitos.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        aria-label="Formulario de nueva transferencia GS1"
        className="space-y-4"
      >
        {/* Depósitos */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Depósitos</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="origen-gln">GLN origen *</Label>
              <Input
                id="origen-gln"
                required
                maxLength={13}
                minLength={13}
                pattern="\d{13}"
                placeholder="0000000000000"
                className="font-mono"
                aria-describedby="gln-hint"
                value={form.origenGln}
                onChange={(e) => setForm((f) => ({ ...f, origenGln: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="destino-gln">GLN destino *</Label>
              <Input
                id="destino-gln"
                required
                maxLength={13}
                minLength={13}
                pattern="\d{13}"
                placeholder="0000000000000"
                className="font-mono"
                aria-describedby="gln-hint"
                value={form.destinoGln}
                onChange={(e) => setForm((f) => ({ ...f, destinoGln: e.target.value }))}
              />
            </div>
            <p id="gln-hint" className="text-xs text-muted-foreground sm:col-span-2">
              El GLN (Global Location Number) debe tener exactamente 13 dígitos.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="fecha-envio">Fecha / hora de envío *</Label>
              <Input
                id="fecha-envio"
                type="datetime-local"
                required
                value={form.fechaEnvio}
                onChange={(e) => setForm((f) => ({ ...f, fechaEnvio: e.target.value }))}
              />
            </div>

            {/* SSCC Pallet via scanner */}
            <div className="sm:col-span-2">
              <Gs1Scanner
                label="SSCC pallet (opcional)"
                placeholder="Escanear etiqueta GS1-128..."
                aria-label="SSCC del pallet — 18 dígitos"
                onScan={handleSsccScan}
              />
              {form.ssccPallet && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {form.ssccPallet}
                  </Badge>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => setForm((f) => ({ ...f, ssccPallet: "" }))}
                    aria-label="Limpiar SSCC"
                  >
                    Limpiar
                  </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Productos */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Productos{" "}
                <Badge variant="secondary" className="ml-1">
                  {form.productos.length}
                </Badge>
              </CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addProducto}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Agregar producto
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {form.productos.map((producto, idx) => (
              <fieldset
                key={idx}
                className="relative rounded-md border p-4"
                aria-label={`Producto ${idx + 1}`}
              >
                <legend className="px-1 text-sm font-medium text-muted-foreground">
                  Producto {idx + 1}
                </legend>

                {form.productos.length > 1 && (
                  <button
                    type="button"
                    className="absolute right-3 top-3 rounded p-1 text-destructive hover:bg-destructive/10"
                    onClick={() => removeProducto(idx)}
                    aria-label={`Eliminar producto ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {/* GTIN via scanner */}
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Gs1Scanner
                      label={`GTIN producto ${idx + 1} *`}
                      placeholder="Escanear código de barras..."
                      aria-label={`GTIN del producto ${idx + 1} — 8 a 14 dígitos`}
                      onScan={(v) => handleGtinScan(idx, v)}
                    />
                    {producto.gtin && (
                      <Badge variant="outline" className="mt-1 font-mono">
                        {producto.gtin}
                      </Badge>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`lote-${idx}`}>Lote *</Label>
                    <Input
                      id={`lote-${idx}`}
                      required
                      maxLength={50}
                      value={producto.lote}
                      onChange={(e) => updateProducto(idx, "lote", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`venc-${idx}`}>Fecha vencimiento *</Label>
                    <Input
                      id={`venc-${idx}`}
                      type="date"
                      required
                      value={producto.fechaVencimiento}
                      onChange={(e) => updateProducto(idx, "fechaVencimiento", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`cantidad-${idx}`}>Cantidad *</Label>
                    <Input
                      id={`cantidad-${idx}`}
                      type="number"
                      min={1}
                      required
                      value={producto.cantidad}
                      onChange={(e) =>
                        updateProducto(idx, "cantidad", parseInt(e.target.value, 10) || 1)
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`uom-${idx}`}>Unidad (UoM)</Label>
                    <Input
                      id={`uom-${idx}`}
                      maxLength={20}
                      value={producto.uom}
                      onChange={(e) => updateProducto(idx, "uom", e.target.value)}
                    />
                  </div>
                </div>
              </fieldset>
            ))}
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={enviarMutation.isPending}
            aria-busy={enviarMutation.isPending}
          >
            {enviarMutation.isPending ? "Enviando..." : "Registrar envío"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  );
}

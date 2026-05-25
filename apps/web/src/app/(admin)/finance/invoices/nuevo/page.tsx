"use client";

/**
 * /finance/invoices/nuevo — Formulario de nueva factura.
 *
 * Datos cabecera: patientId, insurer (opcional), costCenter cabecera (opcional), currency.
 * Items dinámicos: description, quantity, unitPrice, costCenterId (obligatorio por línea).
 * IVA 13% calculado en cliente (preview) y confirmado en router al guardar.
 * Botones: "Guardar borrador" (DRAFT) | "Emitir" (ISSUED).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const IVA_RATE = 0.13;

interface ItemLine {
  description: string;
  quantity: string;
  unitPrice: string;
  costCenterId: string;
  serviceUnitId: string;
}

function emptyLine(): ItemLine {
  return { description: "", quantity: "1", unitPrice: "0", costCenterId: "", serviceUnitId: "" };
}

type CostCenter = { id: string; code: string; name: string };

export default function NuevaFacturaPage() {
  const router = useRouter();

  // Cabecera
  const [patientId, setPatientId] = React.useState("");
  const [insurerId, setInsurerId] = React.useState("");
  const [costCenterId, setCostCenterId] = React.useState("");
  const [currencyId, setCurrencyId] = React.useState("");

  // Items
  const [items, setItems] = React.useState<ItemLine[]>([emptyLine()]);

  // UI state
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const costCentersQuery = trpcAny.invoice.listCostCenters.useQuery();
  const currenciesQuery = trpcAny.currency.list.useQuery();
  const insurersQuery = trpcAny.insurance.insurer.list.useQuery({ limit: 200 });

  const costCenters: CostCenter[] = costCentersQuery.data ?? [];
  const currencies: { id: string; isoCode: string; name: string }[] =
    currenciesQuery.data ?? [];
  const insurers: { id: string; name: string }[] = insurersQuery.data ?? [];

  const createMutation = trpcAny.invoice.create.useMutation({
    onSuccess: (data: { id: string; invoiceNumber: string }) => {
      router.push(`/finance/invoices/${data.id}`);
    },
    onError: (err: { message: string }) => {
      setError(err.message ?? "Error al guardar la factura.");
      setSaving(false);
    },
  });

  // Cálculos en tiempo real
  const subtotal = items.reduce((acc, it) => {
    const qty = parseFloat(it.quantity) || 0;
    const up = parseFloat(it.unitPrice) || 0;
    return acc + qty * up;
  }, 0);
  const taxAmount = subtotal * IVA_RATE;
  const total = subtotal + taxAmount;

  function fmt(n: number) {
    return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function updateItem(idx: number, field: keyof ItemLine, value: string) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  }

  function addLine() {
    setItems((prev) => [...prev, emptyLine()]);
  }

  function removeLine(idx: number) {
    if (items.length === 1) return; // siempre al menos 1 línea
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function validate(): string | null {
    if (!patientId.trim()) return "El ID de paciente es requerido.";
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(patientId.trim())) return "ID de paciente no es un UUID válido.";
    if (!currencyId) return "Selecciona la moneda.";
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (!it.description.trim()) return `Línea ${i + 1}: descripción requerida.`;
      if (!it.costCenterId) return `Línea ${i + 1}: centro de costo requerido.`;
      if (parseFloat(it.quantity) <= 0) return `Línea ${i + 1}: cantidad debe ser positiva.`;
    }
    return null;
  }

  function handleSave(status: "DRAFT" | "ISSUED") {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError(null);
    setSaving(true);

    createMutation.mutate({
      patientId: patientId.trim(),
      ...(insurerId ? { insurerId } : {}),
      ...(costCenterId ? { costCenterId } : {}),
      currencyId,
      status,
      items: items.map((it) => ({
        description: it.description.trim(),
        quantity: parseFloat(it.quantity),
        unitPrice: parseFloat(it.unitPrice),
        costCenterId: it.costCenterId,
        ...(it.serviceUnitId ? { serviceUnitId: it.serviceUnitId } : {}),
      })),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nueva factura</h1>
        <p className="text-sm text-muted-foreground">
          Completa los datos de cabecera y los items a facturar.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Cabecera */}
      <Card>
        <CardHeader>
          <CardTitle>Datos de cabecera</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="patientId">ID Paciente (UUID) *</Label>
            <Input
              id="patientId"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="insurer">Aseguradora</Label>
            <Select value={insurerId || "none"} onValueChange={(v) => setInsurerId(v === "none" ? "" : v)}>
              <SelectTrigger id="insurer">
                <SelectValue placeholder="Sin aseguradora" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin aseguradora</SelectItem>
                {insurers.map((ins) => (
                  <SelectItem key={ins.id} value={ins.id}>
                    {ins.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="costCenterHeader">Centro de costo (cabecera)</Label>
            <Select
              value={costCenterId || "none"}
              onValueChange={(v) => setCostCenterId(v === "none" ? "" : v)}
            >
              <SelectTrigger id="costCenterHeader">
                <SelectValue placeholder="Opcional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguno</SelectItem>
                {costCenters.map((cc) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    {cc.code} — {cc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="currency">Moneda *</Label>
            <Select value={currencyId || "none"} onValueChange={(v) => setCurrencyId(v === "none" ? "" : v)}>
              <SelectTrigger id="currency">
                <SelectValue placeholder="Selecciona moneda" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— seleccionar —</SelectItem>
                {currencies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.isoCode} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Items</CardTitle>
            <Button size="sm" variant="outline" onClick={addLine}>
              + Agregar línea
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Header row */}
          <div className="hidden grid-cols-[1fr_80px_100px_200px_100px_40px] gap-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Descripción *</span>
            <span>Cantidad</span>
            <span>Precio unit.</span>
            <span>Centro costo *</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          {items.map((it, idx) => {
            const lineTotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
            return (
              <div
                key={idx}
                className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_80px_100px_200px_100px_40px] sm:border-none sm:p-0"
              >
                <Input
                  placeholder="Descripción del servicio"
                  value={it.description}
                  onChange={(e) => updateItem(idx, "description", e.target.value)}
                />
                <Input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={it.quantity}
                  onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={it.unitPrice}
                  onChange={(e) => updateItem(idx, "unitPrice", e.target.value)}
                />
                <Select
                  value={it.costCenterId || "none"}
                  onValueChange={(v) => updateItem(idx, "costCenterId", v === "none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Centro de costo *" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— seleccionar —</SelectItem>
                    {costCenters.map((cc) => (
                      <SelectItem key={cc.id} value={cc.id}>
                        {cc.code} — {cc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-end font-mono text-sm">
                  ${fmt(lineTotal)}
                </div>
                <div className="flex items-center justify-center">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeLine(idx)}
                    disabled={items.length === 1}
                    aria-label="Eliminar línea"
                  >
                    ×
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Totales */}
          <div className="mt-4 flex flex-col items-end gap-1 border-t pt-4">
            <div className="flex w-56 justify-between text-sm">
              <span>Subtotal</span>
              <span className="font-mono">${fmt(subtotal)}</span>
            </div>
            <div className="flex w-56 justify-between text-sm text-muted-foreground">
              <span>IVA (13%)</span>
              <span className="font-mono">${fmt(taxAmount)}</span>
            </div>
            <div className="flex w-56 justify-between font-semibold">
              <span>Total</span>
              <span className="font-mono">${fmt(total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.back()} disabled={saving}>
          Cancelar
        </Button>
        <Button
          variant="outline"
          onClick={() => handleSave("DRAFT")}
          disabled={saving}
        >
          Guardar borrador
        </Button>
        <Button
          onClick={() => handleSave("ISSUED")}
          disabled={saving}
        >
          Emitir factura
        </Button>
      </div>
    </div>
  );
}

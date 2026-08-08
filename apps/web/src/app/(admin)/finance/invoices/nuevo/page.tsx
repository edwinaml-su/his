"use client";

/**
 * /finance/invoices/nuevo — Formulario de nueva factura.
 *
 * Datos cabecera: patientId, insurer (opcional), costCenter cabecera (opcional), currency.
 * Items dinámicos: description, quantity, unitPrice, costCenterId (obligatorio por línea).
 * IVA 13% calculado en cliente (preview) y confirmado en router al guardar.
 * Botones: "Guardar borrador" (DRAFT) | "Emitir" (ISSUED).
 *
 * CC-0015: al elegir una cuenta del paciente, el combo de tarifario se filtra
 * a la lista de precios de su tipoCuenta (banner "Lista aplicada: ...") y cada
 * línea puede "Resolver precio" por código vía servicePriceList.resolverPorCuenta
 * (lista del tipo de cuenta → LabTest.standardPrice → sin precio).
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
  /** CC-0015 — código para "Resolver precio" (resolverPorCuenta) cuando el item se digita a mano. */
  code: string;
}

function emptyLine(): ItemLine {
  return {
    description: "",
    quantity: "1",
    unitPrice: "0",
    costCenterId: "",
    serviceUnitId: "",
    code: "",
  };
}

type TarifarioItem = {
  id: string;
  priceListName: string;
  code: string | null;
  description: string;
  unitPrice: string;
  estimatedCost: string | null;
  serviceUnitId: string | null;
  suggestedCostCenterId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
};

type CostCenter = { id: string; code: string; name: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function NuevaFacturaPage() {
  const router = useRouter();
  const utils = trpcAny.useUtils();

  // Cabecera
  const [patientId, setPatientId] = React.useState("");
  const [insurerId, setInsurerId] = React.useState("");
  const [costCenterId, setCostCenterId] = React.useState("");
  const [currencyId, setCurrencyId] = React.useState("");
  // CC-0015 — cuenta del paciente: ancla la factura y filtra el tarifario a su tipoCuenta.
  const [cuentaId, setCuentaId] = React.useState("");

  // Items
  const [items, setItems] = React.useState<ItemLine[]>([emptyLine()]);

  // UI state
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [resolviendoIdx, setResolviendoIdx] = React.useState<number | null>(null);

  const costCentersQuery = trpcAny.invoice.listCostCenters.useQuery();
  const currenciesQuery = trpcAny.currency.list.useQuery();
  const insurersQuery = trpcAny.insurance.insurer.list.useQuery({ limit: 200 });

  const patientIdValida = UUID_RE.test(patientId.trim());
  const cuentasQuery = trpcAny.patientAccount.listarPorPaciente.useQuery(
    { patientId: patientId.trim() },
    { enabled: patientIdValida },
  );
  const tiposCuentaQuery = trpcAny.tipoCuenta.list.useQuery({ activeOnly: true });

  type CuentaConTipo = { id: string; numeroCuenta: string; tipoCuenta: { id: string } | null };
  type TipoCuentaConLista = { id: string; nombre: string; priceListId: string | null; priceListName: string | null };

  const cuentas: CuentaConTipo[] = cuentasQuery.data ?? [];
  const tiposCuenta: TipoCuentaConLista[] = tiposCuentaQuery.data ?? [];
  const cuentaSeleccionada = cuentas.find((c) => c.id === cuentaId) ?? null;
  const tipoCuentaSeleccionado =
    tiposCuenta.find((t) => t.id === cuentaSeleccionada?.tipoCuenta?.id) ?? null;
  const priceListIdFiltro = tipoCuentaSeleccionado?.priceListId ?? undefined;

  const tarifarioItemsQuery = trpcAny.servicePriceList.listActiveItems.useQuery(
    priceListIdFiltro ? { priceListId: priceListIdFiltro } : undefined,
  );

  const costCenters: CostCenter[] = costCentersQuery.data ?? [];
  const currencies: { id: string; isoCode: string; name: string }[] =
    currenciesQuery.data ?? [];
  const insurers: { id: string; name: string }[] = insurersQuery.data ?? [];
  const tarifarioItems: TarifarioItem[] = tarifarioItemsQuery.data ?? [];

  const createMutation = trpcAny.invoice.create.useMutation({
    onSuccess: (data: { id: string; invoiceNumber: string }) => {
      router.push(`/finance/invoices/${data.id}`);
    },
    onError: (err: { message: string }) => {
      setError(err.message ?? "Error al guardar la factura.");
      setSaving(false);
    },
  });

  // CC-0015 — resuelve el precio de la línea `idx` por su `code` vía resolverPorCuenta
  // (lista del tipoCuenta → LabTest.standardPrice → sin precio).
  async function resolverPrecioLinea(idx: number) {
    const line = items[idx];
    if (!line || !cuentaId || !line.code.trim()) return;
    setResolviendoIdx(idx);
    try {
      const resultados = (await utils.servicePriceList.resolverPorCuenta.fetch({
        cuentaId,
        codes: [line.code.trim()],
      })) as Array<{ code: string; precio: number | null; fuente: string | null }>;
      const resultado = resultados[0];
      if (resultado?.precio != null) {
        updateItem(idx, "unitPrice", String(resultado.precio));
      } else {
        setError(`Sin precio para el código "${line.code.trim()}" — ingresa el precio manualmente.`);
      }
    } finally {
      setResolviendoIdx(null);
    }
  }

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

  function applyTarifarioItem(lineIdx: number, item: TarifarioItem) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === lineIdx
          ? {
              ...it,
              description: item.description,
              unitPrice: String(Number(item.unitPrice)),
              costCenterId: item.suggestedCostCenterId ?? it.costCenterId,
              serviceUnitId: item.serviceUnitId ?? it.serviceUnitId,
              code: item.code ?? it.code,
            }
          : it,
      ),
    );
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
      ...(cuentaId ? { patientAccountId: cuentaId } : {}),
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
              onChange={(e) => {
                setPatientId(e.target.value);
                setCuentaId("");
              }}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="cuenta">Cuenta del paciente</Label>
            <Select
              value={cuentaId || "none"}
              onValueChange={(v) => setCuentaId(v === "none" ? "" : v)}
              disabled={!patientIdValida || cuentas.length === 0}
            >
              <SelectTrigger id="cuenta">
                <SelectValue placeholder={patientIdValida ? "Sin cuenta" : "Ingresa un paciente primero"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin cuenta</SelectItem>
                {cuentas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.numeroCuenta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      {/* CC-0015 — banner de lista de precios aplicada por el tipo de cuenta */}
      {cuentaId && tipoCuentaSeleccionado ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {tipoCuentaSeleccionado.priceListName ? (
            <>
              Lista aplicada: <strong className="text-foreground">{tipoCuentaSeleccionado.priceListName}</strong>{" "}
              (tipo de cuenta {tipoCuentaSeleccionado.nombre}).
            </>
          ) : (
            <>
              El tipo de cuenta ({tipoCuentaSeleccionado.nombre}) no tiene lista de precios asignada — se muestra
              el tarifario completo.
            </>
          )}
        </p>
      ) : null}

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
          <div className="hidden grid-cols-[180px_1fr_80px_100px_200px_100px_100px_40px] gap-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>Tarifario</span>
            <span>Descripción *</span>
            <span>Cantidad</span>
            <span>Precio unit.</span>
            <span>Centro costo *</span>
            <span>Código</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          {items.map((it, idx) => {
            const lineTotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
            return (
              <div
                key={idx}
                className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[180px_1fr_80px_100px_200px_100px_100px_40px] sm:border-none sm:p-0"
              >
                {/* Selector de tarifario — auto-llena descripción, precio y centro */}
                <Select
                  value="none"
                  onValueChange={(v) => {
                    if (v === "none") return;
                    const item = tarifarioItems.find((i) => i.id === v);
                    if (item) applyTarifarioItem(idx, item);
                  }}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue placeholder="Cargar desde tarifario" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— cargar desde tarifario —</SelectItem>
                    {tarifarioItems.map((ti) => (
                      <SelectItem key={ti.id} value={ti.id}>
                        {ti.code ? `[${ti.code}] ` : ""}{ti.description}
                        {ti.costCenterCode ? ` · ${ti.costCenterCode}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                {/* CC-0015 — código para "Resolver precio" por cuenta */}
                <div className="flex items-center gap-1">
                  <Input
                    placeholder="Código"
                    className="text-xs"
                    value={it.code}
                    onChange={(e) => updateItem(idx, "code", e.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 px-2 text-xs"
                    disabled={!cuentaId || !it.code.trim() || resolviendoIdx === idx}
                    onClick={() => void resolverPrecioLinea(idx)}
                  >
                    {resolviendoIdx === idx ? "…" : "Resolver"}
                  </Button>
                </div>
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

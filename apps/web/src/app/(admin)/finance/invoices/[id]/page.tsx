"use client";

/**
 * /finance/invoices/[id] — Detalle de factura.
 *
 * Tabs: Items | Pagos | Claims.
 * Acciones: Anular (si status != VOIDED), registrar pago, crear claim.
 * Confirmación requerida para Anular y Emitir.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

type InvoiceStatus = "DRAFT" | "ISSUED" | "PAID" | "PARTIALLY_PAID" | "VOIDED";

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Borrador",
  ISSUED: "Emitida",
  PAID: "Pagada",
  PARTIALLY_PAID: "Pago parcial",
  VOIDED: "Anulada",
};

const STATUS_VARIANT: Record<
  InvoiceStatus,
  "secondary" | "success" | "warning" | "outline" | "critical"
> = {
  DRAFT: "secondary",
  ISSUED: "warning",
  PAID: "success",
  PARTIALLY_PAID: "warning",
  VOIDED: "critical",
};

function fmt(n: string | number) {
  return Number(n).toLocaleString("es-SV", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString("es-SV", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type TabId = "items" | "pagos" | "claims";

function Tabs({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
}) {
  const tabs: { id: TabId; label: string }[] = [
    { id: "items", label: "Items" },
    { id: "pagos", label: "Pagos" },
    { id: "claims", label: "Claims" },
  ];
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            active === t.id
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = React.useState<TabId>("items");

  const query = trpcAny.invoice.get.useQuery({ id }, { enabled: Boolean(id) });
  const invoice = query.data?.invoice;
  const items: {
    id: string;
    description: string;
    quantity: string;
    unitPrice: string;
    totalPrice: string;
    costCenterId: string;
  }[] = query.data?.items ?? [];
  const payments: {
    id: string;
    paidAt: string;
    amount: string;
    method: string;
    referenceNumber: string | null;
  }[] = query.data?.payments ?? [];
  const claims: {
    id: string;
    claimNumber: string;
    submittedAt: string;
    status: string;
    submittedAmount: string;
    approvedAmount: string;
  }[] = query.data?.claims ?? [];

  // Anular
  const [confirmVoid, setConfirmVoid] = React.useState(false);
  const voidMutation = trpcAny.invoice.voidInvoice.useMutation({
    onSuccess: () => { setConfirmVoid(false); query.refetch?.(); },
  });

  // Pago
  const [payAmount, setPayAmount] = React.useState("");
  const [payMethod, setPayMethod] = React.useState("CASH");
  const [payRef, setPayRef] = React.useState("");
  const [payError, setPayError] = React.useState<string | null>(null);
  const payMutation = trpcAny.invoice.addPayment.useMutation({
    onSuccess: () => {
      setPayAmount("");
      setPayRef("");
      setPayError(null);
      query.refetch?.();
    },
    onError: (err: { message: string }) => setPayError(err.message),
  });

  // Claim
  const [claimInsurerId, setClaimInsurerId] = React.useState("");
  const [claimNumber, setClaimNumber] = React.useState("");
  const [claimAmount, setClaimAmount] = React.useState("");
  const [claimError, setClaimError] = React.useState<string | null>(null);
  const claimMutation = trpcAny.invoice.createClaim.useMutation({
    onSuccess: () => {
      setClaimNumber("");
      setClaimAmount("");
      setClaimError(null);
      query.refetch?.();
    },
    onError: (err: { message: string }) => setClaimError(err.message),
  });

  function handleAddPayment() {
    if (!payAmount || parseFloat(payAmount) <= 0) {
      setPayError("Monto requerido y debe ser positivo.");
      return;
    }
    setPayError(null);
    payMutation.mutate({
      invoiceId: id,
      amount: parseFloat(payAmount),
      method: payMethod,
      ...(payRef.trim() ? { referenceNumber: payRef.trim() } : {}),
    });
  }

  function handleCreateClaim() {
    if (!claimInsurerId) { setClaimError("Selecciona la aseguradora."); return; }
    if (!claimNumber.trim()) { setClaimError("Número de claim requerido."); return; }
    if (!claimAmount || parseFloat(claimAmount) < 0) {
      setClaimError("Monto enviado requerido.");
      return;
    }
    setClaimError(null);
    claimMutation.mutate({
      invoiceId: id,
      insurerId: claimInsurerId,
      claimNumber: claimNumber.trim(),
      submittedAmount: parseFloat(claimAmount),
    });
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando factura…</p>;
  }
  if (query.error || !invoice) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {(query.error as { message?: string })?.message ?? "Factura no encontrada."}
      </p>
    );
  }

  const isVoided = invoice.status === "VOIDED";
  const hasInsurer = Boolean(invoice.insurerId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-mono">{invoice.invoiceNumber}</h1>
            <Badge
              variant={
                STATUS_VARIANT[invoice.status as InvoiceStatus] ?? "secondary"
              }
            >
              {STATUS_LABELS[invoice.status as InvoiceStatus] ?? invoice.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Emitida: {fmtDate(invoice.issuedAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Volver
          </Button>
          {!isVoided ? (
            confirmVoid ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-destructive">¿Confirmar anulación?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => voidMutation.mutate({ invoiceId: id })}
                  disabled={voidMutation.isPending}
                >
                  Sí, anular
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmVoid(false)}
                  disabled={voidMutation.isPending}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setConfirmVoid(true)}>
                Anular
              </Button>
            )
          ) : null}
        </div>
      </div>

      {/* Totales */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Subtotal</p>
              <p className="font-mono font-medium">${fmt(invoice.subtotal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">IVA (13%)</p>
              <p className="font-mono font-medium">${fmt(invoice.taxAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="font-mono font-semibold text-lg">${fmt(invoice.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pagado</p>
              <p className="font-mono font-medium">${fmt(invoice.paidAmount)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs active={tab} onChange={setTab} />

      {/* Tab: Items */}
      {tab === "items" ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descripción</TableHead>
                <TableHead className="w-24 text-right">Cantidad</TableHead>
                <TableHead className="w-28 text-right">Precio unit.</TableHead>
                <TableHead className="w-28 text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    Sin items.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.description}</TableCell>
                    <TableCell className="text-right font-mono">{it.quantity}</TableCell>
                    <TableCell className="text-right font-mono">${fmt(it.unitPrice)}</TableCell>
                    <TableCell className="text-right font-mono">${fmt(it.totalPrice)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Tab: Pagos */}
      {tab === "pagos" ? (
        <div className="space-y-4">
          {!isVoided ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Registrar pago</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {payError ? (
                  <p className="text-sm text-destructive">{payError}</p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <div className="space-y-1">
                    <Label>Monto</Label>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Método</Label>
                    <Select value={payMethod} onValueChange={setPayMethod}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Efectivo</SelectItem>
                        <SelectItem value="CARD">Tarjeta</SelectItem>
                        <SelectItem value="TRANSFER">Transferencia</SelectItem>
                        <SelectItem value="INSURANCE">Seguro</SelectItem>
                        <SelectItem value="OTHER">Otro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Referencia</Label>
                    <Input
                      placeholder="Opcional"
                      value={payRef}
                      onChange={(e) => setPayRef(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleAddPayment} disabled={payMutation.isPending}>
                      Registrar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                      Sin pagos registrados.
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{fmtDate(p.paidAt)}</TableCell>
                      <TableCell>{p.method}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.referenceNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">${fmt(p.amount)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {/* Tab: Claims */}
      {tab === "claims" ? (
        <div className="space-y-4">
          {hasInsurer && !isVoided ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Crear claim</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {claimError ? (
                  <p className="text-sm text-destructive">{claimError}</p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <div className="space-y-1">
                    <Label>Aseguradora ID</Label>
                    <Input
                      placeholder="UUID de aseguradora"
                      value={claimInsurerId}
                      onChange={(e) => setClaimInsurerId(e.target.value)}
                      className="w-64"
                    />
                    {invoice.insurerId ? (
                      <button
                        className="text-xs text-primary underline"
                        onClick={() => setClaimInsurerId(invoice.insurerId)}
                      >
                        Usar aseguradora de la factura
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label>No. Claim</Label>
                    <Input
                      placeholder="CLM-2026-00001"
                      value={claimNumber}
                      onChange={(e) => setClaimNumber(e.target.value)}
                      className="w-44"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Monto enviado</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={claimAmount}
                      onChange={(e) => setClaimAmount(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={handleCreateClaim} disabled={claimMutation.isPending}>
                      Enviar claim
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : !hasInsurer ? (
            <p className="text-sm text-muted-foreground">
              Esta factura no tiene aseguradora asociada.
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Claim</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead className="w-36">Estado</TableHead>
                  <TableHead className="text-right">Enviado</TableHead>
                  <TableHead className="text-right">Aprobado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Sin claims registrados.
                    </TableCell>
                  </TableRow>
                ) : (
                  claims.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.claimNumber}</TableCell>
                      <TableCell className="text-sm">{fmtDate(c.submittedAt)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{c.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${fmt(c.submittedAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${fmt(c.approvedAmount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * US.F2.6.13-14 — Detalle del carrito: lista ítems + scan rápido para agregar.
 * Botón "Despachar" abre modal de confirmación con GLN destino.
 * Botón "Hoja de despacho" (impresión básica del navegador).
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ARMANDO: "secondary",
  LISTO: "outline",
  DESPACHADO: "default",
  RECIBIDO: "default",
};

const CAN_EDIT = new Set(["ARMANDO", "LISTO"]);

export default function CartDetailPage() {
  const params = useParams<{ cartId: string }>();
  const router = useRouter();
  const cartId = params.cartId;

  // scan input state
  const [scanValue, setScanValue] = React.useState("");
  const [loteValue, setLoteValue] = React.useState("");
  const [dispatchOpen, setDispatchOpen] = React.useState(false);

  const { data, refetch, isLoading } = trpc.pharmacyCart.getCart.useQuery({ cartId });

  const addItem = trpc.pharmacyCart.addItem.useMutation({
    onSuccess: () => {
      setScanValue("");
      setLoteValue("");
      void refetch();
    },
  });

  const removeItem = trpc.pharmacyCart.removeItem.useMutation({
    onSuccess: () => void refetch(),
  });

  const dispatch = trpc.pharmacyCart.dispatch.useMutation({
    onSuccess: () => {
      setDispatchOpen(false);
      void refetch();
    },
  });

  const cart = data?.cart;
  const editable = cart ? CAN_EDIT.has(cart.status) : false;

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    if (!scanValue || scanValue.length !== 14) return;
    addItem.mutate({
      cartId,
      gtin: scanValue,
      lote: loteValue || undefined,
      posicionCarrito: cart?.items.length ?? 0,
    });
  }

  function handlePrint() {
    window.print();
  }

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Cargando carrito...</p>;
  }
  if (!cart) {
    return <p className="p-4 text-destructive">Carrito no encontrado.</p>;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Carrito — {cart.patient.firstName} {cart.patient.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            MRN: {cart.patient.mrn} · Turno: {cart.turno} · GLN destino:{" "}
            <span className="font-mono">{cart.glnDestino}</span>
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[cart.status]}>{cart.status}</Badge>
      </div>

      {/* Scan rápido de GTIN */}
      {editable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agregar ítem (scan GTIN-14)</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleScan} className="flex gap-2">
              <Input
                aria-label="GTIN-14"
                placeholder="Escanee o ingrese GTIN-14"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                maxLength={14}
                className="font-mono w-52"
              />
              <Input
                aria-label="Lote"
                placeholder="Lote (opcional)"
                value={loteValue}
                onChange={(e) => setLoteValue(e.target.value)}
                maxLength={80}
                className="w-36"
              />
              <Button
                type="submit"
                disabled={scanValue.length !== 14 || addItem.isPending}
              >
                {addItem.isPending ? "Agregando..." : "Agregar"}
              </Button>
            </form>
            {addItem.error && (
              <p className="mt-1 text-sm text-destructive">
                {addItem.error.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lista de ítems */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Ítems del carrito ({cart.items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>GTIN</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead>Serie</TableHead>
                {editable && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {cart.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={editable ? 5 : 4}
                    className="text-center text-muted-foreground"
                  >
                    Sin ítems — escanee un GTIN para agregar
                  </TableCell>
                </TableRow>
              )}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {cart.items.map((item: any, i: number) => (
                <TableRow key={item.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="font-mono text-xs">{item.gtin}</TableCell>
                  <TableCell>{item.lote ?? "—"}</TableCell>
                  <TableCell>{item.serie ?? "—"}</TableCell>
                  {editable && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem.mutate({ cartItemId: item.id })}
                        disabled={removeItem.isPending}
                      >
                        Quitar
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex gap-3">
        <Button variant="outline" onClick={handlePrint}>
          Hoja de despacho (imprimir)
        </Button>

        {editable && (
          <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
            <DialogTrigger asChild>
              <Button disabled={cart.items.length === 0}>
                Despachar a {cart.glnDestino}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirmar despacho</DialogTitle>
                <DialogDescription>
                  Se despachará el carrito de {cart.items.length} ítem(s) al GLN{" "}
                  <span className="font-mono font-bold">{cart.glnDestino}</span>{" "}
                  para el paciente {cart.patient.firstName} {cart.patient.lastName} —
                  turno {cart.turno}. Esta acción no se puede deshacer.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDispatchOpen(false)}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={() => dispatch.mutate({ cartId })}
                  disabled={dispatch.isPending}
                >
                  {dispatch.isPending ? "Despachando..." : "Confirmar despacho"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        <Button variant="ghost" onClick={() => router.back()}>
          Volver
        </Button>
      </div>

      {dispatch.error && (
        <p className="text-sm text-destructive">{dispatch.error.message}</p>
      )}
    </div>
  );
}

"use client";

/**
 * US.F2.6.15-16 — Recepción Farmacia (Enfermería).
 * Lista carritos DESPACHADOS pendientes de recepción.
 * Botón "Confirmar Recepción" con firma electrónica simple (texto libre).
 */
import * as React from "react";
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
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/client";

export default function RecepcionFarmaciaPage() {
  const [selectedCart, setSelectedCart] = React.useState<string | null>(null);
  const [signature, setSignature] = React.useState("");

  const { data, isLoading, refetch } = trpc.pharmacyCart.list.useQuery({
    status: "DESPACHADO",
    limit: 100,
    offset: 0,
  });

  const receive = trpc.pharmacyCart.receiveAtService.useMutation({
    onSuccess: () => {
      setSelectedCart(null);
      setSignature("");
      void refetch();
    },
  });

  function openDialog(cartId: string) {
    setSelectedCart(cartId);
    setSignature("");
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Recepción Farmacia</h1>
        <Button variant="outline" onClick={() => refetch()}>
          Actualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Carritos pendientes de recepción ({data?.total ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>MRN</TableHead>
                  <TableHead>Turno</TableHead>
                  <TableHead>GLN Origen</TableHead>
                  <TableHead>Ítems</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.carts.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground"
                    >
                      No hay carritos pendientes de recepción
                    </TableCell>
                  </TableRow>
                )}
                {data?.carts.map((cart) => (
                  <TableRow key={cart.id}>
                    <TableCell>
                      {cart.patient.firstName} {cart.patient.lastName}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {cart.patient.mrn}
                    </TableCell>
                    <TableCell>{cart.turno}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {cart.glnDestino}
                    </TableCell>
                    <TableCell>{cart.items.length}</TableCell>
                    <TableCell>
                      <Badge variant="default">Despachado</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => openDialog(cart.id)}
                      >
                        Confirmar Recepción
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog de confirmación con firma */}
      <Dialog
        open={selectedCart !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCart(null);
            setSignature("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar recepción de carrito</DialogTitle>
            <DialogDescription>
              Ingrese su firma o identificación como constancia de recepción.
              Este evento queda registrado en la trazabilidad EPCIS.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <label
              htmlFor="firma-enfermeria"
              className="mb-1 block text-sm font-medium"
            >
              Firma / Identificación enfermera(o)
            </label>
            <Input
              id="firma-enfermeria"
              placeholder="Nombre completo o código de enfermera(o)"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              maxLength={200}
            />
          </div>

          {receive.error && (
            <p className="text-sm text-destructive">{receive.error.message}</p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSelectedCart(null);
                setSignature("");
              }}
            >
              Cancelar
            </Button>
            <Button
              disabled={!signature.trim() || receive.isPending || !selectedCart}
              onClick={() => {
                if (selectedCart) {
                  receive.mutate({ cartId: selectedCart, signature });
                }
              }}
            >
              {receive.isPending ? "Confirmando..." : "Confirmar recepción"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

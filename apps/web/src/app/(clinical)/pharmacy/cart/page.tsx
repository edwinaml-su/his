"use client";

/**
 * US.F2.6.12 — Vista por turno: lista pacientes con estado de su carrito unidosis.
 * Farmacéutico arma, revisa y despacha carritos desde esta vista.
 */
import * as React from "react";
import Link from "next/link";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/client";

const STATUS_LABELS: Record<string, string> = {
  ARMANDO: "Armando",
  LISTO: "Listo",
  DESPACHADO: "Despachado",
  RECIBIDO: "Recibido",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  ARMANDO: "secondary",
  LISTO: "outline",
  DESPACHADO: "default",
  RECIBIDO: "default",
};

type Turno = "MAÑANA" | "TARDE" | "NOCHE";
type CartStatus = "ARMANDO" | "LISTO" | "DESPACHADO" | "RECIBIDO";

export default function PharmacyCartListPage() {
  const [turno, setTurno] = React.useState<Turno>("MAÑANA");
  const [status, setStatus] = React.useState<CartStatus | "">("");

  const { data, isLoading, refetch } = trpc.pharmacyCart.list.useQuery({
    turno,
    status: status || undefined,
    limit: 50,
    offset: 0,
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Carrito Unidosis</h1>
        <Link href="/pharmacy/cart/nuevo">
          <Button>Nuevo carrito</Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <Select value={turno} onValueChange={(v) => setTurno(v as Turno)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Turno" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MAÑANA">Mañana</SelectItem>
            <SelectItem value="TARDE">Tarde</SelectItem>
            <SelectItem value="NOCHE">Noche</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(v) => setStatus(v as CartStatus | "")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Todos</SelectItem>
            <SelectItem value="ARMANDO">Armando</SelectItem>
            <SelectItem value="LISTO">Listo</SelectItem>
            <SelectItem value="DESPACHADO">Despachado</SelectItem>
            <SelectItem value="RECIBIDO">Recibido</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" onClick={() => refetch()}>
          Actualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Turno {turno} — {data?.total ?? 0} carritos
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
                  <TableHead>GLN Destino</TableHead>
                  <TableHead>Ítems</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.carts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No hay carritos para este turno
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
                    <TableCell className="font-mono text-xs">
                      {cart.glnDestino}
                    </TableCell>
                    <TableCell>{cart.items.length}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[cart.status]}>
                        {STATUS_LABELS[cart.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/pharmacy/cart/${cart.id}`}>
                        <Button variant="outline" size="sm">
                          Ver detalle
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

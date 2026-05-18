"use client";

/**
 * Farmacia — Preparación Unidosis (Proceso C GS1).
 *
 * Flujo:
 *   1. Formulario de preparación → llama gs1ProcesoC.prepararUnidosis.
 *   2. Resultado muestra etiqueta QR para impresión.
 *   3. Listado de unidosis recientes por paciente/indicación.
 *   4. Botón "Verificar" escanea código y llama gs1ProcesoC.verificarUnidosis.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { UnidosisLabel } from "./_components/unidosis-label";

// ─── Formulario preparación ───────────────────────────────────────────────────

function PrepararUnidosisForm() {
  const utils = trpc.useUtils();

  const [pacienteId, setPacienteId] = React.useState("");
  const [indicacionId, setIndicacionId] = React.useState("");
  const [gtinOrigenId, setGtinOrigenId] = React.useState("");
  const [loteOrigen, setLoteOrigen] = React.useState("");
  const [cantidadPreparada, setCantidadPreparada] = React.useState("1");
  const [expiryUnidosis, setExpiryUnidosis] = React.useState("");
  const [preparadoPor, setPrepadaPor] = React.useState("");

  const [lastResult, setLastResult] = React.useState<{
    codigoUnidosis: string;
    qrData: string;
  } | null>(null);

  const mutation = trpc.gs1ProcesoC.prepararUnidosis.useMutation({
    onSuccess: (data) => {
      setLastResult(data);
      // Invalida listado
      void utils.gs1ProcesoC.list.invalidate();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expiryUnidosis) return;
    mutation.mutate({
      pacienteId: pacienteId.trim(),
      indicacionId: indicacionId.trim(),
      gtinOrigenId: gtinOrigenId.trim(),
      loteOrigen: loteOrigen.trim(),
      cantidadPreparada: Number(cantidadPreparada),
      expiryUnidosis: new Date(expiryUnidosis).toISOString(),
      preparadoPor: preparadoPor.trim(),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Registrar preparación</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="ud-paciente">Paciente ID (UUID)</Label>
              <Input
                id="ud-paciente"
                required
                value={pacienteId}
                onChange={(e) => setPacienteId(e.target.value)}
                placeholder="uuid del paciente ECE"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ud-indicacion">Indicación ID (UUID)</Label>
              <Input
                id="ud-indicacion"
                required
                value={indicacionId}
                onChange={(e) => setIndicacionId(e.target.value)}
                placeholder="uuid de la indicación"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ud-gtin">GTIN origen ID (UUID)</Label>
              <Input
                id="ud-gtin"
                required
                value={gtinOrigenId}
                onChange={(e) => setGtinOrigenId(e.target.value)}
                placeholder="uuid en ece.gs1_gtin"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ud-lote">Lote origen</Label>
              <Input
                id="ud-lote"
                required
                value={loteOrigen}
                onChange={(e) => setLoteOrigen(e.target.value)}
                placeholder="Ej. LOT-2025-001"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ud-cantidad">Cantidad preparada</Label>
              <Input
                id="ud-cantidad"
                type="number"
                min={1}
                max={9999}
                required
                value={cantidadPreparada}
                onChange={(e) => setCantidadPreparada(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ud-expiry">Expiry (max 72 h)</Label>
              <Input
                id="ud-expiry"
                type="datetime-local"
                required
                value={expiryUnidosis}
                onChange={(e) => setExpiryUnidosis(e.target.value)}
              />
            </div>
            <div className="space-y-1 md:col-span-2 lg:col-span-3">
              <Label htmlFor="ud-preparado-por">Preparado por (UUID personal)</Label>
              <Input
                id="ud-preparado-por"
                required
                value={preparadoPor}
                onChange={(e) => setPrepadaPor(e.target.value)}
                placeholder="uuid en ece.personal_salud"
              />
            </div>
          </div>

          {mutation.error && (
            <p className="text-sm text-destructive" role="alert">
              {mutation.error.message}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Preparando…" : "Preparar unidosis"}
            </Button>
          </div>
        </form>

        {lastResult && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium text-green-700">
              Unidosis creada: {lastResult.codigoUnidosis}
            </p>
            <div className="flex flex-wrap gap-3 print:gap-4">
              <UnidosisLabel
                codigoUnidosis={lastResult.codigoUnidosis}
                qrData={lastResult.qrData}
                fechaPreparacion={new Date()}
                expiryUnidosis={new Date(expiryUnidosis)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="print:hidden"
            >
              Imprimir etiqueta
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Verificar unidosis ───────────────────────────────────────────────────────

function VerificarUnidosisForm() {
  const [codigo, setCodigo] = React.useState("");

  const mutation = trpc.gs1ProcesoC.verificarUnidosis.useMutation();

  function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate({ codigoUnidosis: codigo.trim() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verificar al dispensar</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleVerify} className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="ud-verificar">Código unidosis (UD-N)</Label>
            <Input
              id="ud-verificar"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej. UD-1"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={mutation.isPending || !codigo.trim()}>
            {mutation.isPending ? "Verificando…" : "Verificar"}
          </Button>
        </form>

        {mutation.error && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {mutation.error.message}
          </p>
        )}

        {mutation.data && (
          <div className="mt-3 rounded border border-green-300 bg-green-50 p-3 text-sm" role="status">
            <p className="font-medium text-green-800">Unidosis verificada</p>
            <p className="text-green-700">
              Código: <span className="font-mono">{mutation.data.codigo_unidosis}</span>
            </p>
            <p className="text-green-700">
              Expiry: {new Date(mutation.data.expiry_unidosis).toLocaleString("es-SV")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Listado ──────────────────────────────────────────────────────────────────

function UnidosisList() {
  const [filterPaciente, setFilterPaciente] = React.useState("");

  const list = trpc.gs1ProcesoC.list.useQuery({
    pacienteId: filterPaciente.trim() || undefined,
    limit: 20,
  });

  const items = list.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unidosis preparadas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 max-w-sm space-y-1">
          <Label htmlFor="filter-paciente-list">Filtrar por Paciente ID</Label>
          <Input
            id="filter-paciente-list"
            value={filterPaciente}
            onChange={(e) => setFilterPaciente(e.target.value)}
            placeholder="uuid (opcional)"
          />
        </div>

        {list.isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin unidosis con estos filtros.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Lote origen</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead>Preparación</TableHead>
                <TableHead>Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-sm font-medium">
                    {row.codigo_unidosis}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.lote_origen}</TableCell>
                  <TableCell className="tabular-nums">{row.cantidad_preparada}</TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {new Date(row.fecha_preparacion).toLocaleString("es-SV")}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-red-700">
                    {new Date(row.expiry_unidosis).toLocaleString("es-SV")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {list.data?.nextCursor && (
          <p className="mt-2 text-xs text-muted-foreground">
            Hay más resultados. Usa filtros para acotar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UnidosisPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Farmacia · Unidosis</h1>
        <p className="text-sm text-muted-foreground">
          Proceso C GS1 — Re-empaque de medicamentos por paciente con trazabilidad QR (TDR §15).
        </p>
      </div>
      <PrepararUnidosisForm />
      <VerificarUnidosisForm />
      <UnidosisList />
    </div>
  );
}

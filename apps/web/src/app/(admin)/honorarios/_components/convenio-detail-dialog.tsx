"use client";

/**
 * Detalle de convenio de honorarios — CC-0036 Ola 5 (REQ-HIS-AFIL-001
 * US.AFIL.1.5). Alta de reglas + activar (exige >=1 regla activa, AC1).
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@his/ui/components/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const AMBITOS = ["CIRUGIA", "CONSULTA", "PROCEDIMIENTO", "INTERPRETACION", "VISITA_HOSPITALARIA", "INSUMO"] as const;
const ROLES = ["TRATANTE", "CIRUJANO", "AYUDANTE", "ANESTESISTA", "INTERPRETE", "REFERENTE"] as const;

const ESTADO_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  BORRADOR: "outline",
  VIGENTE: "success",
  TERMINADO: "destructive",
};

type Props = {
  convenioId: string | null;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onChanged: () => void;
};

export function ConvenioDetailDialog({ convenioId, onOpenChange, canManage, onChanged }: Props) {
  const open = convenioId !== null;
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [ambito, setAmbito] = React.useState<(typeof AMBITOS)[number]>("CONSULTA");
  const [rolMedico, setRolMedico] = React.useState<string>("__cualquiera__");
  const [tipoCalculo, setTipoCalculo] = React.useState<"PORCENTAJE" | "MONTO_FIJO">("PORCENTAJE");
  const [porcentaje, setPorcentaje] = React.useState("");
  const [montoFijo, setMontoFijo] = React.useState("");
  const [montoMinimo, setMontoMinimo] = React.useState("");
  const [montoMaximo, setMontoMaximo] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setErrorMsg(null);
      setAmbito("CONSULTA");
      setRolMedico("__cualquiera__");
      setTipoCalculo("PORCENTAJE");
      setPorcentaje("");
      setMontoFijo("");
      setMontoMinimo("");
      setMontoMaximo("");
    }
  }, [open]);

  const query = trpcAny.honorario.convenio.get.useQuery({ id: convenioId }, { enabled: open });
  const convenio = query.data as
    | {
        id: string;
        estado: string;
        retencionRentaPct: string | number;
        periodicidadLiquidacion: string;
        medicoAfiliado: { nombreCompleto: string };
        reglas: Array<{
          id: string;
          ambito: string;
          rolMedico: string | null;
          tipoCalculo: string;
          porcentaje: string | number | null;
          montoFijo: string | number | null;
          active: boolean;
        }>;
      }
    | undefined;

  function refetchAll() {
    query.refetch();
    onChanged();
  }

  const activarMutation = trpcAny.honorario.convenio.activar.useMutation({
    onSuccess: refetchAll,
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const reglaMutation = trpcAny.honorario.regla.create.useMutation({
    onSuccess: () => {
      setPorcentaje("");
      setMontoFijo("");
      setMontoMinimo("");
      setMontoMaximo("");
      refetchAll();
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  function handleAddRegla() {
    if (!convenio) return;
    setErrorMsg(null);
    reglaMutation.mutate({
      convenioId: convenio.id,
      ambito,
      rolMedico: rolMedico === "__cualquiera__" ? undefined : rolMedico,
      tipoCalculo,
      porcentaje: tipoCalculo === "PORCENTAJE" ? Number(porcentaje) / 100 : undefined,
      montoFijo: tipoCalculo === "MONTO_FIJO" ? Number(montoFijo) : undefined,
      montoMinimo: montoMinimo === "" ? undefined : Number(montoMinimo),
      montoMaximo: montoMaximo === "" ? undefined : Number(montoMaximo),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Convenio de honorarios{convenio ? ` — ${convenio.medicoAfiliado.nombreCompleto}` : ""}</DialogTitle>
          <DialogDescription>
            Especificidad de reglas: código de servicio &gt; categoría &gt; ámbito (patrón CC-0021).
          </DialogDescription>
        </DialogHeader>

        {query.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}

        {convenio ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant={ESTADO_BADGE[convenio.estado] ?? "outline"}>{convenio.estado}</Badge>
              <span className="text-sm text-muted-foreground">
                Retención renta: {(Number(convenio.retencionRentaPct) * 100).toFixed(2)}% ·{" "}
                {convenio.periodicidadLiquidacion}
              </span>
              {canManage && convenio.estado === "BORRADOR" ? (
                <Button
                  size="sm"
                  onClick={() => activarMutation.mutate({ id: convenio.id })}
                  disabled={activarMutation.isPending}
                >
                  {activarMutation.isPending ? "Activando…" : "Activar convenio"}
                </Button>
              ) : null}
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ámbito</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Cálculo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="w-20">Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {convenio.reglas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                        Sin reglas — el convenio no puede activarse todavía.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {convenio.reglas.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.ambito}</TableCell>
                      <TableCell>{r.rolMedico ?? "cualquiera"}</TableCell>
                      <TableCell>{r.tipoCalculo}</TableCell>
                      <TableCell className="text-right">
                        {r.tipoCalculo === "PORCENTAJE"
                          ? `${(Number(r.porcentaje ?? 0) * 100).toFixed(2)}%`
                          : `$${Number(r.montoFijo ?? 0).toFixed(2)}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.active ? "success" : "outline"}>{r.active ? "activa" : "inactiva"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {canManage ? (
              <div className="space-y-2 rounded-md border p-3">
                <Label>Agregar regla</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Select value={ambito} onValueChange={(v) => setAmbito(v as (typeof AMBITOS)[number])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AMBITOS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={rolMedico} onValueChange={setRolMedico}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__cualquiera__">Cualquier rol</SelectItem>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={tipoCalculo} onValueChange={(v) => setTipoCalculo(v as "PORCENTAJE" | "MONTO_FIJO")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PORCENTAJE">Porcentaje</SelectItem>
                      <SelectItem value="MONTO_FIJO">Monto fijo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {tipoCalculo === "PORCENTAJE" ? (
                    <Input
                      type="number"
                      placeholder="% (ej. 40)"
                      value={porcentaje}
                      onChange={(e) => setPorcentaje(e.target.value)}
                    />
                  ) : (
                    <Input
                      type="number"
                      placeholder="Monto fijo"
                      value={montoFijo}
                      onChange={(e) => setMontoFijo(e.target.value)}
                    />
                  )}
                  <Input
                    type="number"
                    placeholder="Mínimo (opcional)"
                    value={montoMinimo}
                    onChange={(e) => setMontoMinimo(e.target.value)}
                  />
                  <Input
                    type="number"
                    placeholder="Máximo (opcional)"
                    value={montoMaximo}
                    onChange={(e) => setMontoMaximo(e.target.value)}
                  />
                </div>
                <Button size="sm" onClick={handleAddRegla} disabled={reglaMutation.isPending}>
                  {reglaMutation.isPending ? "Agregando…" : "+ Agregar regla"}
                </Button>
              </div>
            ) : null}

            {errorMsg && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

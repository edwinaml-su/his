"use client";

/**
 * CC-0042 — Panel de configuración del módulo de terapia respiratoria
 * (pedido explícito Edwin 2026-09-18; aditivo al mockup — precedente
 * Parametrización de imágenes CC-0016). Solo ADMIN/DIR (gate del shell +
 * server). 3 pestañas:
 *   · Procedimientos — tarifa base (fallback del price-resolver), tiempo
 *     estándar, consentimiento, delegable por protocolo, activo. Editar una
 *     fila GLOBAL materializa el override del tenant (server-side).
 *   · Medicamentos — dosis min/máx/default, alto riesgo (IPSG.3),
 *     precaución, mensaje clínico, activo.
 *   · SLA — minutos por prioridad para las tareas del área (TrSlaConfig).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Checkbox } from "@his/ui/components/checkbox";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Toast, ToastTitle, ToastDescription } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type CatalogoTr = RouterOutput["respiratory"]["tr"]["catalogo"]["list"];
type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

const PRIORITY_LABEL: Record<string, string> = {
  STAT: "STAT (inmediata)",
  URGENT: "Urgente",
  ROUTINE: "Rutina",
};

export function ParametrizacionTr(): React.ReactElement {
  const utils = trpc.useUtils();
  const catalogoQ = trpc.respiratory.tr.catalogo.list.useQuery();
  const [toast, setToast] = React.useState<ToastState>(null);

  const invalidar = () => utils.respiratory.tr.catalogo.list.invalidate();

  const updateProc = trpc.respiratory.tr.catalogo.updateProcedimiento.useMutation({
    onSuccess: () => {
      invalidar();
      setToast({ title: "Procedimiento actualizado", variant: "success" });
    },
    onError: (e) => setToast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });
  const updateMed = trpc.respiratory.tr.catalogo.updateMedicamento.useMutation({
    onSuccess: () => {
      invalidar();
      setToast({ title: "Medicamento actualizado", variant: "success" });
    },
    onError: (e) => setToast({ title: "No se pudo guardar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="text-base">Configuración del módulo — Terapia Respiratoria</CardTitle>
        <p className="text-xs text-muted-foreground">
          Los cambios se reflejan de inmediato en la orden CPOE-TR, en el worklist y en el precio devengado
          (la tarifa base es el fallback: las listas de precios por tipo de cuenta la overridean por código).
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="proc">
          <TabsList aria-label="Configuración de terapia respiratoria">
            <TabsTrigger value="proc" data-testid="tr-cfg-tab-proc">
              Procedimientos
            </TabsTrigger>
            <TabsTrigger value="med" data-testid="tr-cfg-tab-med">
              Medicamentos
            </TabsTrigger>
            <TabsTrigger value="sla" data-testid="tr-cfg-tab-sla">
              SLA
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proc">
            {catalogoQ.data ? (
              <ProcedimientosTab
                procedimientos={catalogoQ.data.procedimientos}
                pending={updateProc.isPending}
                onSave={(patch) => updateProc.mutate(patch)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            )}
          </TabsContent>

          <TabsContent value="med">
            {catalogoQ.data ? (
              <MedicamentosTab
                medicamentos={catalogoQ.data.medicamentos}
                pending={updateMed.isPending}
                onSave={(patch) => updateMed.mutate(patch)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            )}
          </TabsContent>

          <TabsContent value="sla">
            <SlaTrTab />
          </TabsContent>
        </Tabs>
      </CardContent>

      {toast ? (
        <Toast variant={toast.variant ?? "default"} open onOpenChange={(o) => !o && setToast(null)}>
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </Card>
  );
}

function ProcedimientosTab({
  procedimientos,
  pending,
  onSave,
}: {
  procedimientos: CatalogoTr["procedimientos"];
  pending: boolean;
  onSave: (patch: {
    id: string;
    tarifaBase?: number | null;
    tiempoEstandarMin?: number | null;
    requiereConsentimiento?: boolean;
    delegablePorProtocolo?: boolean;
    activo?: boolean;
  }) => void;
}) {
  const [filtro, setFiltro] = React.useState("");
  const [tarifas, setTarifas] = React.useState<Record<string, string>>({});
  const [tiempos, setTiempos] = React.useState<Record<string, string>>({});

  const visibles = procedimientos.filter(
    (p) =>
      !filtro.trim() ||
      p.codigo.toLowerCase().includes(filtro.toLowerCase()) ||
      p.nombre.toLowerCase().includes(filtro.toLowerCase()) ||
      p.categoria.toLowerCase().includes(filtro.toLowerCase()),
  );

  return (
    <div className="space-y-3">
      <Input
        className="max-w-xs"
        placeholder="Filtrar por código, nombre o categoría…"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
      />
      <div className="overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Procedimiento</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead>Tarifa base (US$)</TableHead>
              <TableHead>Tiempo (min)</TableHead>
              <TableHead>Consent.</TableHead>
              <TableHead>Delegable</TableHead>
              <TableHead>Activo</TableHead>
              <TableHead aria-label="Acciones" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibles.map((p) => {
              const tarifa = tarifas[p.id] ?? (p.tarifaBase != null ? String(p.tarifaBase) : "");
              const tiempo = tiempos[p.id] ?? (p.tiempoEstandarMin != null ? String(p.tiempoEstandarMin) : "");
              return (
                <TableRow key={p.id} data-testid={`tr-cfg-proc-${p.codigo}`}>
                  <TableCell className="font-mono text-xs">
                    {p.codigo}
                    {p.esOverrideTenant ? (
                      <Badge variant="outline" className="ml-1 text-[9px]">
                        tenant
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[280px]">{p.nombre}</TableCell>
                  <TableCell>{p.categoria}</TableCell>
                  <TableCell>{p.unidadCobro}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-24"
                      aria-label={`Tarifa base de ${p.codigo}`}
                      value={tarifa}
                      placeholder="—"
                      onChange={(e) => setTarifas((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      className="w-20"
                      aria-label={`Tiempo estándar de ${p.codigo}`}
                      value={tiempo}
                      placeholder="—"
                      onChange={(e) => setTiempos((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={p.requiereConsentimiento}
                      aria-label={`Consentimiento de ${p.codigo}`}
                      onCheckedChange={(c) => onSave({ id: p.id, requiereConsentimiento: Boolean(c) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={p.delegablePorProtocolo}
                      aria-label={`Delegable de ${p.codigo}`}
                      onCheckedChange={(c) => onSave({ id: p.id, delegablePorProtocolo: Boolean(c) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      checked={p.activo}
                      aria-label={`Activo de ${p.codigo}`}
                      onCheckedChange={(c) => onSave({ id: p.id, activo: Boolean(c) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      data-testid={`tr-cfg-save-${p.codigo}`}
                      onClick={() => {
                        const t = tarifa.trim() === "" ? null : Number(tarifa);
                        const min = tiempo.trim() === "" ? null : Number.parseInt(tiempo, 10);
                        onSave({ id: p.id, tarifaBase: t, tiempoEstandarMin: min });
                      }}
                    >
                      Guardar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MedicamentosTab({
  medicamentos,
  pending,
  onSave,
}: {
  medicamentos: CatalogoTr["medicamentos"];
  pending: boolean;
  onSave: (patch: {
    id: string;
    dosisMin?: number;
    dosisMax?: number;
    dosisDefault?: number;
    altoRiesgo?: boolean;
    activo?: boolean;
  }) => void;
}) {
  const [dosis, setDosis] = React.useState<Record<string, { min: string; max: string; def: string }>>({});

  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Principio activo</TableHead>
            <TableHead>Unidad</TableHead>
            <TableHead>Dosis mín.</TableHead>
            <TableHead>Dosis máx.</TableHead>
            <TableHead>Default</TableHead>
            <TableHead>Alto riesgo</TableHead>
            <TableHead>Activo</TableHead>
            <TableHead aria-label="Acciones" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {medicamentos.map((m) => {
            const d = dosis[m.id] ?? { min: String(m.dosisMin), max: String(m.dosisMax), def: String(m.dosisDefault) };
            const setD = (patch: Partial<typeof d>) => setDosis((prev) => ({ ...prev, [m.id]: { ...d, ...patch } }));
            return (
              <TableRow key={m.id} data-testid={`tr-cfg-med-${m.clave}`}>
                <TableCell className="max-w-[320px]">
                  {m.nombre}
                  {m.esOverrideTenant ? (
                    <Badge variant="outline" className="ml-1 text-[9px]">
                      tenant
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{m.unidadBase}</TableCell>
                <TableCell>
                  <Input className="w-20" aria-label={`Dosis mínima de ${m.clave}`} value={d.min} onChange={(e) => setD({ min: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Input className="w-20" aria-label={`Dosis máxima de ${m.clave}`} value={d.max} onChange={(e) => setD({ max: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Input className="w-20" aria-label={`Dosis default de ${m.clave}`} value={d.def} onChange={(e) => setD({ def: e.target.value })} />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={m.altoRiesgo}
                    aria-label={`Alto riesgo de ${m.clave}`}
                    onCheckedChange={(c) => onSave({ id: m.id, altoRiesgo: Boolean(c) })}
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={m.activo}
                    aria-label={`Activo de ${m.clave}`}
                    onCheckedChange={(c) => onSave({ id: m.id, activo: Boolean(c) })}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    data-testid={`tr-cfg-med-save-${m.clave}`}
                    onClick={() =>
                      onSave({
                        id: m.id,
                        dosisMin: Number(d.min),
                        dosisMax: Number(d.max),
                        dosisDefault: Number(d.def),
                      })
                    }
                  >
                    Guardar
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SlaTrTab(): React.ReactElement {
  const utils = trpc.useUtils();
  const list = trpc.respiratory.tr.sla.list.useQuery();
  const [drafts, setDrafts] = React.useState<Record<string, { slaMinutes: string; warningMinutes: string }>>({});
  const [msg, setMsg] = React.useState<string | null>(null);

  const upsert = trpc.respiratory.tr.sla.upsert.useMutation({
    onSuccess: (row) => {
      utils.respiratory.tr.sla.list.invalidate();
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.priority];
        return next;
      });
      setMsg(`SLA de ${PRIORITY_LABEL[row.priority] ?? row.priority} guardado.`);
    },
  });

  if (list.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {list.error.message}
      </p>
    );
  if (!list.data) return <p className="text-sm text-muted-foreground">Cargando SLA…</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Minutos desde la firma de la orden hasta el vencimiento de cada sesión, por prioridad (RN-TR-21:
        STAT 15 minutos). El aviso marca la sesión como «por vencer» en el worklist esa cantidad de minutos antes.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Prioridad</TableHead>
            <TableHead>SLA (minutos)</TableHead>
            <TableHead>Aviso (minutos antes)</TableHead>
            <TableHead>Origen</TableHead>
            <TableHead aria-label="Acciones" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data.map((row) => {
            const d = drafts[row.priority] ?? {
              slaMinutes: String(row.slaMinutes),
              warningMinutes: String(row.warningMinutes),
            };
            return (
              <TableRow key={row.priority} data-testid={`tr-sla-row-${row.priority}`}>
                <TableCell className="font-medium">{PRIORITY_LABEL[row.priority] ?? row.priority}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    max={10080}
                    className="w-28"
                    aria-label={`SLA en minutos para ${PRIORITY_LABEL[row.priority] ?? row.priority}`}
                    value={d.slaMinutes}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [row.priority]: { ...d, slaMinutes: e.target.value } }))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    max={10080}
                    className="w-28"
                    aria-label={`Minutos de aviso para ${PRIORITY_LABEL[row.priority] ?? row.priority}`}
                    value={d.warningMinutes}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [row.priority]: { ...d, warningMinutes: e.target.value } }))
                    }
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.esDefault ? "Default del sistema" : "Parametrizado"}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    disabled={upsert.isPending}
                    data-testid={`tr-sla-save-${row.priority}`}
                    onClick={() => {
                      const slaMinutes = Number.parseInt(d.slaMinutes, 10);
                      const warningMinutes = Number.parseInt(d.warningMinutes, 10);
                      if (Number.isNaN(slaMinutes) || slaMinutes < 1 || Number.isNaN(warningMinutes) || warningMinutes < 0) {
                        setMsg("SLA debe ser un entero ≥ 1 y el aviso un entero ≥ 0 (minutos).");
                        return;
                      }
                      setMsg(null);
                      upsert.mutate({
                        priority: row.priority as "ROUTINE" | "URGENT" | "STAT",
                        slaMinutes,
                        warningMinutes,
                      });
                    }}
                  >
                    Guardar
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {upsert.error ? (
        <p role="alert" className="text-sm text-destructive">
          {upsert.error.message}
        </p>
      ) : null}
      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
    </div>
  );
}

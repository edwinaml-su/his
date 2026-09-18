"use client";

/**
 * CC-0041 — Parametrización › «⏱ SLA»: minutos de SLA y de aviso ("por
 * vencer") por prioridad para las tareas de imagenología. Persiste en
 * `ImagingSlaConfig` (sql/253) vía `imagingRequest.sla.upsert`; sin fila del
 * tenant rige el default de código (se indica en la fila). Consumido por la
 * creación de tareas de `imagingRequest.crear` / order-consumer y por el
 * tablero de Supervisión. Espejo de la pestaña SLA de laboratorio (CC-0040).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

const PRIORITY_LABEL: Record<string, string> = {
  STAT: "STAT (emergencia)",
  URGENT: "Urgente",
  ROUTINE: "Rutina",
};

type Draft = { slaMinutes: string; warningMinutes: string };

export function SlaImagenes(): React.ReactElement {
  const utils = trpc.useUtils();
  const list = trpc.imagingRequest.sla.list.useQuery();
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [savedMsg, setSavedMsg] = React.useState<string | null>(null);
  const [invalidMsg, setInvalidMsg] = React.useState<string | null>(null);

  const upsert = trpc.imagingRequest.sla.upsert.useMutation({
    onSuccess: (row) => {
      utils.imagingRequest.sla.list.invalidate();
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.priority];
        return next;
      });
      setSavedMsg(`SLA de ${PRIORITY_LABEL[row.priority] ?? row.priority} guardado.`);
    },
  });

  const draftOf = (priority: string, base: { slaMinutes: number; warningMinutes: number }): Draft =>
    drafts[priority] ?? {
      slaMinutes: String(base.slaMinutes),
      warningMinutes: String(base.warningMinutes),
    };

  const setDraft = (priority: string, patch: Partial<Draft>, base: { slaMinutes: number; warningMinutes: number }) =>
    setDrafts((prev) => ({ ...prev, [priority]: { ...draftOf(priority, base), ...prev[priority], ...patch } }));

  const guardar = (priority: string, base: { slaMinutes: number; warningMinutes: number }) => {
    const d = draftOf(priority, base);
    const slaMinutes = Number.parseInt(d.slaMinutes, 10);
    const warningMinutes = Number.parseInt(d.warningMinutes, 10);
    setSavedMsg(null);
    if (Number.isNaN(slaMinutes) || slaMinutes < 1 || Number.isNaN(warningMinutes) || warningMinutes < 0) {
      setInvalidMsg("SLA debe ser un entero ≥ 1 y el aviso un entero ≥ 0 (minutos).");
      return;
    }
    setInvalidMsg(null);
    upsert.mutate({ priority: priority as "ROUTINE" | "URGENT" | "STAT", slaMinutes, warningMinutes });
  };

  if (list.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {list.error.message}
      </p>
    );
  }
  if (!list.data) return <p className="text-sm text-muted-foreground">Cargando SLA…</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Minutos desde la solicitud del estudio hasta el vencimiento del SLA, por prioridad. El SLA define el
        vencimiento de la tarea del área (y sus alertas del watchdog); el aviso marca el estudio como
        &quot;por vencer&quot; en el tablero de Supervisión esa cantidad de minutos antes.
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
            const d = draftOf(row.priority, row);
            return (
              <TableRow key={row.priority} data-testid={`img-sla-row-${row.priority}`}>
                <TableCell className="font-medium">{PRIORITY_LABEL[row.priority] ?? row.priority}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={1}
                    max={10080}
                    className="w-28"
                    aria-label={`SLA en minutos para ${PRIORITY_LABEL[row.priority] ?? row.priority}`}
                    value={d.slaMinutes}
                    onChange={(e) => setDraft(row.priority, { slaMinutes: e.target.value }, row)}
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
                    onChange={(e) => setDraft(row.priority, { warningMinutes: e.target.value }, row)}
                  />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.esDefault ? "Default del sistema" : "Parametrizado"}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    disabled={upsert.isPending}
                    onClick={() => guardar(row.priority, row)}
                    data-testid={`img-sla-save-${row.priority}`}
                  >
                    Guardar
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {invalidMsg ? (
        <p role="alert" className="text-sm text-destructive">
          {invalidMsg}
        </p>
      ) : null}
      {upsert.error ? (
        <p role="alert" className="text-sm text-destructive">
          {upsert.error.message}
        </p>
      ) : null}
      {savedMsg ? <p className="text-sm text-emerald-700">{savedMsg}</p> : null}
    </div>
  );
}

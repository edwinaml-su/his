"use client";

/**
 * CC-0026 D3 — Tablero de seguimiento de una unidad de servicio (o de
 * enfermería, rol transversal). Sin mockup propio: sigue el design system
 * existente, mismo estilo que `/triage/dashboard` (auto-refresh 15s, cards
 * de resumen, sin paleta inventada).
 *
 * `[unidad]` acepta el `id` de una `ServiceUnit` o el literal `enfermeria`
 * (tablero por rol NURSE, transversal — REQ-CC-0026 D3).
 *
 * E2E a automatizar por @QA: iniciar/completar/cancelar una CareTask desde
 * el tablero y verificar que se mueve de columna (usa `careTask.iniciar` /
 * `.completar` / `.cancelar`, ya cubiertos por unit tests de router).
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge, type BadgeProps } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { EmptyState } from "@his/ui/components/states";
import { trpc } from "@/lib/trpc/react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";
import { dueLabel } from "../_lib/due-label";

const AREA_TYPE_LABEL: Record<string, string> = {
  QUIROFANO: "Quirófano",
  LABORATORIO: "Laboratorio",
  IMAGENES: "Imágenes",
  EMERGENCIA: "Emergencia",
  UCI: "UCI",
  UCIN: "UCI Neonatal",
  MAX_URGENCIA: "Máxima Urgencia",
  SALA_ESPERA: "Sala de Espera",
  HOSPITALIZACION: "Hospitalización",
  CONSULTA: "Consulta Externa",
  FARMACIA: "Farmacia",
  PARTOS: "Partos",
  OTRA: "Otra",
};

const PRIORITY_LABEL: Record<string, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  NORMAL: "Normal",
  LOW: "Baja",
};

const PRIORITY_BADGE_VARIANT: Record<string, BadgeProps["variant"]> = {
  CRITICAL: "critical",
  HIGH: "warning",
  NORMAL: "secondary",
  LOW: "outline",
};

type RouterOutputs = inferRouterOutputs<AppRouter>;
type BoardTask = RouterOutputs["careBoard"]["board"]["items"][number];

export default function TableroUnidadPage(): React.ReactElement {
  const params = useParams<{ unidad: string }>();
  const unidad = params?.unidad ?? "";
  const isEnfermeria = unidad === "enfermeria";

  const areasQuery = trpc.careBoard.areas.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const areaMeta = isEnfermeria
    ? areasQuery.data?.enfermeria
    : areasQuery.data?.areas.find((a) => a.id === unidad);

  const boardInput = isEnfermeria
    ? ({ rol: "NURSE" as const, page: 1, pageSize: 100 })
    : ({ serviceUnitId: unidad, page: 1, pageSize: 100 });

  const boardQuery = trpc.careBoard.board.useQuery(boardInput, {
    enabled: Boolean(unidad),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const utils = trpc.useUtils();
  const invalidateBoard = React.useCallback(() => {
    void utils.careBoard.board.invalidate();
    void utils.careBoard.areas.invalidate();
  }, [utils]);

  const iniciar = trpc.careTask.iniciar.useMutation({ onSuccess: invalidateBoard });
  const completar = trpc.careTask.completar.useMutation({ onSuccess: invalidateBoard });

  const [cancelTask, setCancelTask] = React.useState<{ id: string; title: string } | null>(null);
  const [cancelReason, setCancelReason] = React.useState("");
  const cancelar = trpc.careTask.cancelar.useMutation({
    onSuccess: () => {
      setCancelTask(null);
      setCancelReason("");
      invalidateBoard();
    },
  });

  function closeCancelDialog(): void {
    setCancelTask(null);
    setCancelReason("");
  }

  const items = boardQuery.data?.items ?? [];
  const pendientes = items.filter((t) => t.status === "PENDIENTE");
  const enProceso = items.filter((t) => t.status === "EN_PROCESO");
  const cumplidas = items.filter((t) => t.status === "CUMPLIDA");

  const title = areaMeta?.name ?? (isEnfermeria ? "Enfermería" : "Tablero");
  const areaLabel = areaMeta?.areaType ? AREA_TYPE_LABEL[areaMeta.areaType] ?? areaMeta.areaType : null;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/tableros"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Tableros
        </Link>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {areaLabel ? `${areaLabel} · ` : ""}
          {items.length} tarea{items.length === 1 ? "" : "s"} activa{items.length === 1 ? "" : "s"}
          {boardQuery.isFetching && " · actualizando…"}
        </p>
      </div>

      {boardQuery.error ? (
        <p role="alert" className="text-sm text-destructive">
          Error cargando tablero: {boardQuery.error.message}
        </p>
      ) : null}
      {boardQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando tablero…</p>
      ) : null}

      {boardQuery.data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <BoardColumn
            title="Pendiente"
            tasks={pendientes}
            onIniciar={(id) => iniciar.mutate({ id })}
            onCompletar={(id) => completar.mutate({ id })}
            onCancelar={setCancelTask}
            busy={iniciar.isPending || completar.isPending || cancelar.isPending}
          />
          <BoardColumn
            title="En proceso"
            tasks={enProceso}
            onCompletar={(id) => completar.mutate({ id })}
            onCancelar={setCancelTask}
            busy={completar.isPending || cancelar.isPending}
          />
          <BoardColumn title="Cumplida hoy" tasks={cumplidas} />
        </div>
      ) : null}

      <Dialog
        open={Boolean(cancelTask)}
        onOpenChange={(open) => {
          if (!open) closeCancelDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar tarea</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {cancelTask ? <p className="text-sm text-muted-foreground">{cancelTask.title}</p> : null}
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">Motivo (mínimo 5 caracteres)</Label>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                maxLength={300}
                autoFocus
              />
            </div>
            {cancelar.error ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {cancelar.error.message}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeCancelDialog}>
              Volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={cancelReason.trim().length < 5 || cancelar.isPending}
              onClick={() =>
                cancelTask &&
                cancelar.mutate({ id: cancelTask.id, cancelReason: cancelReason.trim() })
              }
            >
              {cancelar.isPending ? "Cancelando…" : "Confirmar cancelación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface BoardColumnProps {
  title: string;
  tasks: BoardTask[];
  onIniciar?: (id: string) => void;
  onCompletar?: (id: string) => void;
  onCancelar?: (task: { id: string; title: string }) => void;
  busy?: boolean;
}

function BoardColumn({
  title,
  tasks,
  onIniciar,
  onCompletar,
  onCancelar,
  busy,
}: BoardColumnProps): React.ReactElement {
  const headingId = `board-col-${title.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <Badge variant="secondary">{tasks.length}</Badge>
      </h2>

      {tasks.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Sin tareas"
          description={`No hay tareas en "${title}".`}
          className="rounded-lg border py-8"
        />
      ) : (
        <ul role="list" aria-label={`Tareas ${title}`} className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onIniciar={onIniciar}
              onCompletar={onCompletar}
              onCancelar={onCancelar}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface TaskCardProps {
  task: BoardTask;
  onIniciar?: (id: string) => void;
  onCompletar?: (id: string) => void;
  onCancelar?: (task: { id: string; title: string }) => void;
  busy?: boolean;
}

function TaskCard({ task, onIniciar, onCompletar, onCancelar, busy }: TaskCardProps): React.ReactElement {
  const patientName = task.patient ? `${task.patient.firstName} ${task.patient.lastName}`.trim() : null;
  const due = dueLabel(task);

  return (
    <li>
      <Card>
        <CardHeader className="space-y-1.5 pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm">{task.title}</CardTitle>
            <Badge variant={PRIORITY_BADGE_VARIANT[task.priority] ?? "secondary"}>
              {PRIORITY_LABEL[task.priority] ?? task.priority}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {patientName ? (
              <>
                {patientName} <span className="font-mono">{task.patient?.mrn}</span>
              </>
            ) : (
              "Sin paciente asociado"
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-2 pb-4 pt-0">
          <p className="text-xs text-muted-foreground">{task.taskType}</p>
          {due ? (
            <p
              className={due.overdue ? "text-xs font-semibold text-destructive" : "text-xs text-muted-foreground"}
              role={due.overdue ? "alert" : undefined}
            >
              {due.text}
            </p>
          ) : null}
          {(onIniciar || onCompletar || onCancelar) && task.status !== "CUMPLIDA" ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {onIniciar && task.status === "PENDIENTE" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  aria-label={`Iniciar tarea ${task.title}`}
                  onClick={() => onIniciar(task.id)}
                >
                  Iniciar
                </Button>
              ) : null}
              {onCompletar ? (
                <Button
                  size="sm"
                  disabled={busy}
                  aria-label={`Completar tarea ${task.title}`}
                  onClick={() => onCompletar(task.id)}
                >
                  Completar
                </Button>
              ) : null}
              {onCancelar ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Cancelar tarea ${task.title}`}
                  onClick={() => onCancelar({ id: task.id, title: task.title })}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </li>
  );
}

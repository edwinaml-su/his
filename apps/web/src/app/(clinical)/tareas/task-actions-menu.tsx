"use client";

/**
 * Ola 4 — Menú de acciones por tarea: Reasignar / Escalar / Completar / Comentar.
 * Registra cada acción en WorkflowTaskAction para auditoría y vista del equipo.
 */
import * as React from "react";
import { MoreVertical, Loader2, UserPlus, AlertTriangle, CheckCircle2, MessageSquare } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

type ActionKind = "REASSIGN" | "ESCALATE" | "COMPLETE" | "COMMENT";

interface Props {
  taskId: string;
  taskType: string;
  onActionDone?: () => void;
}

const ACTION_META: Record<
  ActionKind,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string; requiresTarget: boolean }
> = {
  REASSIGN: { label: "Reasignar a otro usuario", icon: UserPlus, color: "text-blue-600", requiresTarget: true },
  ESCALATE: { label: "Escalar al supervisor", icon: AlertTriangle, color: "text-orange-600", requiresTarget: false },
  COMPLETE: { label: "Marcar completada (override)", icon: CheckCircle2, color: "text-emerald-600", requiresTarget: false },
  COMMENT:  { label: "Agregar comentario", icon: MessageSquare, color: "text-slate-600", requiresTarget: false },
};

export function TaskActionsMenu({ taskId, taskType, onActionDone }: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [action, setAction] = React.useState<ActionKind | null>(null);
  const [targetUserId, setTargetUserId] = React.useState("");
  const [reason, setReason] = React.useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const reasignarMut = trpcAny.workflowInbox.reasignar.useMutation();
  const escalarMut = trpcAny.workflowInbox.escalar.useMutation();
  const completarMut = trpcAny.workflowInbox.completar.useMutation();
  const comentarMut = trpcAny.workflowInbox.comentar.useMutation();

  function pending(): boolean {
    return reasignarMut.isPending || escalarMut.isPending || completarMut.isPending || comentarMut.isPending;
  }
  function error(): string | null {
    return (
      (reasignarMut.error as { message?: string })?.message ??
      (escalarMut.error as { message?: string })?.message ??
      (completarMut.error as { message?: string })?.message ??
      (comentarMut.error as { message?: string })?.message ??
      null
    );
  }

  function reset() {
    setAction(null);
    setTargetUserId("");
    setReason("");
  }

  async function submit() {
    if (!action || reason.trim().length < 3) return;
    try {
      if (action === "REASSIGN") {
        if (targetUserId.length !== 36) return;
        await reasignarMut.mutateAsync({ taskId, taskType, targetUserId, reason });
      } else if (action === "ESCALATE") {
        await escalarMut.mutateAsync({
          taskId, taskType, reason,
          targetUserId: targetUserId.length === 36 ? targetUserId : undefined,
        });
      } else if (action === "COMPLETE") {
        await completarMut.mutateAsync({ taskId, taskType, reason });
      } else if (action === "COMMENT") {
        await comentarMut.mutateAsync({ taskId, taskType, reason });
      }
      reset();
      setMenuOpen(false);
      onActionDone?.();
    } catch {
      // El error ya está en *.error — UI lo muestra
    }
  }

  const meta = action ? ACTION_META[action] : null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen(true); }}
        aria-label="Acciones de tarea"
      >
        <MoreVertical className="h-4 w-4" />
      </Button>

      <Dialog open={menuOpen} onOpenChange={(open) => { if (!open) reset(); setMenuOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Acciones de tarea</DialogTitle>
            <DialogDescription className="font-mono text-xs">{taskId}</DialogDescription>
          </DialogHeader>

          {!action && (
            <div className="space-y-2">
              {(Object.keys(ACTION_META) as ActionKind[]).map((k) => {
                const m = ACTION_META[k];
                const Icon = m.icon;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setAction(k)}
                    className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <Icon className={`h-5 w-5 ${m.color}`} />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {action && meta && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <meta.icon className={`h-4 w-4 ${meta.color}`} />
                <span className="font-medium">{meta.label}</span>
              </div>

              {meta.requiresTarget && (
                <div className="space-y-1">
                  <Label htmlFor="targetUserId" className="text-xs">
                    UUID del usuario destino
                  </Label>
                  <Input
                    id="targetUserId"
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="font-mono text-xs"
                  />
                </div>
              )}

              {action === "ESCALATE" && (
                <div className="space-y-1">
                  <Label htmlFor="targetEsc" className="text-xs">
                    Supervisor (UUID — opcional)
                  </Label>
                  <Input
                    id="targetEsc"
                    value={targetUserId}
                    onChange={(e) => setTargetUserId(e.target.value)}
                    placeholder="Vacío = escalación abierta"
                    className="font-mono text-xs"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="reason" className="text-xs">Motivo (obligatorio)</Label>
                <Textarea
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Justificación de la acción para auditoría"
                  rows={3}
                />
              </div>

              {error() && (
                <p className="text-xs text-destructive">{error()}</p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => reset()} size="sm">
                  Volver
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={
                    pending() ||
                    reason.trim().length < 3 ||
                    (meta.requiresTarget && targetUserId.length !== 36)
                  }
                  onClick={submit}
                >
                  {pending() && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Confirmar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

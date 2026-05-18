"use client";

/**
 * /medico/substitutions-pending — US.F2.6.11.
 *
 * El médico prescriptor ve aquí todas las sustituciones
 * genérico-comerciales pendientes de su autorización y puede
 * aprobar o rechazar cada una con un motivo.
 *
 * Polling cada 30 s para detectar nuevas solicitudes en tiempo real.
 * En producción: sustituir por WebSocket / Supabase Realtime.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

interface SubstitutionRecord {
  id: string;
  prescriptionId: string;
  prescriptionItemId: string;
  gtinOriginal: string;
  gtinSustituto: string;
  propuestoPorId: string;
  propuestoEn: string | Date;
  status: string;
}

interface DecisionDialogProps {
  sub: SubstitutionRecord | null;
  action: "authorize" | "reject" | null;
  onClose: () => void;
  onSuccess: () => void;
}

function DecisionDialog({ sub, action, onClose, onSuccess }: DecisionDialogProps): React.ReactElement {
  const [motivo, setMotivo] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);

  const authMutation = trpcAny.pharmacySubstitution.authorizeSubstitution.useMutation({
    onSuccess: () => { setMotivo(""); onSuccess(); },
    onError: (e: { message: string }) => setServerError(e.message),
  });

  const rejectMutation = trpcAny.pharmacySubstitution.rejectSubstitution.useMutation({
    onSuccess: () => { setMotivo(""); onSuccess(); },
    onError: (e: { message: string }) => setServerError(e.message),
  });

  // Reset al cambiar sub/action
  React.useEffect(() => {
    setMotivo("");
    setServerError(null);
  }, [sub?.id, action]);

  const isAuthorize = action === "authorize";
  const isPending = authMutation.isPending || rejectMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sub) return;
    setServerError(null);
    if (motivo.trim().length === 0) {
      setServerError("El motivo es obligatorio.");
      return;
    }
    const input = { substitutionId: sub.id, motivo: motivo.trim() };
    if (isAuthorize) {
      authMutation.mutate(input);
    } else {
      rejectMutation.mutate(input);
    }
  };

  return (
    <Dialog open={sub !== null && action !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isAuthorize ? "Autorizar sustitución" : "Rechazar sustitución"}
          </DialogTitle>
          {sub ? (
            <DialogDescription>
              GTIN original: <code className="font-mono">{sub.gtinOriginal}</code>{" "}
              → sustituto: <code className="font-mono">{sub.gtinSustituto}</code>
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="medico-motivo">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <textarea
              id="medico-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={4}
              placeholder="Justificación clínica…"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-required="true"
              aria-invalid={Boolean(serverError)}
            />
          </div>

          {serverError ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant={isAuthorize ? "default" : "destructive"}
              disabled={isPending}
            >
              {isPending
                ? "Procesando…"
                : isAuthorize
                ? "Autorizar"
                : "Rechazar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SubstitutionsPendingPage(): React.ReactElement {
  const utils = trpcAny.useUtils?.();

  const { data, isLoading, refetch } = trpcAny.pharmacySubstitution.listPending.useQuery(
    undefined,
    { refetchInterval: 30_000 },
  );

  const pending = (data ?? []) as SubstitutionRecord[];

  const [selected, setSelected] = React.useState<SubstitutionRecord | null>(null);
  const [action, setAction] = React.useState<"authorize" | "reject" | null>(null);

  const open = (sub: SubstitutionRecord, a: "authorize" | "reject") => {
    setSelected(sub);
    setAction(a);
  };

  const handleClose = () => {
    setSelected(null);
    setAction(null);
  };

  const handleSuccess = () => {
    handleClose();
    if (utils?.pharmacySubstitution?.listPending?.invalidate) {
      utils.pharmacySubstitution.listPending.invalidate();
    } else {
      refetch();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sustituciones pendientes</h1>
          <p className="text-sm text-muted-foreground">
            Solicitudes de sustitución de medicamento que requieren su autorización.
          </p>
        </div>
        {pending.length > 0 ? (
          <span className="rounded-full bg-destructive px-2.5 py-0.5 text-xs font-semibold text-destructive-foreground">
            {pending.length}
          </span>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Solicitudes pendientes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay sustituciones pendientes de su autorización.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {pending.map((sub) => (
                <li
                  key={sub.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Sustitución de{" "}
                      <code className="rounded bg-muted px-1 font-mono text-xs">
                        {sub.gtinOriginal}
                      </code>{" "}
                      por{" "}
                      <code className="rounded bg-muted px-1 font-mono text-xs">
                        {sub.gtinSustituto}
                      </code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Solicitada:{" "}
                      {new Date(sub.propuestoEn).toLocaleString("es-SV", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => open(sub, "reject")}
                    >
                      Rechazar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => open(sub, "authorize")}
                    >
                      Autorizar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <DecisionDialog
        sub={selected}
        action={action}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

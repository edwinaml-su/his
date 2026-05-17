"use client";

/**
 * ECE — Detalle de una evolución médica.
 *
 * UX:
 *   - SOAP en 4 Card separadas (no colapsables) para lectura completa sin
 *     interacción — la evolución firmada es el documento clínico principal.
 *   - Acciones "Firmar" (solo autor) y "Validar" (rol MC) en la cabecera.
 *   - Firmar abre dialog de confirmación (inmutabilidad post-firma).
 *   - Validar: confirmación más ligera, solo disponible si ya firmada.
 *   - Tras firmar → redirect a /ece/evolucion (listado del episodio).
 */
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

interface EvolucionDetail {
  id: string;
  episodeId: string;
  authorId: string;
  authorName: string | null;
  fecha: string | Date;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  signedAt: string | Date | null;
  validatedAt: string | Date | null;
  validatedByName: string | null;
}

const SOAP_FIELDS: { key: keyof Pick<EvolucionDetail, "subjective" | "objective" | "assessment" | "plan">; label: string; color: string }[] = [
  { key: "subjective", label: "Subjetivo (S)", color: "border-blue-200 dark:border-blue-800" },
  { key: "objective", label: "Objetivo (O)", color: "border-green-200 dark:border-green-800" },
  { key: "assessment", label: "Evaluación (A)", color: "border-amber-200 dark:border-amber-800" },
  { key: "plan", label: "Plan (P)", color: "border-purple-200 dark:border-purple-800" },
];

export default function EvolucionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const detail = trpc.eceEvolucion.get.useQuery({ id });
  const ev = detail.data as unknown as EvolucionDetail | null | undefined;

  const [confirmSign, setConfirmSign] = React.useState(false);
  const [confirmValidate, setConfirmValidate] = React.useState(false);
  const [pageError, setPageError] = React.useState<string | null>(null);

  const utils = trpc.useUtils();

  const sign = trpc.eceEvolucion.firmar.useMutation({
    onSuccess: () => {
      setConfirmSign(false);
      utils.eceEvolucion.get.invalidate({ id });
      router.push(ev?.episodeId ? `/ece/evolucion?episodeId=${ev.episodeId}` : "/ece/evolucion");
    },
    onError: (e) => {
      setConfirmSign(false);
      setPageError(`Error al firmar: ${e.message}`);
    },
  });

  const validate = trpc.eceEvolucion.validar.useMutation({
    onSuccess: () => {
      setConfirmValidate(false);
      utils.eceEvolucion.get.invalidate({ id });
    },
    onError: (e) => {
      setConfirmValidate(false);
      setPageError(`Error al validar: ${e.message}`);
    },
  });

  if (detail.isLoading) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Cargando evolución…
      </p>
    );
  }

  if (detail.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Error: {detail.error.message}
      </p>
    );
  }

  if (!ev) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Evolución no encontrada.
      </p>
    );
  }

  const fecha =
    typeof ev.fecha === "string" ? new Date(ev.fecha) : ev.fecha;
  const isSigned = ev.signedAt !== null;
  const isValidated = ev.validatedAt !== null;
  const isPending = sign.isPending || validate.isPending;

  return (
    <div className="space-y-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">Evolución médica</h1>
            {isSigned ? (
              <Badge variant="success">Firmada</Badge>
            ) : (
              <Badge variant="warning">Borrador</Badge>
            )}
            {isValidated ? (
              <Badge variant="secondary">Validada</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {fecha.toLocaleDateString("es-SV", {
              weekday: "long",
              day: "2-digit",
              month: "long",
              year: "numeric",
            })}{" "}
            ·{" "}
            {ev.authorName ?? (
              <span className="font-mono">#{ev.authorId.slice(0, 8)}</span>
            )}
          </p>
          {isValidated && ev.validatedByName ? (
            <p className="text-xs text-muted-foreground">
              Validado por: {ev.validatedByName}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link
              href={
                ev.episodeId
                  ? `/ece/evolucion?episodeId=${ev.episodeId}`
                  : "/ece/evolucion"
              }
            >
              Volver al listado
            </Link>
          </Button>
          {!isSigned ? (
            <Button
              size="sm"
              onClick={() => setConfirmSign(true)}
              disabled={isPending}
            >
              Firmar
            </Button>
          ) : null}
          {isSigned && !isValidated ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmValidate(true)}
              disabled={isPending}
            >
              Validar (MC)
            </Button>
          ) : null}
        </div>
      </div>

      {pageError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {pageError}
        </div>
      ) : null}

      {/* 4 Cards SOAP */}
      <div className="grid gap-4 md:grid-cols-2">
        {SOAP_FIELDS.map(({ key, label, color }) => (
          <Card key={key} className={`border-l-4 ${color}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ev[key] && (ev[key] as string).trim().length > 0 ? (
                <p className="whitespace-pre-wrap text-sm">
                  {ev[key] as string}
                </p>
              ) : (
                <p className="italic text-sm text-muted-foreground">
                  — sin registrar —
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dialog: Firmar */}
      <Dialog
        open={confirmSign}
        onOpenChange={(v) => (!v ? setConfirmSign(false) : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firmar evolución</DialogTitle>
            <DialogDescription>
              Una vez firmada, la evolución{" "}
              <strong>no podrá editarse</strong>. La acción se registra en el
              log de auditoría con tu identidad y hora exacta.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSign(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => sign.mutate({ id })}
              disabled={isPending}
            >
              {sign.isPending ? "Firmando…" : "Firmar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Validar */}
      <Dialog
        open={confirmValidate}
        onOpenChange={(v) => (!v ? setConfirmValidate(false) : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validar evolución</DialogTitle>
            <DialogDescription>
              Como médico coordinador (MC) confirmas que revisaste y aprobas
              esta evolución. La validación queda registrada en auditoría.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmValidate(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="secondary"
              onClick={() => validate.mutate({ id })}
              disabled={isPending}
            >
              {validate.isPending ? "Validando…" : "Confirmar validación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

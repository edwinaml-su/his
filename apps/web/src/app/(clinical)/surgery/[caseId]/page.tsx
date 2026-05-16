"use client";

/**
 * §13 Surgery — Detalle de caso quirúrgico.
 *
 * Organizado en tabs: Programación / Sign-In / Time-Out / Trans-Op / Post-Op.
 * Las transiciones de estado siguen la máquina de estados del router (Beta.6):
 *   SCHEDULED/CONFIRMED → signIn → timeOut → start → IN_PROGRESS
 *   IN_PROGRESS → signOut → postOp → POST_OP → complete → COMPLETED
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";
import { SurgeryStatusBadge } from "@/components/surgery/surgery-status-badge";
import { TimeoutForm } from "@/components/surgery/timeout-form";
import { IntraOpTimeline } from "@/components/surgery/intra-op-timeline";
import {
  ComplicationsLog,
  parseComplicationsFromNotes,
  serializeComplicationEntry,
} from "@/components/surgery/complications-log";
import { PostOpForm } from "@/components/surgery/post-op-form";

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function SurgeryCaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = typeof params.caseId === "string" ? params.caseId : "";

  const query = trpc.surgery.case.get.useQuery(
    { id: caseId },
    { enabled: Boolean(caseId) },
  );

  const utils = trpc.useUtils();

  const signIn = trpc.surgery.case.signIn.useMutation({
    onSuccess: () => utils.surgery.case.get.invalidate({ id: caseId }),
  });

  const timeOut = trpc.surgery.case.timeOut.useMutation({
    onSuccess: () => utils.surgery.case.get.invalidate({ id: caseId }),
  });

  const start = trpc.surgery.case.start.useMutation({
    onSuccess: () => utils.surgery.case.get.invalidate({ id: caseId }),
  });

  const signOut = trpc.surgery.case.signOut.useMutation({
    onSuccess: () => utils.surgery.case.get.invalidate({ id: caseId }),
  });

  const postOp = trpc.surgery.case.postOp.useMutation({
    onSuccess: () => utils.surgery.case.get.invalidate({ id: caseId }),
  });

  const complete = trpc.surgery.case.complete.useMutation({
    onSuccess: () => utils.surgery.case.get.invalidate({ id: caseId }),
  });

  if (!caseId) {
    return (
      <p role="alert" className="text-sm text-destructive">
        ID de caso inválido.
      </p>
    );
  }

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando caso…</p>;
  }

  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }

  const c = query.data;
  if (!c) return null;

  const isScheduledOrConfirmed =
    c.status === "SCHEDULED" || c.status === "CONFIRMED";
  const isInProgress = c.status === "IN_PROGRESS";
  const isPostOp = c.status === "POST_OP";
  const isCompleted = c.status === "COMPLETED";

  const complicationEntries = parseComplicationsFromNotes(c.intraopNotes);

  async function handleSignIn() {
    await signIn.mutateAsync({ id: caseId });
  }

  async function handleTimeOut() {
    await timeOut.mutateAsync({ id: caseId });
  }

  async function handleStart() {
    await start.mutateAsync({ id: caseId });
  }

  async function handleSignOut() {
    await signOut.mutateAsync({ id: caseId });
  }

  async function handleAddComplication(text: string) {
    if (!c) return;
    const line = serializeComplicationEntry(text);
    const updatedNotes = c.intraopNotes
      ? `${c.intraopNotes}\n${line}`
      : line;
    // postOp mutation acepta intraopNotes, pero está restringida a IN_PROGRESS → POST_OP.
    // Para actualizar notas mid-cirugía usamos postOp con preservación de estado.
    // Si el router no lo permite en este estado, queda como BLOCKER documentado abajo.
    // Por ahora las complicaciones se acumulan localmente (optimistic) y se persisten
    // en la mutación de postOp cuando se cierra la cirugía.
    // BLOCKER: no hay endpoint `surgery.case.updateIntraopNotes` para persistir
    // complicaciones mid-IN_PROGRESS sin cambiar estado. Ver sección BLOCKERS.
    void updatedNotes; // usado para acumulación futura
    throw new Error(
      "Para persistir complicaciones se requiere surgery.case.updateIntraopNotes (BLOCKER — ver wave separada).",
    );
  }

  async function handlePostOp(finalNotes: string) {
    await postOp.mutateAsync({
      id: caseId,
      intraopNotes: finalNotes || undefined,
    });
  }

  async function handleComplete(postopNotes: string) {
    await complete.mutateAsync({
      id: caseId,
      postopNotes: postopNotes || undefined,
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <Link
            href="/surgery"
            className="text-sm text-muted-foreground hover:underline"
            aria-label="Volver al listado de cirugías"
          >
            ← Cirugías
          </Link>
          <h1 className="text-2xl font-bold mt-1">Detalle de caso quirúrgico</h1>
          <div className="flex items-center gap-2 mt-1">
            <SurgeryStatusBadge status={c.status as Parameters<typeof SurgeryStatusBadge>[0]["status"]} />
            <span className="text-xs text-muted-foreground font-mono">{c.id}</span>
          </div>
        </div>
        {isScheduledOrConfirmed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/surgery")}
          >
            Cancelar / Posponer
          </Button>
        )}
      </div>

      <Tabs defaultValue="programacion">
        <TabsList aria-label="Secciones del caso quirúrgico">
          <TabsTrigger value="programacion">Programación</TabsTrigger>
          <TabsTrigger value="signin">Sign In</TabsTrigger>
          <TabsTrigger value="timeout">Time-Out</TabsTrigger>
          <TabsTrigger value="intraop">Trans-Op</TabsTrigger>
          <TabsTrigger value="postop">Post-Op</TabsTrigger>
        </TabsList>

        {/* ---- Programación ---- */}
        <TabsContent value="programacion">
          <Card>
            <CardHeader>
              <CardTitle>Datos de programación</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Procedimiento</dt>
                  <dd className="font-medium">{c.procedureDescription}</dd>
                </div>
                {c.procedureCode && (
                  <div>
                    <dt className="text-muted-foreground">Código CIE</dt>
                    <dd className="font-mono">{c.procedureCode}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Inicio programado</dt>
                  <dd className="tabular-nums">{dateFmt.format(new Date(c.scheduledStart))}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fin programado</dt>
                  <dd className="tabular-nums">{dateFmt.format(new Date(c.scheduledEnd))}</dd>
                </div>
                {c.asaClass && (
                  <div>
                    <dt className="text-muted-foreground">Clasificación ASA</dt>
                    <dd>{c.asaClass}</dd>
                  </div>
                )}
                {c.anesthesiaType && (
                  <div>
                    <dt className="text-muted-foreground">Tipo de anestesia</dt>
                    <dd>{c.anesthesiaType}</dd>
                  </div>
                )}
                {c.preopNotes && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Notas pre-op</dt>
                    <dd className="whitespace-pre-wrap">{c.preopNotes}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Sign In ---- */}
        <TabsContent value="signin">
          <Card>
            <CardHeader>
              <CardTitle>Sign In — Verificación inicial OMS</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {c.signInAt ? (
                <div
                  role="status"
                  className="rounded-md border border-green-200 bg-green-50 p-4"
                >
                  <p className="font-semibold text-green-800">Sign In completado</p>
                  <p className="text-sm text-green-700">
                    {dateFmt.format(new Date(c.signInAt))}
                  </p>
                </div>
              ) : isScheduledOrConfirmed ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Verifica identidad del paciente, consentimiento y sitio marcado.
                  </p>
                  {signIn.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {signIn.error.message}
                    </p>
                  )}
                  <Button
                    onClick={handleSignIn}
                    disabled={signIn.isPending}
                    aria-label="Registrar Sign In del checklist OMS"
                  >
                    {signIn.isPending ? "Registrando…" : "Registrar Sign In"}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Sign In no aplicable en estado {c.status}.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Time-Out ---- */}
        <TabsContent value="timeout">
          <Card>
            <CardHeader>
              <CardTitle>Time-Out OMS — Pre-incisión</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeoutForm
                alreadyCompleted={Boolean(c.timeOutAt)}
                completedAt={c.timeOutAt}
                onConfirm={handleTimeOut}
                isPending={timeOut.isPending}
              />
              {/* Iniciar cirugía después del time-out */}
              {c.signInAt && c.timeOutAt && isScheduledOrConfirmed && (
                <div className="mt-4 space-y-2 border-t pt-4">
                  <p className="text-sm font-medium">
                    Checklist OMS completado. Puedes iniciar la cirugía.
                  </p>
                  {start.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {start.error.message}
                    </p>
                  )}
                  <Button
                    onClick={handleStart}
                    disabled={start.isPending}
                    aria-label="Iniciar cirugía — requiere Sign In y Time-Out completados"
                  >
                    {start.isPending ? "Iniciando…" : "Iniciar cirugía"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Trans-Op ---- */}
        <TabsContent value="intraop">
          <Card>
            <CardHeader>
              <CardTitle>Trans-operatorio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <IntraOpTimeline
                signInAt={c.signInAt}
                timeOutAt={c.timeOutAt}
                actualStart={c.actualStart}
                signOutAt={c.signOutAt}
                actualEnd={c.actualEnd}
              />

              {/* Sign Out */}
              {isInProgress && (
                <div className="border-t pt-4 space-y-2">
                  <h3 className="text-sm font-semibold">Sign Out OMS</h3>
                  {!c.signOutAt ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Confirma conteo de instrumental, especímenes y etiquetado.
                      </p>
                      {signOut.error && (
                        <p role="alert" className="text-sm text-destructive">
                          {signOut.error.message}
                        </p>
                      )}
                      <Button
                        onClick={handleSignOut}
                        disabled={signOut.isPending}
                        aria-label="Registrar Sign Out del checklist OMS"
                      >
                        {signOut.isPending ? "Registrando…" : "Registrar Sign Out"}
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-green-700 font-medium">
                      Sign Out registrado: {dateFmt.format(new Date(c.signOutAt))}
                    </p>
                  )}
                </div>
              )}

              {/* Cerrar cirugía → POST_OP */}
              {isInProgress && c.signOutAt && (
                <div className="border-t pt-4 space-y-2">
                  <h3 className="text-sm font-semibold">Cerrar cirugía</h3>
                  {postOp.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {postOp.error.message}
                    </p>
                  )}
                  <Button
                    onClick={() => handlePostOp(c.intraopNotes ?? "")}
                    disabled={postOp.isPending}
                    aria-label="Cerrar cirugía y pasar a post-operatorio"
                  >
                    {postOp.isPending ? "Cerrando…" : "Cerrar cirugía (→ Post-Op)"}
                  </Button>
                </div>
              )}

              {/* Complicaciones */}
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-2">Complicaciones</h3>
                <ComplicationsLog
                  entries={complicationEntries}
                  readOnly={!isInProgress}
                  onAdd={isInProgress ? handleAddComplication : undefined}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Post-Op ---- */}
        <TabsContent value="postop">
          <Card>
            <CardHeader>
              <CardTitle>Post-operatorio</CardTitle>
            </CardHeader>
            <CardContent>
              {!isPostOp && !isCompleted ? (
                <p className="text-sm text-muted-foreground">
                  La sección post-op estará disponible después del cierre de cirugía.
                </p>
              ) : (
                <PostOpForm
                  caseId={caseId}
                  alreadyCompleted={isCompleted}
                  existingNotes={c.postopNotes}
                  onComplete={handleComplete}
                  isPending={complete.isPending}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

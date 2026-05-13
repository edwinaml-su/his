"use client";

/**
 * §14 EHR Clinical Notes — Timeline de notas SOAP del encuentro.
 *
 * Decisiones de UX (equipo Lima · Sprint 4):
 *   - Timeline vertical (no tabla) → la lectura clínica es cronológica
 *     y se beneficia del foco vertical sobre cada nota completa.
 *   - SOAP en 4 secciones colapsables (<details>) para no saturar la
 *     vista en notas largas; expandida por defecto la primera (la más
 *     reciente) y colapsada el resto.
 *   - Addenda: aparecen como notas independientes con tag visible de
 *     "Addendum de #abc123" + link al original (chain navegable). La
 *     nota original NO se muta — política de inmutabilidad clínica.
 *   - Firma: dialog destructivo con confirmación textual ("una vez
 *     firmada no podrá editarse"). Sólo el autor puede firmar.
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
import {
  NoteTypeBadge,
  type NoteType,
} from "./_components/note-type-badge";

interface ClinicalNoteRow {
  id: string;
  encounterId: string;
  authorId: string;
  authoredAt: string | Date;
  noteType: NoteType;
  specialtyId: string | null;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  addendumOfId: string | null;
  signedAt: string | Date | null;
}

export default function EncounterNotesPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const encounterId = params.id;

  const list = trpc.ehrNotes.note.list.useQuery({ encounterId });
  const notes = (list.data ?? []) as unknown as ClinicalNoteRow[];

  // El router actual no devuelve currentUserId; lo aproximamos con el primer
  // authorId que el backend marque como propio en futuro (cuando el router
  // anexe `mine: true`). Por ahora dejamos el flag en `null` y tratamos toda
  // borrador como editable a nivel UI; el server enforcement (FORBIDDEN si
  // authorId !== ctx.user.id) protege la integridad clínica.
  // TODO(Sprint 4 cierre): exponer `auth.me` o agregar `isMine` al list.
  const currentUserId: string | null = null;

  const [confirmSignId, setConfirmSignId] = React.useState<string | null>(null);

  const utils = trpc.useUtils();
  const sign = trpc.ehrNotes.note.sign.useMutation({
    onSuccess: () => {
      setConfirmSignId(null);
      utils.ehrNotes.note.list.invalidate({ encounterId });
    },
  });

  if (list.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando notas…</p>;
  }

  if (list.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Error al cargar notas: {list.error.message}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notas clínicas</h1>
          <p className="text-sm text-muted-foreground">
            Encuentro #{encounterId.slice(0, 8)} · {notes.length} nota
            {notes.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild>
          <Link href={`/encounters/${encounterId}/notes/new`}>+ Nueva nota</Link>
        </Button>
      </div>

      {notes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Sin notas todavía. Crea la primera con el botón superior.
          </CardContent>
        </Card>
      ) : (
        <ol className="relative space-y-4 border-l border-muted pl-6">
          {notes.map((n, i) => (
            <li key={n.id} className="relative">
              <span
                className="absolute -left-[31px] top-3 inline-block h-3 w-3 rounded-full border-2 border-background bg-primary"
                aria-hidden="true"
              />
              <NoteCard
                note={n}
                isLatest={i === 0}
                isMine={currentUserId !== null && n.authorId === currentUserId}
                encounterId={encounterId}
                onSignRequest={(id) => setConfirmSignId(id)}
                onAddendum={(id) =>
                  router.push(
                    `/encounters/${encounterId}/notes/new?addendumOf=${id}`,
                  )
                }
                onLocateOriginal={(originalId) => {
                  const el = document.getElementById(`note-${originalId}`);
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  el?.classList.add("ring-2", "ring-primary");
                  window.setTimeout(
                    () => el?.classList.remove("ring-2", "ring-primary"),
                    1500,
                  );
                }}
              />
            </li>
          ))}
        </ol>
      )}

      <SignConfirmDialog
        open={confirmSignId !== null}
        isPending={sign.isPending}
        error={sign.error?.message ?? null}
        onCancel={() => setConfirmSignId(null)}
        onConfirm={() => {
          if (confirmSignId) sign.mutate({ id: confirmSignId });
        }}
      />
    </div>
  );
}

interface NoteCardProps {
  note: ClinicalNoteRow;
  isLatest: boolean;
  isMine: boolean;
  encounterId: string;
  onSignRequest: (id: string) => void;
  onAddendum: (id: string) => void;
  onLocateOriginal: (id: string) => void;
}

function NoteCard({
  note,
  isLatest,
  isMine,
  encounterId,
  onSignRequest,
  onAddendum,
  onLocateOriginal,
}: NoteCardProps) {
  const signed = note.signedAt !== null;
  const authoredAtDate =
    typeof note.authoredAt === "string"
      ? new Date(note.authoredAt)
      : note.authoredAt;

  return (
    <Card id={`note-${note.id}`} className="transition-shadow">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <NoteTypeBadge noteType={note.noteType} />
            {signed ? (
              <Badge variant="success" aria-label="Firmada">
                <LockIcon /> Firmada
              </Badge>
            ) : (
              <Badge variant="warning" aria-label="Borrador sin firmar">
                Borrador
              </Badge>
            )}
            {note.addendumOfId ? (
              <button
                type="button"
                onClick={() => onLocateOriginal(note.addendumOfId!)}
                className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
              >
                Addendum de #{note.addendumOfId.slice(0, 8)}
              </button>
            ) : null}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">#{note.authorId.slice(0, 8)}</span> ·{" "}
            {authoredAtDate.toLocaleString("es-SV")}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {!signed && isMine ? (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href={`/encounters/${encounterId}/notes/${note.id}/edit`}>
                  Editar
                </Link>
              </Button>
              <Button size="sm" onClick={() => onSignRequest(note.id)}>
                Firmar
              </Button>
            </>
          ) : null}
          {!signed && !isMine ? (
            <Button
              size="sm"
              disabled
              title="Sólo el autor puede firmar la nota"
            >
              Firmar
            </Button>
          ) : null}
          {signed ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAddendum(note.id)}
            >
              Crear addendum
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <SoapSection
          label="Subjetivo (S)"
          content={note.subjective}
          openByDefault={isLatest}
        />
        <SoapSection
          label="Objetivo (O)"
          content={note.objective}
          openByDefault={isLatest}
        />
        <SoapSection
          label="Evaluación (A)"
          content={note.assessment}
          openByDefault={isLatest}
        />
        <SoapSection
          label="Plan (P)"
          content={note.plan}
          openByDefault={isLatest}
        />
      </CardContent>
    </Card>
  );
}

function SoapSection({
  label,
  content,
  openByDefault,
}: {
  label: string;
  content: string | null;
  openByDefault: boolean;
}) {
  return (
    <details
      className="group rounded-md border bg-muted/30 p-2"
      open={openByDefault}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span className="text-[10px] group-open:rotate-180 transition-transform">
          ▾
        </span>
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
        {content && content.trim().length > 0 ? (
          content
        ) : (
          <span className="text-muted-foreground italic">— sin registrar —</span>
        )}
      </p>
    </details>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="mr-1 h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SignConfirmDialog({
  open,
  isPending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onCancel() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Firmar nota clínica?</DialogTitle>
          <DialogDescription>
            Una vez firmada, la nota <strong>no podrá editarse</strong>. Sólo
            podrás crear un <em>addendum</em> para agregar correcciones o
            información complementaria. Esta acción queda registrada en el log
            de auditoría con tu identidad.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            No se pudo firmar: {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "Firmando…" : "Firmar definitivamente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

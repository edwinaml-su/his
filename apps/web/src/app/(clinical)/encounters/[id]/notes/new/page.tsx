"use client";

/**
 * §14 EHR Clinical Notes — Form de nueva nota SOAP.
 *
 * Decisiones de UX:
 *   - 2 botones de submit con semántica clara: "Guardar como borrador"
 *     (sólo create) vs "Firmar y publicar" (create + sign en cadena).
 *     El segundo abre dialog de confirmación destructiva ANTES de
 *     ejecutar el sign, para honrar la inmutabilidad post-firma.
 *   - Counter de chars por sección (max 8000 según schema). Se vuelve
 *     rojo a partir de 7500 para dar señal temprana sin bloquear.
 *   - specialtyId queda como text input — TODO autocomplete cuando el
 *     equipo de Catálogos exponga `catalog.searchSpecialties`.
 *   - Si la URL trae ?addendumOf=<id>, se entiende que es addendum:
 *     se llama `note.addendum` en lugar de `note.create`.
 */
import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
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
  NOTE_TYPE_OPTIONS,
  type NoteType,
} from "../_components/note-type-badge";

const MAX_CHARS = 8000;
const WARN_THRESHOLD = 7500;

type SoapField = "subjective" | "objective" | "assessment" | "plan";

interface FormState {
  noteType: NoteType;
  specialtyId: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

const initial = (): FormState => ({
  noteType: "PROGRESS",
  specialtyId: "",
  subjective: "",
  objective: "",
  assessment: "",
  plan: "",
});

export default function NewNotePage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const encounterId = params.id;
  const addendumOfId = search.get("addendumOf");
  const isAddendum = !!addendumOfId;

  const [form, setForm] = React.useState<FormState>(initial);
  const [confirmSignOpen, setConfirmSignOpen] = React.useState(false);
  const [pageError, setPageError] = React.useState<string | null>(null);

  const create = trpc.ehrNotes.note.create.useMutation();
  const addendum = trpc.ehrNotes.note.addendum.useMutation();
  const sign = trpc.ehrNotes.note.sign.useMutation();
  const utils = trpc.useUtils();

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const hasContent =
    form.subjective.trim() !== "" ||
    form.objective.trim() !== "" ||
    form.assessment.trim() !== "" ||
    form.plan.trim() !== "";

  const exceedsLimit =
    form.subjective.length > MAX_CHARS ||
    form.objective.length > MAX_CHARS ||
    form.assessment.length > MAX_CHARS ||
    form.plan.length > MAX_CHARS;

  const validUuidOrUndef = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
      ? v
      : undefined;

  const buildPayload = () => ({
    noteType: form.noteType,
    specialtyId: validUuidOrUndef(form.specialtyId.trim()),
    subjective: form.subjective.trim() || undefined,
    objective: form.objective.trim() || undefined,
    assessment: form.assessment.trim() || undefined,
    plan: form.plan.trim() || undefined,
  });

  const isPending = create.isPending || addendum.isPending || sign.isPending;

  async function persistDraft(): Promise<{ id: string } | null> {
    setPageError(null);
    try {
      if (isAddendum && addendumOfId) {
        const r = await addendum.mutateAsync({
          addendumOfId,
          ...buildPayload(),
        });
        return r as { id: string };
      }
      const r = await create.mutateAsync({
        encounterId,
        ...buildPayload(),
      });
      return r as { id: string };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar.";
      setPageError(msg);
      return null;
    }
  }

  async function onSaveDraft() {
    const created = await persistDraft();
    if (!created) return;
    await utils.ehrNotes.note.list.invalidate({ encounterId });
    router.replace(`/encounters/${encounterId}/notes`);
  }

  async function onSignAndPublish() {
    setConfirmSignOpen(false);
    const created = await persistDraft();
    if (!created) return;
    try {
      await sign.mutateAsync({ id: created.id });
      await utils.ehrNotes.note.list.invalidate({ encounterId });
      router.replace(`/encounters/${encounterId}/notes`);
    } catch (e) {
      // Borrador quedó persistido; informa con role=alert claro.
      const msg = e instanceof Error ? e.message : "Error al firmar.";
      setPageError(
        `La nota se guardó como borrador, pero falló la firma: ${msg}. ` +
          "Podés reintentar firmar desde la lista de notas.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          {isAddendum ? "Nuevo addendum" : "Nueva nota clínica"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Encuentro #{encounterId.slice(0, 8)}
          {isAddendum && addendumOfId ? (
            <>
              {" · "}Addendum de la nota{" "}
              <span className="font-mono">#{addendumOfId.slice(0, 8)}</span>
            </>
          ) : null}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SOAP</CardTitle>
        </CardHeader>
        <CardContent>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              void onSaveDraft();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField>
                <Label htmlFor="noteType">Tipo de nota</Label>
                <Select
                  value={form.noteType}
                  onValueChange={(v) => set("noteType", v as NoteType)}
                >
                  <SelectTrigger id="noteType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NOTE_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField>
                <Label htmlFor="specialty">
                  Especialidad{" "}
                  <span className="text-xs text-muted-foreground">
                    (UUID — TODO autocomplete)
                  </span>
                </Label>
                <Input
                  id="specialty"
                  value={form.specialtyId}
                  onChange={(e) => set("specialtyId", e.target.value)}
                  placeholder="opcional"
                  maxLength={36}
                />
              </FormField>
            </div>

            <SoapTextarea
              field="subjective"
              label="Subjetivo (S) — relato del paciente"
              value={form.subjective}
              onChange={(v) => set("subjective", v)}
            />
            <SoapTextarea
              field="objective"
              label="Objetivo (O) — hallazgos al examen"
              value={form.objective}
              onChange={(v) => set("objective", v)}
            />
            <SoapTextarea
              field="assessment"
              label="Evaluación (A) — diagnóstico/impresión"
              value={form.assessment}
              onChange={(v) => set("assessment", v)}
            />
            <SoapTextarea
              field="plan"
              label="Plan (P) — conducta y seguimiento"
              value={form.plan}
              onChange={(v) => set("plan", v)}
            />

            {pageError ? (
              <div role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                {pageError}
              </div>
            ) : (
              <FormError>
                {create.error?.message ??
                  addendum.error?.message ??
                  sign.error?.message ??
                  null}
              </FormError>
            )}

            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.back()}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="outline"
                  disabled={isPending || !hasContent || exceedsLimit}
                >
                  {create.isPending || addendum.isPending
                    ? "Guardando…"
                    : "Guardar como borrador"}
                </Button>
                <Button
                  type="button"
                  onClick={() => setConfirmSignOpen(true)}
                  disabled={isPending || !hasContent || exceedsLimit}
                >
                  Firmar y publicar
                </Button>
              </div>
            </div>
          </Form>
        </CardContent>
      </Card>

      <Dialog
        open={confirmSignOpen}
        onOpenChange={(v) => (!v ? setConfirmSignOpen(false) : null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Firmar y publicar la nota?</DialogTitle>
            <DialogDescription>
              Una vez firmada, la nota <strong>no podrá editarse</strong>. Sólo
              podrás crear un <em>addendum</em> con correcciones o información
              complementaria. La acción se registra en el log de auditoría con
              tu identidad.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSignOpen(false)}
              disabled={isPending}
            >
              Revisar de nuevo
            </Button>
            <Button onClick={() => void onSignAndPublish()} disabled={isPending}>
              {isPending ? "Procesando…" : "Sí, firmar definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SoapTextareaProps {
  field: SoapField;
  label: string;
  value: string;
  onChange: (v: string) => void;
}

function SoapTextarea({ field, label, value, onChange }: SoapTextareaProps) {
  const len = value.length;
  const overWarn = len >= WARN_THRESHOLD;
  const overLimit = len > MAX_CHARS;
  const counterId = `${field}-counter`;

  return (
    <FormField>
      <div className="flex items-center justify-between">
        <Label htmlFor={field}>{label}</Label>
        <span
          id={counterId}
          aria-live="polite"
          className={`text-xs tabular-nums ${
            overLimit
              ? "font-semibold text-destructive"
              : overWarn
                ? "text-amber-600"
                : "text-muted-foreground"
          }`}
        >
          {len.toLocaleString("es-SV")} / {MAX_CHARS.toLocaleString("es-SV")}
        </span>
      </div>
      <textarea
        id={field}
        name={field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_CHARS}
        rows={5}
        aria-describedby={counterId}
        aria-invalid={overLimit || undefined}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </FormField>
  );
}

"use client";

/**
 * §14 EHR Clinical Notes — Diagnósticos del encuentro (CIE-10).
 *
 * Decisiones de UX:
 *   - Tabla en lugar de timeline → la lectura típica es comparativa
 *     (PRINCIPAL vs SECONDARY vs RULE_OUT), beneficia ordenamiento.
 *   - Form inline (no dialog separado) tras click en "Agregar". Más
 *     rápido que abrir/cerrar dialog cuando la captura es frecuente.
 *   - Resolver: confirm(window) básico — la confirmación no es
 *     destructiva como la firma de notas, alcanza con prompt nativo.
 *   - conceptId como text input por ahora (UUID). El autocomplete
 *     CIE-10 llega cuando catálogos exponga `catalog.searchConcepts`.
 *     Hasta entonces la columna "Descripción" muestra `conceptId`
 *     truncado — UX honesto sobre el gap pendiente.
 */
import * as React from "react";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type DiagnosisType = "PRINCIPAL" | "SECONDARY" | "RULE_OUT" | "CHRONIC";

interface DiagnosisRow {
  id: string;
  encounterId: string;
  conceptId: string;
  type: DiagnosisType;
  diagnosedAt: string | Date;
  diagnosedById: string;
  notes: string | null;
  resolvedAt: string | Date | null;
}

const TYPE_LABEL: Record<DiagnosisType, string> = {
  PRINCIPAL: "Principal",
  SECONDARY: "Secundario",
  RULE_OUT: "A descartar",
  CHRONIC: "Crónico",
};

const TYPE_VARIANT: Record<DiagnosisType, "default" | "outline" | "warning" | "info"> = {
  PRINCIPAL: "default",
  SECONDARY: "outline",
  RULE_OUT: "warning",
  CHRONIC: "info",
};

const TYPE_OPTIONS: ReadonlyArray<DiagnosisType> = [
  "PRINCIPAL",
  "SECONDARY",
  "RULE_OUT",
  "CHRONIC",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EncounterDiagnosesPage() {
  const params = useParams<{ id: string }>();
  const encounterId = params.id;

  const list = trpc.ehrNotes.diagnosis.list.useQuery({ encounterId });
  const rows = (list.data ?? []) as unknown as DiagnosisRow[];

  const [showForm, setShowForm] = React.useState(false);

  const utils = trpc.useUtils();
  const create = trpc.ehrNotes.diagnosis.create.useMutation({
    onSuccess: () => {
      utils.ehrNotes.diagnosis.list.invalidate({ encounterId });
      setShowForm(false);
    },
  });
  const resolve = trpc.ehrNotes.diagnosis.resolve.useMutation({
    onSuccess: () =>
      utils.ehrNotes.diagnosis.list.invalidate({ encounterId }),
  });

  const onResolve = (id: string) => {
    if (
      window.confirm(
        "¿Marcar este diagnóstico como resuelto?\n" +
          "Quedará registrado como cerrado en este encuentro.",
      )
    ) {
      resolve.mutate({ id });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Diagnósticos</h1>
          <p className="text-sm text-muted-foreground">
            Encuentro #{encounterId.slice(0, 8)} · {rows.length} registro
            {rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button
          onClick={() => setShowForm((v) => !v)}
          variant={showForm ? "outline" : "default"}
        >
          {showForm ? "Cancelar" : "+ Agregar diagnóstico"}
        </Button>
      </div>

      {showForm ? (
        <DiagnosisForm
          encounterId={encounterId}
          isPending={create.isPending}
          error={create.error?.message ?? null}
          onSubmit={(payload) => create.mutate(payload)}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Lista</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {list.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
          ) : list.error ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              Error al cargar: {list.error.message}
            </p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Sin diagnósticos registrados.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Código CIE-10</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Diagnosticado por</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Resuelto en</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((d) => {
                  const isResolved = d.resolvedAt !== null;
                  const diagAt =
                    typeof d.diagnosedAt === "string"
                      ? new Date(d.diagnosedAt)
                      : d.diagnosedAt;
                  const resAt = isResolved
                    ? typeof d.resolvedAt === "string"
                      ? new Date(d.resolvedAt as string)
                      : (d.resolvedAt as Date)
                    : null;
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Badge variant={TYPE_VARIANT[d.type]}>
                          {TYPE_LABEL[d.type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {/* TODO(catalog): join con ClinicalConcept para mostrar code real. */}
                        <span title={d.conceptId}>
                          #{d.conceptId.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        <span
                          className="text-muted-foreground italic"
                          title={d.notes ?? undefined}
                        >
                          {d.notes ?? "— sin descripción adicional —"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        #{d.diagnosedById.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {diagAt.toLocaleString("es-SV")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {resAt ? (
                          <span className="text-success">
                            {resAt.toLocaleString("es-SV")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isResolved ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onResolve(d.id)}
                            disabled={
                              resolve.isPending && resolve.variables?.id === d.id
                            }
                          >
                            Marcar como resuelto
                          </Button>
                        ) : (
                          <Badge variant="success">Resuelto</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface DiagnosisFormProps {
  encounterId: string;
  isPending: boolean;
  error: string | null;
  onSubmit: (payload: {
    encounterId: string;
    conceptId: string;
    type: DiagnosisType;
    notes?: string;
  }) => void;
  onCancel: () => void;
}

function DiagnosisForm({
  encounterId,
  isPending,
  error,
  onSubmit,
  onCancel,
}: DiagnosisFormProps) {
  const [type, setType] = React.useState<DiagnosisType>("SECONDARY");
  const [conceptId, setConceptId] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const conceptValid = UUID_RE.test(conceptId.trim());
  const canSubmit = conceptValid && !isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nuevo diagnóstico</CardTitle>
      </CardHeader>
      <CardContent>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            onSubmit({
              encounterId,
              conceptId: conceptId.trim(),
              type,
              notes: notes.trim() || undefined,
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField>
              <Label htmlFor="diag-type">Tipo</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as DiagnosisType)}
              >
                <SelectTrigger id="diag-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="diag-concept">
                Concepto CIE-10 (UUID){" "}
                <span className="text-xs text-muted-foreground">
                  TODO autocomplete
                </span>
              </Label>
              <Input
                id="diag-concept"
                value={conceptId}
                onChange={(e) => setConceptId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                aria-invalid={
                  conceptId.length > 0 && !conceptValid ? true : undefined
                }
                maxLength={36}
              />
              {conceptId.length > 0 && !conceptValid ? (
                <p className="text-xs text-destructive">
                  Debe ser un UUID válido. (mientras llega el autocomplete)
                </p>
              ) : null}
            </FormField>
          </div>

          <FormField>
            <Label htmlFor="diag-notes">Notas (opcional, máx 2000)</Label>
            <textarea
              id="diag-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </FormField>

          {error ? (
            <div role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : (
            <FormError>{null}</FormError>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending ? "Guardando…" : "Agregar"}
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

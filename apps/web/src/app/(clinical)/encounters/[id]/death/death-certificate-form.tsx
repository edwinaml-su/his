"use client";

/**
 * US-5.6 — Formulario de certificado médico de defunción.
 *
 * El componente es 100% cliente y delega la creación al router via tRPC.
 * Estructura visual en 3 secciones:
 *   1. Datos del fallecimiento (occurredAt, manner).
 *   2. Causas (basic obligatoria, intermediate y direct opcionales,
 *      contributing texto largo). Cada código tiene autocomplete CIE-10.
 *   3. Confirmación destructiva — Dialog que avisa la irreversibilidad
 *      del cierre del encounter como DEATH.
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormField, FormError } from "@his/ui/components/form";
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

type Manner = "natural" | "accident" | "suicide" | "homicide" | "undetermined";

const MANNER_LABEL: Record<Manner, string> = {
  natural: "Natural",
  accident: "Accidente",
  suicide: "Suicidio",
  homicide: "Homicidio",
  undetermined: "Indeterminado (autopsia pendiente)",
};

interface CauseValue {
  code: string;
  desc: string;
}

interface FormState {
  occurredAt: string; // datetime-local string
  manner: Manner | "";
  basic: CauseValue;
  intermediate: CauseValue;
  direct: CauseValue;
  contributing: string;
  notes: string;
}

function nowLocalDateTimeInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface IcdAutocompleteProps {
  id: string;
  label: string;
  required?: boolean;
  value: CauseValue;
  onChange: (next: CauseValue) => void;
}

function IcdAutocomplete({
  id,
  label,
  required,
  value,
  onChange,
}: IcdAutocompleteProps) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const search = trpc.deathCertificate.searchIcd10.useQuery(
    { query, limit: 12 },
    { enabled: query.trim().length >= 1 },
  );

  return (
    <FormField>
      <Label htmlFor={id}>
        {label} {required ? <span className="text-destructive">*</span> : null}
      </Label>
      <div className="grid grid-cols-[160px_1fr] gap-2">
        <div className="relative">
          <Input
            id={id}
            value={value.code}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              const next = e.target.value.toUpperCase();
              onChange({ ...value, code: next });
              setQuery(next);
              setOpen(true);
            }}
            onBlur={() => {
              // delay so click on suggestion can fire
              window.setTimeout(() => setOpen(false), 150);
            }}
            placeholder="CIE-10"
            autoComplete="off"
          />
          {open && search.data && search.data.length > 0 ? (
            <ul
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
              role="listbox"
            >
              {search.data.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0 px-2 py-1.5 text-left hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange({ code: c.code, desc: c.display });
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.code}
                    </span>
                    <span>{c.display}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Input
          aria-label={`${label} descripción`}
          value={value.desc}
          onChange={(e) => onChange({ ...value, desc: e.target.value })}
          placeholder="Descripción"
        />
      </div>
    </FormField>
  );
}

export interface DeathCertificateFormProps {
  encounterId: string;
  patientName: string;
  patientMrn: string;
  encounterAdmittedAt: Date;
  onCreated: (certificateId: string) => void;
}

export function DeathCertificateForm({
  encounterId,
  patientName,
  patientMrn,
  encounterAdmittedAt,
  onCreated,
}: DeathCertificateFormProps) {
  const [state, setState] = React.useState<FormState>(() => ({
    occurredAt: nowLocalDateTimeInput(),
    manner: "",
    basic: { code: "", desc: "" },
    intermediate: { code: "", desc: "" },
    direct: { code: "", desc: "" },
    contributing: "",
    notes: "",
  }));
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const create = trpc.deathCertificate.create.useMutation({
    onSuccess: (cert) => {
      setConfirmOpen(false);
      onCreated(cert.id);
    },
    onError: (err) => {
      setError(err.message);
      setConfirmOpen(false);
    },
  });

  function validate(): string | null {
    if (!state.occurredAt) return "Fecha y hora de fallecimiento requeridas.";
    const occurred = new Date(state.occurredAt);
    if (Number.isNaN(occurred.getTime())) return "Fecha inválida.";
    if (occurred < encounterAdmittedAt) {
      return "La fecha de fallecimiento no puede ser anterior a la admisión.";
    }
    if (occurred.getTime() > Date.now() + 60 * 1000) {
      return "La fecha de fallecimiento no puede ser futura.";
    }
    if (!state.basic.code.trim() || !state.basic.desc.trim()) {
      return "La causa básica (CIE-10) es obligatoria.";
    }
    const halfFilled = (c: CauseValue) =>
      Boolean(c.code.trim()) !== Boolean(c.desc.trim());
    if (halfFilled(state.intermediate)) {
      return "Causa intermedia: completa código y descripción o deja ambos vacíos.";
    }
    if (halfFilled(state.direct)) {
      return "Causa directa: completa código y descripción o deja ambos vacíos.";
    }
    return null;
  }

  function handlePrimaryConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setConfirmOpen(true);
  }

  function handleFinalSubmit() {
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      setConfirmOpen(false);
      return;
    }
    create.mutate({
      encounterId,
      occurredAt: new Date(state.occurredAt),
      basicCauseCode: state.basic.code.trim(),
      basicCauseDesc: state.basic.desc.trim(),
      intermediateCauseCode: state.intermediate.code.trim() || undefined,
      intermediateCauseDesc: state.intermediate.desc.trim() || undefined,
      directCauseCode: state.direct.code.trim() || undefined,
      directCauseDesc: state.direct.desc.trim() || undefined,
      contributingCauses: state.contributing.trim() || undefined,
      manner: state.manner || undefined,
      notes: state.notes.trim() || undefined,
    });
  }

  return (
    <>
      <Form onSubmit={handlePrimaryConfirm}>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">1. Datos del fallecimiento</h2>
          <p className="text-sm text-muted-foreground">
            Paciente: <strong>{patientName}</strong> · MRN {patientMrn}
          </p>

          <FormField>
            <Label htmlFor="occurredAt">
              Fecha y hora del fallecimiento{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="occurredAt"
              type="datetime-local"
              value={state.occurredAt}
              onChange={(e) =>
                setState({ ...state, occurredAt: e.target.value })
              }
              max={nowLocalDateTimeInput()}
            />
          </FormField>

          <FormField>
            <Label htmlFor="manner">Modo</Label>
            <Select
              value={state.manner}
              onValueChange={(v) =>
                setState({ ...state, manner: v as Manner })
              }
            >
              <SelectTrigger id="manner">
                <SelectValue placeholder="Selecciona modo (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MANNER_LABEL) as Manner[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MANNER_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </section>

        <section className="space-y-3 border-t pt-4">
          <h2 className="text-lg font-semibold">2. Causas (CIE-10)</h2>
          <p className="text-xs text-muted-foreground">
            La causa básica es obligatoria. La intermedia y directa se incluyen
            cuando aplique la cadena causal.
          </p>

          <IcdAutocomplete
            id="basicCauseCode"
            label="Causa básica"
            required
            value={state.basic}
            onChange={(v) => setState({ ...state, basic: v })}
          />

          <IcdAutocomplete
            id="intermediateCauseCode"
            label="Causa intermedia"
            value={state.intermediate}
            onChange={(v) => setState({ ...state, intermediate: v })}
          />

          <IcdAutocomplete
            id="directCauseCode"
            label="Causa directa"
            value={state.direct}
            onChange={(v) => setState({ ...state, direct: v })}
          />

          <FormField>
            <Label htmlFor="contributing">Causas contribuyentes</Label>
            <textarea
              id="contributing"
              className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={state.contributing}
              onChange={(e) =>
                setState({ ...state, contributing: e.target.value })
              }
              placeholder="Comorbilidades y condiciones contribuyentes"
              maxLength={2000}
            />
          </FormField>

          <FormField>
            <Label htmlFor="notes">Notas adicionales</Label>
            <textarea
              id="notes"
              className="min-h-[60px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={state.notes}
              onChange={(e) => setState({ ...state, notes: e.target.value })}
              placeholder="Observaciones (opcional)"
              maxLength={2000}
            />
          </FormField>
        </section>

        <FormError>{error}</FormError>

        <div className="flex justify-end">
          <Button type="submit" variant="destructive" disabled={create.isPending}>
            Continuar a confirmación
          </Button>
        </div>
      </Form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar emisión del certificado</DialogTitle>
            <DialogDescription>
              Revisa los datos. Esta acción es irreversible.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              Este certificado es definitivo. Una vez creado, el encuentro se
              cierra como DECEASED y no puede revertirse sin justificación
              documentada y aprobación administrativa.
            </div>
            <p className="text-sm">
              Paciente: <strong>{patientName}</strong> (MRN {patientMrn})
            </p>
            <p className="text-sm">
              Causa básica:{" "}
              <strong className="font-mono">{state.basic.code}</strong>{" "}
              — {state.basic.desc}
            </p>
            <p className="text-sm">
              Fecha de fallecimiento:{" "}
              <strong>
                {state.occurredAt &&
                  new Date(state.occurredAt).toLocaleString("es-SV")}
              </strong>
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={create.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleFinalSubmit}
              disabled={create.isPending}
            >
              {create.isPending ? "Emitiendo…" : "Emitir certificado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

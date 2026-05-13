"use client";

/**
 * §15 Pharmacy — Crear receta.
 *
 * Form con array dinámico de items y búsqueda de medicamentos en línea
 * (debounce 300 ms). Valida en cliente con `prescriptionCreateInput` y
 * `prescriptionItemInput` de `@his/contracts` (single source); el server
 * re-valida.
 *
 * UX:
 *  - Cada item tiene su propio combobox-style search; al seleccionar se
 *    fija drugId y la query se desactiva hasta que el usuario edite.
 *  - Validación inline: al menos 1 item con drug + dosage + route +
 *    frequency. Errores se muestran por campo.
 *  - On success → router.push('/pharmacy'). On error → role="alert".
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
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
  prescriptionCreateInput,
  prescriptionItemInput,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

type Route =
  | "ORAL"
  | "IV"
  | "IM"
  | "SC"
  | "TOPICAL"
  | "INHALED"
  | "RECTAL"
  | "SUBLINGUAL"
  | "OPHTHALMIC"
  | "OTIC"
  | "NASAL";

const ROUTES: Array<{ value: Route; label: string }> = [
  { value: "ORAL", label: "Oral" },
  { value: "IV", label: "Intravenosa" },
  { value: "IM", label: "Intramuscular" },
  { value: "SC", label: "Subcutánea" },
  { value: "TOPICAL", label: "Tópica" },
  { value: "INHALED", label: "Inhalada" },
  { value: "RECTAL", label: "Rectal" },
  { value: "SUBLINGUAL", label: "Sublingual" },
  { value: "OPHTHALMIC", label: "Oftálmica" },
  { value: "OTIC", label: "Ótica" },
  { value: "NASAL", label: "Nasal" },
];

interface ItemDraft {
  /** clave React local; no se envía al server */
  key: string;
  drugId: string;
  drugLabel: string;
  search: string;
  dosage: string;
  route: Route;
  frequency: string;
  durationDays: string;
  prnAsNeeded: boolean;
  notes: string;
}

interface DrugHit {
  id: string;
  genericName: string;
  brandName?: string | null;
  strengthValue?: string | number | null;
  strengthUnit?: string | null;
}

let _key = 0;
const nextKey = () => `it_${Date.now()}_${++_key}`;

const emptyItem = (): ItemDraft => ({
  key: nextKey(),
  drugId: "",
  drugLabel: "",
  search: "",
  dosage: "",
  route: "ORAL",
  frequency: "",
  durationDays: "",
  prnAsNeeded: false,
  notes: "",
});

export default function NewPrescriptionPage(): React.ReactElement {
  const router = useRouter();
  const [encounterId, setEncounterId] = React.useState("");
  const [patientId, setPatientId] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [items, setItems] = React.useState<ItemDraft[]>([emptyItem()]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const createMutation = trpcAny.pharmacy.prescription.create.useMutation({
    onSuccess: () => router.push("/pharmacy"),
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const updateItem = (key: string, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  };

  const removeItem = (key: string) => {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((it) => it.key !== key)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const fe: Record<string, string> = {};

    if (!encounterId.trim()) fe.encounterId = "encounterId requerido.";
    if (!patientId.trim()) fe.patientId = "patientId requerido.";
    if (items.length === 0) fe.items = "Debe agregar al menos un medicamento.";

    const payloadItems = items.map((it, idx) => {
      const candidate = {
        drugId: it.drugId,
        dosage: it.dosage.trim(),
        route: it.route,
        frequency: it.frequency.trim(),
        ...(it.durationDays.trim()
          ? { durationDays: Number(it.durationDays) }
          : {}),
        prnAsNeeded: it.prnAsNeeded,
        ...(it.notes.trim() ? { notes: it.notes.trim() } : {}),
      };
      const parsed = prescriptionItemInput.safeParse(candidate);
      if (!parsed.success) {
        for (const issue of parsed.error.errors) {
          const k = `item_${idx}_${String(issue.path[0] ?? "_")}`;
          if (!fe[k]) fe[k] = issue.message;
        }
        return null;
      }
      return parsed.data;
    });

    if (Object.keys(fe).length > 0 || payloadItems.some((p) => p === null)) {
      setErrors(fe);
      return;
    }

    const candidate = {
      encounterId: encounterId.trim(),
      patientId: patientId.trim(),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      items: payloadItems as Array<NonNullable<(typeof payloadItems)[number]>>,
    };

    const parsed = prescriptionCreateInput.safeParse(candidate);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const k = String(issue.path[0] ?? "_");
        if (!errs[k]) errs[k] = issue.message;
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    createMutation.mutate(parsed.data);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva receta</h1>
        <p className="text-sm text-muted-foreground">
          Agregue uno o más medicamentos. La firma se realiza en el detalle.
        </p>
      </div>

      <Form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Encabezado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField>
                <Label htmlFor="encounterId">
                  Encuentro <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="encounterId"
                  value={encounterId}
                  onChange={(e) => setEncounterId(e.target.value)}
                  aria-invalid={Boolean(errors.encounterId)}
                  placeholder="encounterId"
                />
                <FormError>{errors.encounterId}</FormError>
              </FormField>
              <FormField>
                <Label htmlFor="patientId">
                  Paciente <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="patientId"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  aria-invalid={Boolean(errors.patientId)}
                  placeholder="patientId"
                />
                <FormError>{errors.patientId}</FormError>
              </FormField>
              <FormField className="md:col-span-2">
                <Label htmlFor="notes">Notas</Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Indicaciones generales, alergias relevantes…"
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Medicamentos</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setItems((prev) => [...prev, emptyItem()])}
              >
                + Agregar medicamento
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {items.map((item, idx) => (
              <PrescriptionItemRow
                key={item.key}
                item={item}
                index={idx}
                errors={errors}
                onChange={(patch) => updateItem(item.key, patch)}
                onRemove={() => removeItem(item.key)}
                canRemove={items.length > 1}
              />
            ))}
            {errors.items ? <FormError>{errors.items}</FormError> : null}
          </CardContent>
        </Card>

        {serverError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {serverError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/pharmacy")}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Guardando…" : "Crear receta"}
          </Button>
        </div>
      </Form>
    </div>
  );
}

interface PrescriptionItemRowProps {
  item: ItemDraft;
  index: number;
  errors: Record<string, string>;
  onChange: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function PrescriptionItemRow({
  item,
  index,
  errors,
  onChange,
  onRemove,
  canRemove,
}: PrescriptionItemRowProps): React.ReactElement {
  const [debouncedSearch, setDebouncedSearch] = React.useState(item.search);
  const [showDropdown, setShowDropdown] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(item.search), 300);
    return () => clearTimeout(t);
  }, [item.search]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const drugQuery = trpcAny.pharmacy.drug.list.useQuery(
    { search: debouncedSearch },
    {
      enabled: debouncedSearch.trim().length >= 2 && !item.drugId,
      staleTime: 30_000,
    },
  );

  const hits = ((drugQuery.data?.items ?? drugQuery.data ?? []) as DrugHit[]).slice(0, 8);

  const drugErr = errors[`item_${index}_drugId`];
  const dosageErr = errors[`item_${index}_dosage`];
  const routeErr = errors[`item_${index}_route`];
  const freqErr = errors[`item_${index}_frequency`];
  const durErr = errors[`item_${index}_durationDays`];

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Medicamento #{index + 1}</h3>
        {canRemove ? (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            Eliminar ítem
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField className="md:col-span-2">
          <Label htmlFor={`drug-search-${item.key}`}>
            Medicamento <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <Input
              id={`drug-search-${item.key}`}
              value={item.drugId ? item.drugLabel : item.search}
              onChange={(e) => {
                onChange({
                  search: e.target.value,
                  drugId: "",
                  drugLabel: "",
                });
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Buscar (mín. 2 caracteres)…"
              autoComplete="off"
              aria-invalid={Boolean(drugErr)}
              aria-expanded={showDropdown}
              role="combobox"
              aria-controls={`drug-list-${item.key}`}
            />
            {showDropdown && !item.drugId && debouncedSearch.trim().length >= 2 ? (
              <ul
                id={`drug-list-${item.key}`}
                role="listbox"
                className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-background shadow-lg"
              >
                {drugQuery.isLoading ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    Buscando…
                  </li>
                ) : hits.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    Sin resultados.
                  </li>
                ) : (
                  hits.map((d) => (
                    <li key={d.id} role="option" aria-selected={false}>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const strength =
                            d.strengthValue != null && d.strengthUnit
                              ? `${d.strengthValue}${d.strengthUnit}`
                              : "";
                          const label = [
                            d.genericName,
                            d.brandName ? `(${d.brandName})` : "",
                            strength,
                          ]
                            .filter(Boolean)
                            .join(" ");
                          onChange({
                            drugId: d.id,
                            drugLabel: label,
                            search: label,
                          });
                          setShowDropdown(false);
                        }}
                      >
                        <span className="font-medium">{d.genericName}</span>
                        <span className="text-xs text-muted-foreground">
                          {d.brandName ? `${d.brandName} · ` : ""}
                          {d.strengthValue != null && d.strengthUnit
                            ? `${d.strengthValue}${d.strengthUnit}`
                            : "—"}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </div>
          <FormHint>Buscar por nombre genérico o comercial.</FormHint>
          <FormError>{drugErr}</FormError>
        </FormField>

        <FormField>
          <Label htmlFor={`dosage-${item.key}`}>
            Dosificación <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`dosage-${item.key}`}
            value={item.dosage}
            onChange={(e) => onChange({ dosage: e.target.value })}
            placeholder="500mg cada 8h"
            aria-invalid={Boolean(dosageErr)}
          />
          <FormError>{dosageErr}</FormError>
        </FormField>

        <FormField>
          <Label htmlFor={`route-${item.key}`}>
            Vía <span className="text-destructive">*</span>
          </Label>
          <Select
            value={item.route}
            onValueChange={(v) => onChange({ route: v as Route })}
          >
            <SelectTrigger id={`route-${item.key}`} aria-invalid={Boolean(routeErr)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROUTES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormError>{routeErr}</FormError>
        </FormField>

        <FormField>
          <Label htmlFor={`freq-${item.key}`}>
            Frecuencia <span className="text-destructive">*</span>
          </Label>
          <Input
            id={`freq-${item.key}`}
            value={item.frequency}
            onChange={(e) => onChange({ frequency: e.target.value })}
            placeholder="cada 8 horas"
            aria-invalid={Boolean(freqErr)}
          />
          <FormError>{freqErr}</FormError>
        </FormField>

        <FormField>
          <Label htmlFor={`dur-${item.key}`}>Duración (días)</Label>
          <Input
            id={`dur-${item.key}`}
            type="number"
            min="1"
            value={item.durationDays}
            onChange={(e) => onChange({ durationDays: e.target.value })}
            aria-invalid={Boolean(durErr)}
          />
          <FormError>{durErr}</FormError>
        </FormField>

        <FormField className="md:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={item.prnAsNeeded}
              onChange={(e) => onChange({ prnAsNeeded: e.target.checked })}
            />
            PRN (sólo si es necesario)
          </label>
        </FormField>

        <FormField className="md:col-span-2">
          <Label htmlFor={`notes-${item.key}`}>Notas del ítem</Label>
          <textarea
            id={`notes-${item.key}`}
            value={item.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Indicaciones específicas para este medicamento…"
          />
        </FormField>
      </div>
    </div>
  );
}

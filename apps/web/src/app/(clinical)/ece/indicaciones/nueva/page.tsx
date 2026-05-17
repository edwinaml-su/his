"use client";

/**
 * ECE — Nueva indicación médica (wizard 3 pasos).
 *
 * Paso 1 — Datos generales: episodioId, observaciones.
 * Paso 2 — Items: array editable de medicamentos con typeahead.
 * Paso 3 — Revisión + firma MC (PIN).
 *
 * UX:
 *  - Typeahead medicamento: debounce 300 ms, búsqueda >= 2 chars,
 *    combobox accesible (role=combobox + listbox).
 *  - useFieldArray simulado con estado local (sin react-hook-form peer
 *    dep extra — patrón ya establecido en /pharmacy/new).
 *  - Validación client-side antes de llamar la mutation.
 *  - On success → router.push('/ece/indicaciones').
 *
 * El router trpc.eceIndicaciones.create está en merge pendiente;
 * se castea con eslint-disable siguiendo el patrón del proyecto.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Form, FormError, FormField } from "@his/ui/components/form";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type Via =
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

const VIAS: Array<{ value: Via; label: string }> = [
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
  /** clave React local */
  key: string;
  medicamentoId: string;
  medicamentoNombre: string;
  search: string;
  dosis: string;
  via: Via;
  frecuencia: string;
  duracionDias: string;
  observaciones: string;
}

interface MedicamentoHit {
  id: string;
  genericName: string;
  brandName?: string | null;
  strengthValue?: string | number | null;
  strengthUnit?: string | null;
}

let _key = 0;
const nextKey = () => `im_${Date.now()}_${++_key}`;

const emptyItem = (): ItemDraft => ({
  key: nextKey(),
  medicamentoId: "",
  medicamentoNombre: "",
  search: "",
  dosis: "",
  via: "ORAL",
  frecuencia: "",
  duracionDias: "",
  observaciones: "",
});

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3;

export default function NuevaIndicacionPage(): React.ReactElement {
  const router = useRouter();

  // --- Paso 1 ---
  const [episodioId, setEpisodioId] = React.useState("");
  const [observaciones, setObservaciones] = React.useState("");

  // --- Paso 2 ---
  const [items, setItems] = React.useState<ItemDraft[]>([emptyItem()]);

  // --- Paso 3 (firma) ---
  const [pin, setPin] = React.useState("");

  const [step, setStep] = React.useState<Step>(1);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);


  const createMutation = trpc.eceIndicaciones?.create?.useMutation?.({
    onSuccess: () => router.push("/ece/indicaciones"),
    onError: (err: { message: string }) => setServerError(err.message),
  }) ?? { mutate: () => void 0, isPending: false };

  // ---------------------------------------------------------------------------
  // Helpers items
  // ---------------------------------------------------------------------------

  const updateItem = (key: string, patch: Partial<ItemDraft>) =>
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );

  const removeItem = (key: string) =>
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((it) => it.key !== key),
    );

  // ---------------------------------------------------------------------------
  // Validaciones por paso
  // ---------------------------------------------------------------------------

  const validateStep1 = (): boolean => {
    const fe: Record<string, string> = {};
    if (!episodioId.trim()) fe.episodioId = "Episodio requerido.";
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const validateStep2 = (): boolean => {
    const fe: Record<string, string> = {};
    if (items.length === 0) fe.items = "Debe agregar al menos un medicamento.";
    items.forEach((it, idx) => {
      if (!it.medicamentoId)
        fe[`item_${idx}_medicamento`] = "Seleccione un medicamento.";
      if (!it.dosis.trim())
        fe[`item_${idx}_dosis`] = "Dosis requerida.";
      if (!it.frecuencia.trim())
        fe[`item_${idx}_frecuencia`] = "Frecuencia requerida.";
    });
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const validateStep3 = (): boolean => {
    const fe: Record<string, string> = {};
    if (pin.trim().length < 6) fe.pin = "PIN de mínimo 6 caracteres.";
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  // ---------------------------------------------------------------------------
  // Navegación wizard
  // ---------------------------------------------------------------------------

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
  };

  const handleBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep3()) return;
    setServerError(null);

    // El router espera `medicamentoCodigo` (no `medicamentoId`) y
    // `duracionDias` numérico requerido. El PIN se gestiona vía flow firma
    // electrónica separada — aquí no se envía al router.
    void pin;
    createMutation.mutate({
      episodioId: episodioId.trim(),
      observaciones: observaciones.trim() || undefined,
      items: items.map((it) => ({
        medicamentoCodigo: it.medicamentoId,
        dosis: it.dosis.trim(),
        via: it.via,
        frecuencia: it.frecuencia.trim(),
        duracionDias: it.duracionDias ? Number(it.duracionDias) : 1,
        observaciones: it.observaciones.trim() || undefined,
      })),
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva indicación médica</h1>
        <p className="text-sm text-muted-foreground">
          Complete los datos del episodio, agregue los medicamentos y firme.
        </p>
      </div>

      {/* Indicador de pasos */}
      <nav aria-label="Pasos del formulario">
        <ol className="flex items-center gap-0">
          {(
            [
              { n: 1, label: "Datos generales" },
              { n: 2, label: "Medicamentos" },
              { n: 3, label: "Revisión y firma" },
            ] as const
          ).map(({ n, label }, idx, arr) => (
            <React.Fragment key={n}>
              <li className="flex flex-col items-center gap-1 text-center">
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                    step === n
                      ? "bg-primary text-primary-foreground"
                      : step > n
                        ? "bg-primary/60 text-primary-foreground"
                        : "border-2 border-muted-foreground/30 text-muted-foreground/50",
                  ].join(" ")}
                  aria-current={step === n ? "step" : undefined}
                >
                  {n}
                </span>
                <span className="text-xs">{label}</span>
              </li>
              {idx < arr.length - 1 ? (
                <div
                  className="h-px flex-1 bg-border mx-2"
                  aria-hidden="true"
                />
              ) : null}
            </React.Fragment>
          ))}
        </ol>
      </nav>

      <Form onSubmit={step === 3 ? handleSubmit : (e) => e.preventDefault()}>
        {/* ------------------------------------------------------------------ */}
        {/* Paso 1 — Datos generales */}
        {/* ------------------------------------------------------------------ */}
        {step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Datos generales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4">
                <FormField>
                  <Label htmlFor="episodioId">
                    Episodio <span className="text-destructive">*</span>
                  </Label>
                  <input
                    id="episodioId"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
                    value={episodioId}
                    onChange={(e) => setEpisodioId(e.target.value)}
                    aria-invalid={Boolean(errors.episodioId)}
                    placeholder="UUID del episodio activo"
                    data-testid="input-episodio-id"
                  />
                  <FormError>{errors.episodioId}</FormError>
                </FormField>
                <FormField>
                  <Label htmlFor="observaciones">Observaciones generales</Label>
                  <textarea
                    id="observaciones"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    rows={3}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="Alergias relevantes, indicaciones de soporte…"
                  />
                </FormField>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* ------------------------------------------------------------------ */}
        {/* Paso 2 — Items de medicamentos */}
        {/* ------------------------------------------------------------------ */}
        {step === 2 ? (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Medicamentos</CardTitle>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setItems((prev) => [...prev, emptyItem()])
                  }
                  data-testid="btn-agregar-medicamento"
                >
                  + Agregar medicamento
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {items.map((item, idx) => (
                <IndicacionItemRow
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
        ) : null}

        {/* ------------------------------------------------------------------ */}
        {/* Paso 3 — Revisión + firma MC */}
        {/* ------------------------------------------------------------------ */}
        {step === 3 ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Revisión</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm">
                  <span className="font-medium">Episodio:</span>{" "}
                  <span className="font-mono">{episodioId}</span>
                </p>
                {observaciones ? (
                  <p className="text-sm">
                    <span className="font-medium">Observaciones:</span>{" "}
                    {observaciones}
                  </p>
                ) : null}
                <p className="text-sm font-medium">
                  {items.length} medicamento(s):
                </p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {items.map((it, idx) => (
                    <li key={it.key} className="rounded-md border px-3 py-2">
                      <span className="font-medium text-foreground">
                        #{idx + 1} {it.medicamentoNombre || it.search || "—"}
                      </span>
                      {" · "}
                      {it.dosis} · {it.via} · {it.frecuencia}
                      {it.duracionDias ? ` · ${it.duracionDias} días` : ""}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Firma electrónica MC</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField>
                  <Label htmlFor="pin-firma">
                    PIN de firma <span className="text-destructive">*</span>
                  </Label>
                  <input
                    id="pin-firma"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={12}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="flex h-9 w-48 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-describedby="pin-hint"
                    aria-invalid={Boolean(errors.pin)}
                    data-testid="input-pin-firma"
                  />
                  <p
                    id="pin-hint"
                    className="text-xs text-muted-foreground"
                  >
                    PIN de 6–12 dígitos registrado en su perfil.
                  </p>
                  <FormError>{errors.pin}</FormError>
                </FormField>
              </CardContent>
            </Card>
          </>
        ) : null}

        {serverError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {serverError}
          </p>
        ) : null}

        {/* Controles de navegación */}
        <div className="flex justify-between gap-2">
          <div>
            {step > 1 ? (
              <Button type="button" variant="outline" onClick={handleBack}>
                Atrás
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/ece/indicaciones")}
              >
                Cancelar
              </Button>
            )}
          </div>
          <div>
            {step < 3 ? (
              <Button type="button" onClick={handleNext}>
                Siguiente
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={createMutation.isPending}
                data-testid="btn-crear-indicacion"
              >
                {createMutation.isPending
                  ? "Guardando…"
                  : "Crear y firmar indicación"}
              </Button>
            )}
          </div>
        </div>
      </Form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente fila de item (typeahead medicamento)
// ---------------------------------------------------------------------------

interface IndicacionItemRowProps {
  item: ItemDraft;
  index: number;
  errors: Record<string, string>;
  onChange: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function IndicacionItemRow({
  item,
  index,
  errors,
  onChange,
  onRemove,
  canRemove,
}: IndicacionItemRowProps): React.ReactElement {
  const [debouncedSearch, setDebouncedSearch] = React.useState(item.search);
  const [showDropdown, setShowDropdown] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(item.search), 300);
    return () => clearTimeout(t);
  }, [item.search]);

  const medQuery = trpc.pharmacy?.drug?.list?.useQuery?.(
    { search: debouncedSearch },
    {
      enabled: debouncedSearch.trim().length >= 2 && !item.medicamentoId,
      staleTime: 30_000,
    },
  ) ?? { data: undefined, isLoading: false };

  // Router devuelve array directo; el shape paginated era especulación.
  const hits = ((medQuery.data ?? []) as unknown as MedicamentoHit[]).slice(0, 8);

  const medErr = errors[`item_${index}_medicamento`];
  const dosisErr = errors[`item_${index}_dosis`];
  const freqErr = errors[`item_${index}_frecuencia`];

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Medicamento #{index + 1}
        </h3>
        {canRemove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={`Eliminar medicamento ${index + 1}`}
          >
            Eliminar
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Typeahead medicamento */}
        <FormField className="md:col-span-2">
          <Label htmlFor={`med-search-${item.key}`}>
            Medicamento <span className="text-destructive">*</span>
          </Label>
          <div className="relative">
            <input
              id={`med-search-${item.key}`}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
              value={
                item.medicamentoId ? item.medicamentoNombre : item.search
              }
              onChange={(e) => {
                onChange({
                  search: e.target.value,
                  medicamentoId: "",
                  medicamentoNombre: "",
                });
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() =>
                setTimeout(() => setShowDropdown(false), 150)
              }
              placeholder="Buscar (mín. 2 caracteres)…"
              autoComplete="off"
              aria-invalid={Boolean(medErr)}
              aria-expanded={showDropdown && !item.medicamentoId}
              role="combobox"
              aria-controls={`med-list-${item.key}`}
              aria-autocomplete="list"
              data-testid={`med-search-${index}`}
            />
            {showDropdown &&
            !item.medicamentoId &&
            debouncedSearch.trim().length >= 2 ? (
              <ul
                id={`med-list-${item.key}`}
                role="listbox"
                className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-background shadow-lg"
              >
                {medQuery.isLoading ? (
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
                            medicamentoId: d.id,
                            medicamentoNombre: label,
                            search: label,
                          });
                          setShowDropdown(false);
                        }}
                        data-testid={`med-option-${d.id}`}
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
          <FormError>{medErr}</FormError>
        </FormField>

        {/* Dosis */}
        <FormField>
          <Label htmlFor={`dosis-${item.key}`}>
            Dosis <span className="text-destructive">*</span>
          </Label>
          <input
            id={`dosis-${item.key}`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={item.dosis}
            onChange={(e) => onChange({ dosis: e.target.value })}
            placeholder="500mg"
            aria-invalid={Boolean(dosisErr)}
          />
          <FormError>{dosisErr}</FormError>
        </FormField>

        {/* Vía */}
        <FormField>
          <Label htmlFor={`via-${item.key}`}>
            Vía <span className="text-destructive">*</span>
          </Label>
          <Select
            value={item.via}
            onValueChange={(v) => onChange({ via: v as Via })}
          >
            <SelectTrigger id={`via-${item.key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIAS.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        {/* Frecuencia */}
        <FormField>
          <Label htmlFor={`freq-${item.key}`}>
            Frecuencia <span className="text-destructive">*</span>
          </Label>
          <input
            id={`freq-${item.key}`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={item.frecuencia}
            onChange={(e) => onChange({ frecuencia: e.target.value })}
            placeholder="cada 8 horas"
            aria-invalid={Boolean(freqErr)}
            data-testid={`input-frecuencia-${index}`}
          />
          <FormError>{freqErr}</FormError>
        </FormField>

        {/* Duración */}
        <FormField>
          <Label htmlFor={`dur-${item.key}`}>Duración (días)</Label>
          <input
            id={`dur-${item.key}`}
            type="number"
            min="1"
            max="365"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={item.duracionDias}
            onChange={(e) => onChange({ duracionDias: e.target.value })}
          />
        </FormField>

        {/* Observaciones del item */}
        <FormField className="md:col-span-2">
          <Label htmlFor={`obs-${item.key}`}>Observaciones del ítem</Label>
          <textarea
            id={`obs-${item.key}`}
            value={item.observaciones}
            onChange={(e) => onChange({ observaciones: e.target.value })}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Indicaciones específicas para este medicamento…"
          />
        </FormField>
      </div>
    </div>
  );
}

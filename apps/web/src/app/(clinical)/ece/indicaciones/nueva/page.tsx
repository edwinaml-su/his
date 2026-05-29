"use client";

/**
 * ECE — Nueva indicacion medica (CPOE multi-linea).
 *
 * Permite agregar N items con:
 *   - tipo: MEDICAMENTO | PROCEDIMIENTO | DIETA | CUIDADO_GENERAL | ESTUDIO
 *   - descripcion (texto libre)
 *   - Si tipo=MEDICAMENTO: dosis (texto), via (enum), frecuencia (enum)
 *
 * Flujo: Guardar borrador / Firmar directo (PHYSICIAN).
 * Redirige a /ece/indicaciones tras exito.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type TipoIndicacion =
  | "MEDICAMENTO"
  | "PROCEDIMIENTO"
  | "DIETA"
  | "CUIDADO_GENERAL"
  | "ESTUDIO";

type ViaAdmin =
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

type Frecuencia =
  | "QD"
  | "BID"
  | "TID"
  | "QID"
  | "Q4H"
  | "Q6H"
  | "Q8H"
  | "Q12H"
  | "Q24H"
  | "STAT"
  | "PRN";

const TIPOS: Array<{ value: TipoIndicacion; label: string }> = [
  { value: "MEDICAMENTO", label: "Medicamento" },
  { value: "PROCEDIMIENTO", label: "Procedimiento" },
  { value: "DIETA", label: "Dieta" },
  { value: "CUIDADO_GENERAL", label: "Cuidado general" },
  { value: "ESTUDIO", label: "Estudio" },
];

const VIAS: Array<{ value: ViaAdmin; label: string }> = [
  { value: "ORAL", label: "Oral" },
  { value: "IV", label: "Intravenosa" },
  { value: "IM", label: "Intramuscular" },
  { value: "SC", label: "Subcutanea" },
  { value: "TOPICAL", label: "Topica" },
  { value: "INHALED", label: "Inhalada" },
  { value: "RECTAL", label: "Rectal" },
  { value: "SUBLINGUAL", label: "Sublingual" },
  { value: "OPHTHALMIC", label: "Oftalmica" },
  { value: "OTIC", label: "Otica" },
  { value: "NASAL", label: "Nasal" },
];

const FRECUENCIAS: Array<{ value: Frecuencia; label: string }> = [
  { value: "QD", label: "Una vez al dia (QD)" },
  { value: "BID", label: "Dos veces al dia (BID)" },
  { value: "TID", label: "Tres veces al dia (TID)" },
  { value: "QID", label: "Cuatro veces al dia (QID)" },
  { value: "Q4H", label: "Cada 4 horas (Q4H)" },
  { value: "Q6H", label: "Cada 6 horas (Q6H)" },
  { value: "Q8H", label: "Cada 8 horas (Q8H)" },
  { value: "Q12H", label: "Cada 12 horas (Q12H)" },
  { value: "Q24H", label: "Cada 24 horas (Q24H)" },
  { value: "STAT", label: "Inmediato (STAT)" },
  { value: "PRN", label: "Si necesario (PRN)" },
];

interface ItemDraft {
  key: string;
  tipo: TipoIndicacion;
  descripcion: string;
  dosis: string;
  via: ViaAdmin | "";
  frecuencia: Frecuencia | "";
  duracion: string;
}

let _key = 0;
const nextKey = () => `item_${Date.now()}_${++_key}`;

const emptyItem = (): ItemDraft => ({
  key: nextKey(),
  tipo: "MEDICAMENTO",
  descripcion: "",
  dosis: "",
  via: "ORAL",
  frecuencia: "QD",
  duracion: "",
});

// ─── Pagina ───────────────────────────────────────────────────────────────────

// Regex UUID v4 para validación cliente-side ANTES de enviar al server
// (evita roundtrip + error críptico).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function NuevaIndicacionPage(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  // episodioId viene de query param cuando se entra desde
  // /ece/episodio-hospitalario/[id] → botón "Nueva indicación".
  // Si no viene (acceso directo a /ece/indicaciones/nueva), el campo es
  // editable como fallback admin.
  const episodioIdFromUrl = searchParams.get("episodioId") ?? "";
  const [episodioId, setEpisodioId] = React.useState(episodioIdFromUrl);
  const isEpisodioFromUrl = episodioIdFromUrl.length > 0;
  const [items, setItems] = React.useState<ItemDraft[]>([emptyItem()]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  const createMutation = trpc.eceIndicaciones.create.useMutation({
    onSuccess: () => router.push("/ece/indicaciones"),
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const firmarMutation = trpc.eceIndicaciones.firmar.useMutation({
    onSuccess: () => router.push("/ece/indicaciones"),
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const updateItem = (key: string, patch: Partial<ItemDraft>) =>
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );

  const removeItem = (key: string) =>
    setItems((prev) =>
      prev.length === 1 ? prev : prev.filter((it) => it.key !== key),
    );

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    const epId = episodioId.trim();
    if (!epId) {
      fe.episodioId = "Episodio requerido (acceder desde el episodio hospitalario).";
    } else if (!UUID_RE.test(epId)) {
      fe.episodioId = "El identificador del episodio no es un UUID válido.";
    }
    if (items.length === 0) fe.items = "Agregue al menos un item.";
    items.forEach((it, idx) => {
      if (!it.descripcion.trim())
        fe[`desc_${idx}`] = "Descripcion requerida.";
    });
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const buildItems = () =>
    items.map((it) => ({
      tipo: it.tipo,
      descripcion: it.descripcion.trim(),
      dosis: it.tipo === "MEDICAMENTO" && it.dosis.trim() ? it.dosis.trim() : undefined,
      via: it.tipo === "MEDICAMENTO" && it.via ? (it.via as ViaAdmin) : undefined,
      frecuencia:
        it.tipo === "MEDICAMENTO" && it.frecuencia
          ? (it.frecuencia as Frecuencia)
          : undefined,
      duracion: it.duracion.trim() || undefined,
    }));

  // medicoPrescriptor lo resuelve el server desde ctx.user.id — no lo enviamos.
  // Override admin sólo necesario en flujos retroactivos (no expuestos aquí).
  const handleGuardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setServerError(null);
    createMutation.mutate({
      episodioId: episodioId.trim(),
      items: buildItems(),
    });
  };

  const handleFirmar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setServerError(null);
    // Primero crear, luego firmar en secuencia
    createMutation.mutate(
      {
        episodioId: episodioId.trim(),
        items: buildItems(),
      },
      {
        onSuccess: (data: { id: string }) => {
          firmarMutation.mutate({ id: data.id });
        },
      },
    );
  };

  const isPending = createMutation.isPending || firmarMutation.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva indicacion medica</h1>
        <p className="text-sm text-muted-foreground">
          Prescripcion CPOE multi-linea (NTEC Doc 6).
        </p>
      </div>

      <form onSubmit={handleGuardar} className="space-y-4">
        {/* Datos generales */}
        <Card>
          <CardHeader>
            <CardTitle>Datos generales</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="episodioId">
                Episodio <span className="text-destructive">*</span>
              </Label>
              <input
                id="episodioId"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-60"
                value={episodioId}
                onChange={(e) => setEpisodioId(e.target.value)}
                placeholder={isEpisodioFromUrl ? undefined : "Pegue el UUID del episodio (acceso admin)"}
                aria-invalid={Boolean(errors.episodioId)}
                data-testid="input-episodio-id"
                readOnly={isEpisodioFromUrl}
                disabled={isEpisodioFromUrl}
              />
              {isEpisodioFromUrl ? (
                <p className="text-xs text-muted-foreground">
                  Episodio cargado desde la ficha hospitalaria.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Acceder desde &quot;Episodio hospitalario → Nueva indicación&quot; carga el episodio automáticamente.
                </p>
              )}
              {errors.episodioId ? (
                <p className="text-xs text-destructive">{errors.episodioId}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Médico prescriptor</Label>
              <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/50 px-3 py-1 text-sm text-muted-foreground">
                Usuario actual (resuelto automáticamente)
              </div>
              <p className="text-xs text-muted-foreground">
                La firma usa el usuario autenticado. Para registros retroactivos por terceros, contactar admin.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Items de la indicacion</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setItems((prev) => [...prev, emptyItem()])}
                data-testid="btn-agregar-item"
              >
                + Agregar otro item
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {items.map((item, idx) => (
              <ItemFormRow
                key={item.key}
                item={item}
                index={idx}
                errors={errors}
                onChange={(p) => updateItem(item.key, p)}
                onRemove={() => removeItem(item.key)}
                canRemove={items.length > 1}
              />
            ))}
            {errors.items ? (
              <p className="text-xs text-destructive">{errors.items}</p>
            ) : null}
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

        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/ece/indicaciones")}
          >
            Cancelar
          </Button>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="secondary"
              disabled={isPending}
              data-testid="btn-guardar-borrador"
            >
              {createMutation.isPending ? "Guardando…" : "Guardar borrador"}
            </Button>
            <Button
              type="button"
              disabled={isPending}
              onClick={(e) => handleFirmar(e as unknown as React.FormEvent)}
              data-testid="btn-crear-y-firmar"
            >
              {isPending ? "Procesando…" : "Crear y firmar"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ─── Fila de item ─────────────────────────────────────────────────────────────

interface ItemFormRowProps {
  item: ItemDraft;
  index: number;
  errors: Record<string, string>;
  onChange: (p: Partial<ItemDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ItemFormRow({
  item,
  index,
  errors,
  onChange,
  onRemove,
  canRemove,
}: ItemFormRowProps): React.ReactElement {
  const isMed = item.tipo === "MEDICAMENTO";

  return (
    <div className="rounded-md border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Item #{index + 1}</h3>
        {canRemove ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRemove}
            aria-label={`Eliminar item ${index + 1}`}
          >
            Eliminar
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Tipo */}
        <div className="space-y-1">
          <Label htmlFor={`tipo-${item.key}`}>Tipo</Label>
          <Select
            value={item.tipo}
            onValueChange={(v) => onChange({ tipo: v as TipoIndicacion })}
          >
            <SelectTrigger id={`tipo-${item.key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Descripcion */}
        <div className="space-y-1 md:col-span-1">
          <Label htmlFor={`desc-${item.key}`}>
            Descripcion <span className="text-destructive">*</span>
          </Label>
          <input
            id={`desc-${item.key}`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={item.descripcion}
            onChange={(e) => onChange({ descripcion: e.target.value })}
            placeholder="Ej: Paracetamol 500mg comprimido"
            aria-invalid={Boolean(errors[`desc_${index}`])}
            data-testid={`input-descripcion-${index}`}
          />
          {errors[`desc_${index}`] ? (
            <p className="text-xs text-destructive">{errors[`desc_${index}`]}</p>
          ) : null}
        </div>

        {/* Campos solo para MEDICAMENTO */}
        {isMed ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`dosis-${item.key}`}>Dosis</Label>
              <input
                id={`dosis-${item.key}`}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={item.dosis}
                onChange={(e) => onChange({ dosis: e.target.value })}
                placeholder="500mg"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor={`via-${item.key}`}>Via</Label>
              <Select
                value={item.via}
                onValueChange={(v) => onChange({ via: v as ViaAdmin })}
              >
                <SelectTrigger id={`via-${item.key}`}>
                  <SelectValue placeholder="Seleccionar via" />
                </SelectTrigger>
                <SelectContent>
                  {VIAS.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`freq-${item.key}`}>Frecuencia</Label>
              <Select
                value={item.frecuencia}
                onValueChange={(v) => onChange({ frecuencia: v as Frecuencia })}
              >
                <SelectTrigger id={`freq-${item.key}`}>
                  <SelectValue placeholder="Seleccionar frecuencia" />
                </SelectTrigger>
                <SelectContent>
                  {FRECUENCIAS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : null}

        {/* Duracion para todos */}
        <div className="space-y-1">
          <Label htmlFor={`dur-${item.key}`}>Duracion</Label>
          <input
            id={`dur-${item.key}`}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={item.duracion}
            onChange={(e) => onChange({ duracion: e.target.value })}
            placeholder="7 dias"
          />
        </div>
      </div>
    </div>
  );
}

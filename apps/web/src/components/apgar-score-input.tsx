"use client";

/**
 * ApgarScoreInput — captura interactiva del puntaje Apgar (1 y 5 minutos).
 *
 * Cinco categorías (Apariencia, Pulso, Grimace, Actividad, Respiración),
 * cada una 0-2 puntos. Total 0-10 con semáforo:
 *   ≥ 7  → verde   (normal)
 *   4-6  → ámbar   (depresión moderada)
 *   ≤ 3  → rojo    (depresión severa)
 *
 * Accesibilidad WCAG 2.2 AA:
 *   - Cada categoría en <fieldset> + <legend> visible.
 *   - Radio buttons con id únicos y <label> explícito via htmlFor.
 *   - Total anunciado via aria-live="polite".
 *   - Colores reforzados con texto (no solo semáforo de color).
 *
 * Reusado por: stream #11 (Atención RN) — puede recibir `minuteLabel`
 * para distinguir "1 min" / "5 min" / "10 min".
 */
import * as React from "react";

// ---------------------------------------------------------------------------
// Dominio
// ---------------------------------------------------------------------------

export type ApgarCategoryKey =
  | "appearance"
  | "pulse"
  | "grimace"
  | "activity"
  | "respiration";

export interface ApgarCategory {
  key: ApgarCategoryKey;
  label: string;
  descriptions: [string, string, string]; // índices 0, 1, 2
}

export const APGAR_CATEGORIES: readonly ApgarCategory[] = [
  {
    key: "appearance",
    label: "Apariencia (color de piel)",
    descriptions: ["Azul/pálido total", "Cuerpo rosado, extremidades azules", "Completamente rosado"],
  },
  {
    key: "pulse",
    label: "Pulso (frecuencia cardíaca)",
    descriptions: ["Ausente", "< 100 lpm", "≥ 100 lpm"],
  },
  {
    key: "grimace",
    label: "Grimace (respuesta a estímulo)",
    descriptions: ["Sin respuesta", "Mueca", "Llanto / estornudo / tos"],
  },
  {
    key: "activity",
    label: "Actividad (tono muscular)",
    descriptions: ["Flácido", "Flexión leve", "Movimiento activo"],
  },
  {
    key: "respiration",
    label: "Respiración",
    descriptions: ["Ausente", "Débil / irregular", "Llanto fuerte"],
  },
] as const;

export type ApgarScores = Record<ApgarCategoryKey, 0 | 1 | 2>;

/** Calcula total 0-10. Exportada para testeo puro. */
export function computeApgarTotal(scores: ApgarScores): number {
  return (Object.values(scores) as number[]).reduce((acc, v) => acc + v, 0);
}

/** Clasifica el total. Exportada para testeo puro. */
export type ApgarSeverity = "normal" | "moderate" | "severe";
export function classifySeverity(total: number): ApgarSeverity {
  if (total >= 7) return "normal";
  if (total >= 4) return "moderate";
  return "severe";
}

// ---------------------------------------------------------------------------
// Estilos por severidad — clases completas (Tailwind no hace safeList dinámico)
// ---------------------------------------------------------------------------

const SEVERITY_BADGE: Record<ApgarSeverity, string> = {
  normal: "bg-green-100 text-green-800 border-green-300",
  moderate: "bg-amber-100 text-amber-800 border-amber-300",
  severe: "bg-red-100 text-red-800 border-red-300",
};

const SEVERITY_LABEL: Record<ApgarSeverity, string> = {
  normal: "Normal",
  moderate: "Depresión moderada",
  severe: "Depresión severa",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ApgarScoreInputProps {
  /** Etiqueta de momento (ej. "1 min", "5 min"). */
  minuteLabel?: string;
  /** Valor controlado. Si se omite, el componente maneja estado interno. */
  value?: Partial<ApgarScores>;
  /** Callback cuando cambia cualquier categoría. */
  onChange?: (scores: ApgarScores) => void;
  /** Deshabilita todos los controles (ej. ya guardado). */
  disabled?: boolean;
}

const EMPTY_SCORES: ApgarScores = {
  appearance: 0,
  pulse: 0,
  grimace: 0,
  activity: 0,
  respiration: 0,
};

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ApgarScoreInput({
  minuteLabel,
  value,
  onChange,
  disabled = false,
}: ApgarScoreInputProps) {
  const [internal, setInternal] = React.useState<ApgarScores>(EMPTY_SCORES);

  // Modo controlado vs no-controlado
  const scores: ApgarScores = value
    ? { ...EMPTY_SCORES, ...value }
    : internal;

  function handleChange(key: ApgarCategoryKey, point: 0 | 1 | 2) {
    const next = { ...scores, [key]: point };
    if (!value) setInternal(next);
    onChange?.(next);
  }

  const total = computeApgarTotal(scores);
  const severity = classifySeverity(total);
  const titleId = React.useId();
  const liveId = React.useId();

  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <h3 id={titleId} className="text-base font-semibold">
        Puntaje Apgar{minuteLabel ? ` — ${minuteLabel}` : ""}
      </h3>

      {APGAR_CATEGORIES.map((cat) => (
        <CategoryFieldset
          key={cat.key}
          category={cat}
          selected={scores[cat.key]}
          disabled={disabled}
          onSelect={(v) => handleChange(cat.key, v)}
        />
      ))}

      {/* Total con anuncio ARIA */}
      <div
        id={liveId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-semibold ${SEVERITY_BADGE[severity]}`}
        data-testid="apgar-total"
      >
        <span>Total: {total}/10</span>
        <span aria-hidden="true">—</span>
        <span>{SEVERITY_LABEL[severity]}</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: fieldset por categoría
// ---------------------------------------------------------------------------

interface CategoryFieldsetProps {
  category: ApgarCategory;
  selected: 0 | 1 | 2;
  disabled: boolean;
  onSelect: (v: 0 | 1 | 2) => void;
}

function CategoryFieldset({
  category,
  selected,
  disabled,
  onSelect,
}: CategoryFieldsetProps) {
  const groupName = `apgar-${category.key}`;

  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-foreground">
        {category.label}
      </legend>
      <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
        {([0, 1, 2] as const).map((point) => {
          const id = `${groupName}-${point}`;
          return (
            <label
              key={point}
              htmlFor={id}
              className={`flex items-start gap-2 cursor-pointer rounded px-2 py-1 text-sm transition-colors hover:bg-muted/60 ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                id={id}
                name={groupName}
                value={point}
                checked={selected === point}
                disabled={disabled}
                onChange={() => onSelect(point)}
                className="mt-0.5 h-4 w-4 accent-primary"
                aria-label={`${category.label}: ${point} — ${category.descriptions[point]}`}
              />
              <span>
                <span className="font-semibold">{point}</span>
                <span className="ml-1 text-muted-foreground">
                  {category.descriptions[point]}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default ApgarScoreInput;

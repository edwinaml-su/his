"use client";

/**
 * Formulario de Time-Out quirúrgico (ADR 0003 — OMS Surgical Safety Checklist).
 *
 * El checklist OMS requiere verificación conjunta de cirujano, anestesiólogo
 * y enfermería. El router actual implementa un único `timeOutAt` (un solo usuario
 * confirma). Esta UI modela los 3 checkboxes locales como confirmación del flujo
 * pre-incisión; el botón llama a `surgery.case.timeOut` del router.
 *
 * NOTA ARQUITECTÓNICA: el ADR 0003 describe 3 firmas separadas en una tabla
 * `SurgeryTimeOut`, que no existe aún en schema. La UI captura los 3 checkboxes
 * como requisito visual (no pueden estar desmarcados), pero la mutación enviada
 * es un solo `timeOut`. Si @AS decide crear la tabla de firmas separada, el hook
 * en esta UI cambiará pero el contrato visual permanece.
 */
import * as React from "react";

export interface TimeoutChecklistItem {
  id: string;
  label: string;
  role: "SURGEON" | "ANESTHESIOLOGIST" | "NURSE";
}

const CHECKLIST_ITEMS: TimeoutChecklistItem[] = [
  {
    id: "timeout-surgeon",
    label: "Cirujano: identidad paciente, sitio quirúrgico y procedimiento verificados",
    role: "SURGEON",
  },
  {
    id: "timeout-anesthesia",
    label: "Anestesiología: vía aérea, alergias y profilaxis antibiótica verificadas",
    role: "ANESTHESIOLOGIST",
  },
  {
    id: "timeout-nurse",
    label: "Enfermería: instrumental estéril, implantes y estudios disponibles",
    role: "NURSE",
  },
];

export interface TimeoutFormProps {
  /** Si ya fue realizado el time-out (campo timeOutAt en el caso). */
  alreadyCompleted: boolean;
  completedAt?: Date | string | null;
  /** Callback al confirmar. Devuelve promesa para mostrar estado pending. */
  onConfirm: () => Promise<void>;
  isPending?: boolean;
}

/**
 * Devuelve true si todos los ítems están marcados. Función pura para tests.
 */
export function allItemsChecked(checked: Record<string, boolean>): boolean {
  return CHECKLIST_ITEMS.every((item) => checked[item.id] === true);
}

const timeFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" });

export function TimeoutForm({
  alreadyCompleted,
  completedAt,
  onConfirm,
  isPending = false,
}: TimeoutFormProps) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.id, alreadyCompleted])),
  );
  const [error, setError] = React.useState<string | null>(null);

  const allChecked = allItemsChecked(checked);

  if (alreadyCompleted && completedAt) {
    return (
      <div
        role="status"
        aria-label="Time-out completado"
        className="rounded-md border border-green-200 bg-green-50 p-4 space-y-1"
      >
        <p className="font-semibold text-green-800">Time-out OMS completado</p>
        <p className="text-sm text-green-700">
          Registrado el {timeFmt.format(new Date(completedAt))}
        </p>
      </div>
    );
  }

  async function handleConfirm() {
    setError(null);
    if (!allChecked) {
      setError("Deben completarse las 3 verificaciones antes de confirmar.");
      return;
    }
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al registrar time-out.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Verificar cada ítem del checklist OMS junto al equipo quirúrgico antes
        de proceder con la incisión.
      </p>
      <fieldset className="space-y-3">
        <legend className="sr-only">Verificaciones del time-out OMS</legend>
        {CHECKLIST_ITEMS.map((item) => (
          <div key={item.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              id={item.id}
              checked={checked[item.id] ?? false}
              onChange={(e) =>
                setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))
              }
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              aria-describedby={`${item.id}-role`}
            />
            <label htmlFor={item.id} className="text-sm leading-tight cursor-pointer">
              {item.label}
              <span id={`${item.id}-role`} className="sr-only">
                Rol: {item.role}
              </span>
            </label>
          </div>
        ))}
      </fieldset>

      {!allChecked && (
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {CHECKLIST_ITEMS.filter((i) => !checked[i.id]).length} verificación(es) pendiente(s)
        </p>
      )}

      {allChecked && (
        <p
          role="status"
          aria-live="polite"
          className="text-xs font-medium text-green-700"
          data-testid="timeout-all-ready"
        >
          Las 3 verificaciones completadas. Listo para confirmar.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!allChecked || isPending}
        aria-disabled={!allChecked || isPending}
        aria-label="Confirmar time-out OMS — disponible cuando las 3 verificaciones están marcadas"
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {isPending ? "Registrando…" : "Confirmar time-out"}
      </button>
    </div>
  );
}

"use client";

/**
 * PantallaGrid — grid controlado de visibilidad por pantalla (CC-0009).
 *
 * Réplica de `renderPagUI` del mockup: interruptor maestro "todas las pantallas"
 * + chips por pantalla. Componente controlado: emite el nuevo `scope`
 * (`"*"` = todas · `string[]` = específicas · `[]` = ninguna).
 */
import * as React from "react";
import styles from "./calc-admin.module.css";
import { cx } from "@/components/calculadoras/calc-shared";

export type PaginasScope = "*" | string[];
export interface PantallaItem {
  id: string;
  etiqueta: string;
}

export function PantallaGrid({
  value,
  pantallas,
  onChange,
}: {
  value: PaginasScope;
  pantallas: PantallaItem[];
  onChange: (scope: PaginasScope) => void;
}) {
  const all = value === "*";
  const arr = Array.isArray(value) ? value : [];
  const allIds = () => pantallas.map((p) => p.id);

  function setAll(on: boolean) {
    onChange(on ? "*" : allIds());
  }
  function toggle(id: string) {
    const base = all ? allIds() : arr;
    onChange(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  }

  return (
    <>
      <div className={styles.pgMaster}>
        <button
          type="button"
          className={cx(styles.sw, all && styles.on)}
          role="switch"
          aria-checked={all}
          aria-label="Aparece en todas las pantallas"
          onClick={() => setAll(!all)}
        />
        <div>
          <b>Aparece en todas las pantallas</b>
          <span>
            {all
              ? "Visible en cualquier pantalla del expediente"
              : "Elige las pantallas específicas abajo"}
          </span>
        </div>
      </div>
      <div className={styles.pgchips}>
        {pantallas.map((p) => {
          const on = all || arr.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className={cx(styles.pgchip, on && styles.on)}
              disabled={all}
              aria-pressed={on}
              onClick={() => toggle(p.id)}
            >
              {on ? "✓ " : ""}
              {p.etiqueta}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Etiqueta corta para el pill de la fila (Todas / N pantallas / Ninguna). */
export function pagLabel(scope: PaginasScope): string {
  if (scope === "*") return "Todas";
  if (!scope.length) return "Ninguna";
  return scope.length === 1 ? "1 pantalla" : `${scope.length} pantallas`;
}

/** Clase del pill según el scope (all / some / none). */
export function pagPillClass(scope: PaginasScope): "all" | "none" | "some" {
  if (scope === "*") return "all";
  return scope.length ? "some" : "none";
}

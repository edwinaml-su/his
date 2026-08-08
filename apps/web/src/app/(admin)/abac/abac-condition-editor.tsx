"use client";

/**
 * CC-0017 F2 — editor de condiciones ABAC (lista de predicados AND).
 *
 * Estado local por fila: `{ atributo, operador, texto, horarioDesde, horarioHasta }`.
 * `texto` se interpreta según el operador al construir el `AbacCondicion[]` final:
 *   - EN / NO_EN            → split por coma → string[]
 *   - IGUAL / DIFERENTE     → string tal cual
 *   - ENTRE_HORAS           → { desde: horarioDesde, hasta: horarioHasta } (ignora `texto`)
 *   - ES_VERDADERO/ES_FALSO → sin input — `valor: true` fijo (el operador ya es la semántica)
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import type { AbacCondicion } from "@his/contracts";

const ATRIBUTOS = [
  "rol",
  "establecimiento",
  "servicio",
  "horario",
  "pacienteConTriaje",
  "usuarioActivo",
  "esPropioPaciente",
] as const;

const OPERADORES = ["IGUAL", "DIFERENTE", "EN", "NO_EN", "ENTRE_HORAS", "ES_VERDADERO", "ES_FALSO"] as const;

interface FilaCondicion {
  key: string;
  atributo: (typeof ATRIBUTOS)[number];
  operador: (typeof OPERADORES)[number];
  texto: string;
  horarioDesde: string;
  horarioHasta: string;
}

let seq = 0;
function nuevaFila(base?: Partial<FilaCondicion>): FilaCondicion {
  seq += 1;
  return {
    key: `fila-${seq}`,
    atributo: base?.atributo ?? "rol",
    operador: base?.operador ?? "EN",
    texto: base?.texto ?? "",
    horarioDesde: base?.horarioDesde ?? "08:00",
    horarioHasta: base?.horarioHasta ?? "17:00",
  };
}

/** AbacCondicion[] → filas editables (para precargar en modo edición). */
export function condicionesAFilas(condiciones: AbacCondicion[]): FilaCondicion[] {
  return condiciones.map((c) => {
    if (c.operador === "ENTRE_HORAS" && typeof c.valor === "object" && !Array.isArray(c.valor)) {
      return nuevaFila({ atributo: c.atributo, operador: c.operador, horarioDesde: c.valor.desde, horarioHasta: c.valor.hasta });
    }
    const texto = Array.isArray(c.valor) ? c.valor.join(", ") : typeof c.valor === "string" ? c.valor : "";
    return nuevaFila({ atributo: c.atributo, operador: c.operador, texto });
  });
}

/** Filas editables → AbacCondicion[] (para enviar al router). */
export function filasACondiciones(filas: FilaCondicion[]): AbacCondicion[] {
  return filas.map((f): AbacCondicion => {
    if (f.operador === "ES_VERDADERO" || f.operador === "ES_FALSO") {
      return { atributo: f.atributo, operador: f.operador, valor: true };
    }
    if (f.operador === "ENTRE_HORAS") {
      return {
        atributo: "horario",
        operador: "ENTRE_HORAS",
        valor: { desde: f.horarioDesde, hasta: f.horarioHasta },
      };
    }
    if (f.operador === "EN" || f.operador === "NO_EN") {
      const valor = f.texto
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return { atributo: f.atributo, operador: f.operador, valor };
    }
    // IGUAL / DIFERENTE
    return { atributo: f.atributo, operador: f.operador, valor: f.texto.trim() };
  });
}

interface AbacConditionEditorProps {
  filas: FilaCondicion[];
  onChange: (filas: FilaCondicion[]) => void;
}

export type { FilaCondicion };

export function AbacConditionEditor({ filas, onChange }: AbacConditionEditorProps) {
  function update(key: string, patch: Partial<FilaCondicion>) {
    onChange(filas.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }
  function remove(key: string) {
    onChange(filas.filter((f) => f.key !== key));
  }

  return (
    <div className="space-y-2">
      {filas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin condiciones — la regla aplica incondicionalmente a todo el recurso/acción (AND vacío = siempre verdadero).
        </p>
      ) : null}

      {filas.map((f) => (
        <div key={f.key} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Select value={f.atributo} onValueChange={(v) => update(f.key, { atributo: v as FilaCondicion["atributo"] })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ATRIBUTOS.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={f.operador} onValueChange={(v) => update(f.key, { operador: v as FilaCondicion["operador"] })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OPERADORES.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {f.operador === "ENTRE_HORAS" ? (
            <div className="flex items-center gap-1 text-sm">
              <Input
                type="time"
                value={f.horarioDesde}
                onChange={(e) => update(f.key, { horarioDesde: e.target.value })}
                className="w-28"
              />
              <span className="text-muted-foreground">a</span>
              <Input
                type="time"
                value={f.horarioHasta}
                onChange={(e) => update(f.key, { horarioHasta: e.target.value })}
                className="w-28"
              />
            </div>
          ) : f.operador === "ES_VERDADERO" || f.operador === "ES_FALSO" ? (
            <span className="text-xs text-muted-foreground">(sin valor — el operador ya es la condición)</span>
          ) : (
            <Input
              value={f.texto}
              onChange={(e) => update(f.key, { texto: e.target.value })}
              placeholder={
                f.operador === "EN" || f.operador === "NO_EN"
                  ? "valores separados por coma (ej. medico, enfermeria)"
                  : "valor"
              }
              className="min-w-[220px] flex-1"
            />
          )}

          <Button type="button" size="sm" variant="ghost" onClick={() => remove(f.key)}>
            Quitar
          </Button>
        </div>
      ))}

      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...filas, nuevaFila()])}>
        + Agregar condición
      </Button>
    </div>
  );
}

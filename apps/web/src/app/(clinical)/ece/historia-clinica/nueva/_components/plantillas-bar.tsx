"use client";

/**
 * PlantillasBar — RF-04/RF-07.
 * Selector de plantillas + Aplicar / Guardar como plantilla / Eliminar.
 * Persistencia vía trpc.ecePlantillaTexto (por médico/org).
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";
import { toUpper } from "./utils";

type Campo = "ENFERMEDAD_ACTUAL" | "EXAMEN_FISICO";

interface PlantillasBarProps {
  campo: Campo;
  onApply: (texto: string) => void;
  currentText: string;
}

export function PlantillasBar({
  campo,
  onApply,
  currentText,
}: PlantillasBarProps) {
  const [selected, setSelected] = React.useState("");
  const [savingName, setSavingName] = React.useState("");
  const [showSaveInput, setShowSaveInput] = React.useState(false);

  const listQ = trpc.ecePlantillaTexto.list.useQuery({ campo });

  const createM = trpc.ecePlantillaTexto.create.useMutation({
    onSuccess: () => {
      setSavingName("");
      setShowSaveInput(false);
      void listQ.refetch();
    },
  });

  const deleteM = trpc.ecePlantillaTexto.eliminar.useMutation({
    onSuccess: () => {
      setSelected("");
      void listQ.refetch();
    },
  });

  const plantillas = listQ.data ?? [];

  function handleApply() {
    const p = plantillas.find((x) => x.id === selected);
    if (p) onApply(toUpper(p.contenido));
  }

  function handleSave() {
    if (!savingName.trim() || !currentText.trim()) return;
    createM.mutate({
      campo,
      titulo: toUpper(savingName.trim()),
      contenido: toUpper(currentText.trim()),
    });
  }

  function handleDelete() {
    if (!selected) return;
    deleteM.mutate({ id: selected });
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-input bg-surface-2 p-2.5">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-3.5 w-3.5"
        >
          <path d="M4 4h16v4H4zM4 12h16v8H4z" />
        </svg>
        Plantillas
      </span>
      <select
        className="h-8 min-w-[160px] flex-1 rounded-md border border-input bg-background px-2 text-xs"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={listQ.isLoading}
      >
        <option value="">— Seleccione una plantilla —</option>
        {plantillas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.titulo}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleApply}
        disabled={!selected}
        className="h-7 text-xs"
      >
        Aplicar
      </Button>
      {showSaveInput ? (
        <>
          <input
            className="h-7 rounded-md border border-input bg-background px-2 text-xs uppercase"
            placeholder="Nombre de la plantilla"
            value={savingName}
            onChange={(e) => setSavingName(e.target.value.toUpperCase())}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!savingName.trim() || createM.isPending}
            className="h-7 text-xs"
          >
            Guardar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowSaveInput(false)}
            className="h-7 text-xs"
          >
            ×
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowSaveInput(true)}
          className="h-7 text-xs"
        >
          Guardar como plantilla
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleDelete}
        disabled={!selected || deleteM.isPending}
        className="h-7 text-xs text-muted-foreground"
      >
        Eliminar
      </Button>
    </div>
  );
}

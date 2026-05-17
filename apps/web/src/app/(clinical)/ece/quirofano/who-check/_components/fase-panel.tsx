"use client";

/**
 * FasePanel — panel genérico para una fase del WHO Checklist.
 * Renderiza la lista de ítems con checkbox + responsable + timestamp.
 * El formulario emite onSubmit con los datos de la fase.
 */
import * as React from "react";
import { CheckSquare } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Checkbox } from "@his/ui/components/checkbox";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";

export interface WhoItemDef {
  clave: string;
  label: string;
  /** Si true, muestra un campo de texto adicional para observación. */
  conObservacion?: boolean;
}

export interface WhoItemValue {
  clave: string;
  label: string;
  verificado: boolean;
  observacion?: string;
}

interface FasePanelProps {
  titulo: string;
  subtitulo: string;
  items: WhoItemDef[];
  /** Si se proporciona, el panel está completo y muestra solo lectura. */
  completadoEn?: string;
  responsableNombre?: string;
  valoresIniciales?: WhoItemValue[];
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (data: {
    responsableNombre: string;
    items: WhoItemValue[];
  }) => void;
}

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function FasePanel({
  titulo,
  subtitulo,
  items,
  completadoEn,
  responsableNombre: responsableNombreCompletado,
  valoresIniciales,
  disabled = false,
  loading = false,
  onSubmit,
}: FasePanelProps) {
  const [responsable, setResponsable] = React.useState("");
  const [valores, setValores] = React.useState<WhoItemValue[]>(() =>
    items.map((item) => {
      const inicial = valoresIniciales?.find((v) => v.clave === item.clave);
      return {
        clave: item.clave,
        label: item.label,
        verificado: inicial?.verificado ?? false,
        observacion: inicial?.observacion ?? "",
      };
    }),
  );

  // Si la fase ya está completa, mostrar solo lectura
  if (completadoEn) {
    return (
      <Card className="border-green-500/50 bg-green-50/30 dark:border-green-700/40 dark:bg-green-950/20">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckSquare className="h-5 w-5 text-green-600" aria-hidden />
              {titulo}
            </CardTitle>
            <Badge variant="default" className="bg-green-600">
              Completado
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {responsableNombreCompletado} &mdash;{" "}
            {dateFmt.format(new Date(completadoEn))}
          </p>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {valoresIniciales?.map((v) => (
              <li key={v.clave} className="flex items-start gap-2 text-sm">
                <span
                  className={
                    v.verificado ? "text-green-600" : "text-destructive"
                  }
                  aria-hidden
                >
                  {v.verificado ? "✓" : "✗"}
                </span>
                <span className={v.verificado ? "" : "text-muted-foreground line-through"}>
                  {v.label}
                </span>
                {v.observacion ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({v.observacion})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  function handleToggle(clave: string) {
    setValores((prev) =>
      prev.map((v) =>
        v.clave === clave ? { ...v, verificado: !v.verificado } : v,
      ),
    );
  }

  function handleObservacion(clave: string, value: string) {
    setValores((prev) =>
      prev.map((v) =>
        v.clave === clave ? { ...v, observacion: value } : v,
      ),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!responsable.trim()) return;
    onSubmit({ responsableNombre: responsable.trim(), items: valores });
  }

  const allVerified = valores.every((v) => v.verificado);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckSquare className="h-5 w-5 text-primary" aria-hidden />
          {titulo}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{subtitulo}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Lista de ítems */}
          <ul className="space-y-3" aria-label={`Ítems ${titulo}`}>
            {valores.map((item, idx) => {
              const itemDef = items[idx];
              return (
                <li key={item.clave} className="flex flex-col gap-1.5">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`item-${item.clave}`}
                      checked={item.verificado}
                      onCheckedChange={() => handleToggle(item.clave)}
                      disabled={disabled}
                      aria-label={item.label}
                    />
                    <Label
                      htmlFor={`item-${item.clave}`}
                      className="cursor-pointer text-sm leading-snug"
                    >
                      {item.label}
                    </Label>
                  </div>
                  {itemDef?.conObservacion && (
                    <Input
                      placeholder="Observación (opcional)"
                      value={item.observacion ?? ""}
                      onChange={(e) =>
                        handleObservacion(item.clave, e.target.value)
                      }
                      disabled={disabled}
                      className="ml-7 h-7 text-xs"
                      aria-label={`Observación para ${item.label}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {/* Responsable */}
          <div className="space-y-1.5">
            <Label htmlFor="responsable-nombre">
              Nombre del responsable que verifica
            </Label>
            <Input
              id="responsable-nombre"
              placeholder="Nombre completo"
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
              disabled={disabled}
              required
            />
          </div>

          {!allVerified && (
            <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
              Todos los ítems deben verificarse antes de marcar como completo.
            </p>
          )}

          <Button
            type="submit"
            disabled={disabled || loading || !allVerified || !responsable.trim()}
            className="w-full"
          >
            {loading ? "Guardando…" : `Marcar ${titulo} completo`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

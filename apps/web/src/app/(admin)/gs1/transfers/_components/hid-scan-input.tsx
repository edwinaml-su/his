"use client";

/**
 * HidScanInput — captura scan de código GS1-128 / QR GS1 vía lector HID
 * (keyboard-wedge) o entrada manual, y emite el valor crudo al padre.
 *
 * Extraído de la duplicación exacta entre `transfers/nueva/page.tsx` y
 * `transfers/[id]/page.tsx` (inventario huérfanos 2026-08-26, patrón B).
 *
 * IMPORTANTE: NO es el `Gs1Scanner` de `@/components/gs1-scanner`. Ese
 * componente decodifica imágenes (cámara/upload) vía Web Worker y parsea la
 * cadena completa de Application Identifiers GS1 a un objeto estructurado
 * `Gs1Data` (GTIN+lote+vencimiento+serie). Este componente NO parsea AIs:
 * asume que el valor ya escaneado/tecleado es el identificador simple
 * esperado (GTIN, SSCC) tal como lo entrega un lector HID o el estándar
 * GS1-128 de un solo campo. El nombre distinto es intencional para no
 * sugerir equivalencia funcional entre ambos.
 *
 * En producción se conecta al evento `keydown` del lector HID (termina con
 * Enter). Por ahora es un input de texto que simula el scan.
 */

import * as React from "react";
import { Scan } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";

export interface HidScanInputProps {
  label: string;
  placeholder?: string;
  onScan: (value: string) => void;
  "aria-label"?: string;
  /** Texto de ayuda bajo el input (flujo "nueva transferencia"). */
  hint?: string;
  /**
   * "stacked" (label arriba, botón OK a la derecha del input, hint debajo)
   * o "inline" (label+input y botón en una sola fila). Cada valor replica
   * el layout que ya tenía cada consumidor antes de la extracción.
   */
  layout?: "stacked" | "inline";
}

export function HidScanInput({
  label,
  placeholder,
  onScan,
  "aria-label": ariaLabel,
  hint,
  layout = "stacked",
}: HidScanInputProps) {
  const [value, setValue] = React.useState("");
  const inputId = React.useId();

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Los lectores HID terminan con Enter
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) {
        onScan(value.trim());
        setValue("");
      }
    }
  }

  function confirm() {
    if (value.trim()) {
      onScan(value.trim());
      setValue("");
    }
  }

  const input = (
    <div className="relative flex-1">
      <Scan
        className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        id={inputId}
        className="pl-8 font-mono"
        placeholder={placeholder ?? "Escanear o escribir..."}
        aria-label={ariaLabel ?? label}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );

  const okButton = (
    <Button type="button" variant="outline" onClick={confirm} aria-label={`Confirmar ${label}`}>
      OK
    </Button>
  );

  if (layout === "inline") {
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={inputId}>{label}</Label>
          {input}
        </div>
        {okButton}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex gap-2">
        {input}
        {okButton}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

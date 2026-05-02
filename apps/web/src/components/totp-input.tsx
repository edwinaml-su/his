"use client";

/**
 * TotpInput — input de 6 dígitos con auto-tab y soporte de pegado.
 *
 * US-2.2 — MFA TOTP.
 *
 * Render:
 *   - 6 cajas <input inputMode="numeric" maxLength={1}> en línea.
 *   - Al teclear un dígito, el foco salta al siguiente. Al backspace en una
 *     caja vacía, vuelve al anterior.
 *   - Al pegar (`onPaste`), si el contenido son 6 dígitos los distribuye y
 *     dispara `onComplete` automáticamente.
 *   - El padre recibe el código completo vía `onChange(value)` y un callback
 *     `onComplete(value)` cuando los 6 dígitos están llenos.
 *
 * Accesibilidad:
 *   - Cada caja tiene `aria-label="Dígito N de 6"`.
 *   - El contenedor tiene `role="group"` con `aria-label="Código de
 *     verificación"` para que un lector de pantalla anuncie el grupo.
 *   - `autoComplete="one-time-code"` activa el autollenado iOS / Android.
 *
 * Variantes:
 *   - `length={6}` por defecto. Si quisiéramos exigir 8 dígitos para backup
 *     codes, el componente generaliza, pero la página `/mfa` usa este input
 *     solo para TOTP. Backup codes se ingresan en un <input> textual normal
 *     porque suelen pegarse desde una nota.
 *
 * El componente es PURO: no llama Server Actions ni fetch. El padre los
 * orquesta.
 */

import * as React from "react";

export type TotpInputProps = {
  /** Largo del código. Default 6 (TOTP estándar). */
  length?: number;
  /** Valor controlado. Si no se pasa, el componente se autogestiona. */
  value?: string;
  /** Llamado en cada cambio con el valor concatenado actual (parcial). */
  onChange?: (value: string) => void;
  /** Llamado cuando los `length` dígitos están llenos. */
  onComplete?: (value: string) => void;
  /** Deshabilita todos los inputs (durante verify request). */
  disabled?: boolean;
  /** Marca visualmente el input en error (rojo). */
  invalid?: boolean;
  /** Si true, autofoca la primera caja en mount. Default true. */
  autoFocus?: boolean;
  /** id base para asociar <Label htmlFor> con la primera caja. */
  id?: string;
};

export function TotpInput({
  length = 6,
  value: controlledValue,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = true,
  id,
}: TotpInputProps) {
  const [internal, setInternal] = React.useState<string[]>(
    () => Array.from({ length }, () => ""),
  );
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);

  // Sincroniza con `controlledValue` si el padre lo pasa.
  React.useEffect(() => {
    if (typeof controlledValue !== "string") return;
    const padded = controlledValue.padEnd(length, " ").slice(0, length);
    setInternal(padded.split("").map((ch) => (ch.trim() === "" ? "" : ch)));
  }, [controlledValue, length]);

  React.useEffect(() => {
    if (!autoFocus) return undefined;
    // setTimeout para evitar warning sobre focus durante render.
    const t = setTimeout(() => refs.current[0]?.focus(), 0);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const emit = React.useCallback(
    (next: string[]) => {
      const joined = next.join("");
      onChange?.(joined);
      if (joined.length === length && next.every((c) => c !== "")) {
        onComplete?.(joined);
      }
    },
    [length, onChange, onComplete],
  );

  const handleChange = (idx: number, raw: string) => {
    // Solo el último dígito tipeado importa; ignoramos lo no numérico.
    const ch = raw.replace(/\D/g, "").slice(-1);
    const next = [...internal];
    next[idx] = ch;
    setInternal(next);
    emit(next);
    if (ch && idx < length - 1) {
      refs.current[idx + 1]?.focus();
      refs.current[idx + 1]?.select();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (internal[idx]) {
        // Si esta caja tiene dígito, lo borra y se queda.
        const next = [...internal];
        next[idx] = "";
        setInternal(next);
        emit(next);
        e.preventDefault();
      } else if (idx > 0) {
        // Si está vacía, vuelve a la anterior y la borra.
        refs.current[idx - 1]?.focus();
        const next = [...internal];
        next[idx - 1] = "";
        setInternal(next);
        emit(next);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowLeft" && idx > 0) {
      refs.current[idx - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && idx < length - 1) {
      refs.current[idx + 1]?.focus();
      e.preventDefault();
    }
  };

  const handlePaste = (idx: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const data = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!data) return;
    e.preventDefault();
    const next = [...internal];
    for (let i = 0; i < length - idx && i < data.length; i++) {
      next[idx + i] = data[i]!;
    }
    setInternal(next);
    emit(next);
    // Mover foco al final del rango pegado o última caja.
    const focusIdx = Math.min(idx + data.length, length - 1);
    refs.current[focusIdx]?.focus();
  };

  return (
    <div
      role="group"
      aria-label="Código de verificación"
      className="flex items-center gap-2"
    >
      {Array.from({ length }).map((_, idx) => (
        <input
          key={idx}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          id={idx === 0 ? id : undefined}
          type="text"
          inputMode="numeric"
          autoComplete={idx === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Dígito ${idx + 1} de ${length}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={internal[idx] ?? ""}
          onChange={(e) => handleChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={(e) => handlePaste(idx, e)}
          className={[
            "h-12 w-10 rounded-md border bg-background text-center text-lg font-mono",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            invalid ? "border-destructive" : "border-input",
            disabled ? "opacity-60 cursor-not-allowed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ))}
    </div>
  );
}

export default TotpInput;

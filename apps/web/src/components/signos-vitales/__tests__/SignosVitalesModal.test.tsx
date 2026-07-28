// @vitest-environment jsdom
/**
 * Test smoke — SignosVitalesModal (wrapper Dialog, CC-0012).
 * Presentación pura: no toca tRPC (guardado vive en useSignosVitales,
 * inyectado por el caller vía onGuardar).
 */
import * as React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SignosVitalesModal } from "../SignosVitalesModal";
import { VITALES_FORM_EMPTY } from "../types";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignosVitalesModal", () => {
  it("no renderiza contenido cuando open=false", () => {
    render(
      <SignosVitalesModal
        open={false}
        onClose={vi.fn()}
        value={VITALES_FORM_EMPTY}
        onChange={vi.fn()}
        onGuardar={vi.fn()}
        bloqueado={false}
        showErrors={false}
      />,
    );
    expect(screen.queryByText("Signos vitales")).not.toBeInTheDocument();
  });

  it("renderiza el título y el núcleo obligatorio cuando open=true", () => {
    render(
      <SignosVitalesModal
        open
        onClose={vi.fn()}
        value={VITALES_FORM_EMPTY}
        onChange={vi.fn()}
        onGuardar={vi.fn()}
        bloqueado={false}
        showErrors={false}
      />,
    );
    expect(screen.getByText("Signos vitales")).toBeInTheDocument();
    expect(screen.getByLabelText(/TA Sistólica/i)).toBeInTheDocument();
  });

  it("botón Guardar signos invoca onGuardar", () => {
    const onGuardar = vi.fn();
    render(
      <SignosVitalesModal
        open
        onClose={vi.fn()}
        value={VITALES_FORM_EMPTY}
        onChange={vi.fn()}
        onGuardar={onGuardar}
        bloqueado={false}
        showErrors={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Guardar signos/i }));
    expect(onGuardar).toHaveBeenCalledOnce();
  });

  it("muestra el mensaje de error cuando showErrors && bloqueado", () => {
    render(
      <SignosVitalesModal
        open
        onClose={vi.fn()}
        value={VITALES_FORM_EMPTY}
        onChange={vi.fn()}
        onGuardar={vi.fn()}
        bloqueado
        showErrors
        mensajeError="Complete los signos vitales obligatorios."
      />,
    );
    expect(
      screen.getByText(/Complete los signos vitales obligatorios/),
    ).toBeInTheDocument();
  });

  it("botón Cancelar invoca onClose", () => {
    const onClose = vi.fn();
    render(
      <SignosVitalesModal
        open
        onClose={onClose}
        value={VITALES_FORM_EMPTY}
        onChange={vi.fn()}
        onGuardar={vi.fn()}
        bloqueado={false}
        showErrors={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

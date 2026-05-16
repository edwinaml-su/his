// @vitest-environment jsdom
/**
 * Tests unitarios para TimeoutForm.
 *
 * Verifica:
 * - Función pura `allItemsChecked`.
 * - Botón "Confirmar time-out" deshabilitado hasta que las 3 firmas estén marcadas.
 * - Al confirmar (con los 3 checks activos), llama onConfirm exactamente una vez.
 * - Cuando alreadyCompleted=true, muestra panel de "completado" y no el formulario.
 * - Si onConfirm rechaza, muestra el mensaje de error.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TimeoutForm, allItemsChecked } from "../timeout-form";

// ---- Función pura ----

describe("allItemsChecked", () => {
  it("devuelve false cuando ninguno está marcado", () => {
    expect(
      allItemsChecked({
        "timeout-surgeon": false,
        "timeout-anesthesia": false,
        "timeout-nurse": false,
      }),
    ).toBe(false);
  });

  it("devuelve false cuando solo 2 de 3 están marcados", () => {
    expect(
      allItemsChecked({
        "timeout-surgeon": true,
        "timeout-anesthesia": true,
        "timeout-nurse": false,
      }),
    ).toBe(false);
  });

  it("devuelve true cuando los 3 están marcados", () => {
    expect(
      allItemsChecked({
        "timeout-surgeon": true,
        "timeout-anesthesia": true,
        "timeout-nurse": true,
      }),
    ).toBe(true);
  });
});

// ---- Componente ----

describe("<TimeoutForm />", () => {
  beforeEach(() => {
    cleanup();
  });

  it("botón deshabilitado cuando no hay firmas marcadas", () => {
    render(
      <TimeoutForm
        alreadyCompleted={false}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const btn = screen.getByRole("button", { name: /confirmar time-out/i });
    expect(btn).toBeDisabled();
  });

  it("botón sigue deshabilitado con solo 2 de 3 checkboxes marcados", () => {
    render(
      <TimeoutForm
        alreadyCompleted={false}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);

    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    const btn = screen.getByRole("button", { name: /confirmar time-out/i });
    expect(btn).toBeDisabled();
  });

  it("habilita el botón al marcar los 3 checkboxes", () => {
    render(
      <TimeoutForm
        alreadyCompleted={false}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      fireEvent.click(cb);
    }

    const btn = screen.getByRole("button", { name: /confirmar time-out/i });
    expect(btn).not.toBeDisabled();

    // Mensaje "listo para confirmar" visible
    expect(screen.getByTestId("timeout-all-ready")).toBeInTheDocument();
  });

  it("llama onConfirm una vez al hacer click con las 3 firmas activas", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(<TimeoutForm alreadyCompleted={false} onConfirm={onConfirm} />);

    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      fireEvent.click(cb);
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirmar time-out/i }));
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("muestra error cuando onConfirm rechaza", async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error("Fallo de red"));

    render(<TimeoutForm alreadyCompleted={false} onConfirm={onConfirm} />);

    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      fireEvent.click(cb);
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirmar time-out/i }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Fallo de red");
  });

  it("muestra panel de completado cuando alreadyCompleted=true", () => {
    const completedAt = new Date("2026-05-16T10:30:00");
    render(
      <TimeoutForm
        alreadyCompleted
        completedAt={completedAt}
        onConfirm={vi.fn()}
      />,
    );

    // Status panel visible
    expect(screen.getByRole("status", { name: /time-out completado/i })).toBeInTheDocument();

    // No hay checkboxes ni botón de confirmar
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

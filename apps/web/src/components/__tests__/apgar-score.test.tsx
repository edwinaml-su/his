// @vitest-environment jsdom
/**
 * Tests unitarios — ApgarScoreInput y ApgarDisplay.
 *
 * Cubre:
 *   1. computeApgarTotal — suma correcta con puntajes extremos y mixtos.
 *   2. classifySeverity — fronteras ≤3 / 4-6 / ≥7.
 *   3. ApgarScoreInput — render de 5 fieldsets con sus legends.
 *   4. ApgarScoreInput — selección de radio actualiza el total visible.
 *   5. ApgarScoreInput — estado disabled bloquea radios.
 *   6. ApgarScoreInput — accesibilidad: cada radio tiene aria-label con descripción.
 *   7. ApgarDisplay — render con scores guardados, total y etiqueta de severidad.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  computeApgarTotal,
  classifySeverity,
  APGAR_CATEGORIES,
  type ApgarScores,
} from "../apgar-score-input";
import { ApgarScoreInput } from "../apgar-score-input";
import { ApgarDisplay } from "../apgar-display";

// ---------------------------------------------------------------------------
// 1. computeApgarTotal
// ---------------------------------------------------------------------------

describe("computeApgarTotal", () => {
  it("devuelve 0 cuando todos los puntajes son 0", () => {
    const scores: ApgarScores = {
      appearance: 0,
      pulse: 0,
      grimace: 0,
      activity: 0,
      respiration: 0,
    };
    expect(computeApgarTotal(scores)).toBe(0);
  });

  it("devuelve 10 cuando todos los puntajes son 2", () => {
    const scores: ApgarScores = {
      appearance: 2,
      pulse: 2,
      grimace: 2,
      activity: 2,
      respiration: 2,
    };
    expect(computeApgarTotal(scores)).toBe(10);
  });

  it("suma correctamente puntajes mixtos", () => {
    const scores: ApgarScores = {
      appearance: 1,
      pulse: 2,
      grimace: 0,
      activity: 1,
      respiration: 2,
    };
    expect(computeApgarTotal(scores)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 2. classifySeverity — fronteras
// ---------------------------------------------------------------------------

describe("classifySeverity", () => {
  it("≤ 3 → severe", () => {
    expect(classifySeverity(0)).toBe("severe");
    expect(classifySeverity(3)).toBe("severe");
  });

  it("4–6 → moderate", () => {
    expect(classifySeverity(4)).toBe("moderate");
    expect(classifySeverity(6)).toBe("moderate");
  });

  it("≥ 7 → normal", () => {
    expect(classifySeverity(7)).toBe("normal");
    expect(classifySeverity(10)).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// 3-6. <ApgarScoreInput />
// ---------------------------------------------------------------------------

describe("<ApgarScoreInput />", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renderiza 5 fieldsets con legend visible por cada categoría", () => {
    render(<ApgarScoreInput />);
    for (const cat of APGAR_CATEGORIES) {
      // legend debe ser visible (no sr-only) para WCAG 2.2
      expect(screen.getByText(cat.label)).toBeInTheDocument();
    }
  });

  it("cada radio tiene aria-label que incluye descripción del punto", () => {
    render(<ApgarScoreInput />);
    // Verifica que al menos un radio de cada categoría tiene aria-label
    const radios = screen.getAllByRole("radio");
    // 5 categorías × 3 opciones = 15 radios
    expect(radios).toHaveLength(15);
    for (const radio of radios) {
      expect(radio).toHaveAttribute("aria-label");
      expect((radio as HTMLInputElement).getAttribute("aria-label")!.length).toBeGreaterThan(5);
    }
  });

  it("selección de radio actualiza el total mostrado (onChange controlado)", () => {
    const onChange = vi.fn();
    render(<ApgarScoreInput onChange={onChange} />);

    // Selecciona "2" en la primera categoría (Apariencia — "Completamente rosado")
    const rosadoRadio = screen.getByRole("radio", {
      name: /Apariencia.*2.*Completamente rosado/i,
    });
    fireEvent.click(rosadoRadio);

    expect(onChange).toHaveBeenCalledTimes(1);
    const called = onChange.mock.calls[0]![0] as ApgarScores;
    expect(called.appearance).toBe(2);
  });

  it("estado disabled → todos los radios disabled", () => {
    render(<ApgarScoreInput disabled />);
    const radios = screen.getAllByRole("radio");
    for (const radio of radios) {
      expect(radio).toBeDisabled();
    }
  });

  it("total se refleja en el elemento con role=status", () => {
    // Valor controlado: 2+2+2+2+2 = 10
    const full: ApgarScores = {
      appearance: 2,
      pulse: 2,
      grimace: 2,
      activity: 2,
      respiration: 2,
    };
    render(<ApgarScoreInput value={full} />);
    const status = screen.getByTestId("apgar-total");
    expect(status).toHaveTextContent("10/10");
    expect(status).toHaveTextContent("Normal");
  });

  it("total 0 muestra severidad severa con texto 'Depresión severa'", () => {
    const zero: ApgarScores = {
      appearance: 0,
      pulse: 0,
      grimace: 0,
      activity: 0,
      respiration: 0,
    };
    render(<ApgarScoreInput value={zero} />);
    const status = screen.getByTestId("apgar-total");
    expect(status).toHaveTextContent("0/10");
    expect(status).toHaveTextContent("Depresión severa");
  });
});

// ---------------------------------------------------------------------------
// 7. <ApgarDisplay />
// ---------------------------------------------------------------------------

describe("<ApgarDisplay />", () => {
  beforeEach(() => {
    cleanup();
  });

  it("muestra el total y etiqueta de severidad correctos", () => {
    const scores: ApgarScores = {
      appearance: 1,
      pulse: 2,
      grimace: 1,
      activity: 2,
      respiration: 1,
    }; // total = 7 → normal
    render(<ApgarDisplay scores={scores} minuteLabel="1 min" />);

    const total = screen.getByTestId("apgar-display-total");
    expect(total).toHaveTextContent("7/10");
    expect(total).toHaveTextContent("Normal");
  });

  it("usa minuteLabel en el heading cuando se provee", () => {
    const scores: ApgarScores = {
      appearance: 0,
      pulse: 0,
      grimace: 0,
      activity: 0,
      respiration: 0,
    };
    render(<ApgarDisplay scores={scores} minuteLabel="5 min" />);
    expect(screen.getByText(/Apgar 5 min/i)).toBeInTheDocument();
  });
});

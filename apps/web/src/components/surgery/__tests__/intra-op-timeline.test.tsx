// @vitest-environment jsdom
/**
 * Tests unitarios para IntraOpTimeline.
 *
 * Verifica:
 * - `formatMilestoneTime` formatea correctamente fechas válidas y devuelve null para inválidas.
 * - Render con todos los timestamps null → todos muestran "Pendiente".
 * - Render con timestamps parciales → muestra fecha en los completados, "Pendiente" en los otros.
 * - Todos los timestamps presentes → muestra todos los valores.
 */
import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { IntraOpTimeline, formatMilestoneTime } from "../intra-op-timeline";

// ---- Función pura ----

describe("formatMilestoneTime", () => {
  it("devuelve null para undefined", () => {
    expect(formatMilestoneTime(undefined)).toBeNull();
  });

  it("devuelve null para null", () => {
    expect(formatMilestoneTime(null)).toBeNull();
  });

  it("devuelve string no nulo para fecha válida", () => {
    const result = formatMilestoneTime(new Date("2026-05-16T08:00:00"));
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });

  it("devuelve string para fecha en string ISO", () => {
    const result = formatMilestoneTime("2026-05-16T14:30:00Z");
    expect(result).not.toBeNull();
  });
});

// ---- Componente ----

const ALL_NULL = {
  signInAt: null,
  timeOutAt: null,
  actualStart: null,
  signOutAt: null,
  actualEnd: null,
};

const SOME_FILLED = {
  signInAt: new Date("2026-05-16T08:00:00"),
  timeOutAt: new Date("2026-05-16T08:15:00"),
  actualStart: null,
  signOutAt: null,
  actualEnd: null,
};

const ALL_FILLED = {
  signInAt: new Date("2026-05-16T08:00:00"),
  timeOutAt: new Date("2026-05-16T08:15:00"),
  actualStart: new Date("2026-05-16T08:20:00"),
  signOutAt: new Date("2026-05-16T10:45:00"),
  actualEnd: new Date("2026-05-16T10:50:00"),
};

describe("<IntraOpTimeline />", () => {
  beforeEach(() => {
    cleanup();
  });

  it("todos null → todos los data-testid muestran texto Pendiente", () => {
    render(<IntraOpTimeline {...ALL_NULL} />);

    const fields = ["signInAt", "timeOutAt", "actualStart", "signOutAt", "actualEnd"];
    for (const field of fields) {
      const el = screen.getByTestId(`timeline-${field}`);
      expect(el).toHaveTextContent("Pendiente");
    }
  });

  it("timestamps parciales → signIn/timeOut muestran hora, resto Pendiente", () => {
    render(<IntraOpTimeline {...SOME_FILLED} />);

    // Completados no dicen "Pendiente"
    expect(screen.getByTestId("timeline-signInAt")).not.toHaveTextContent("Pendiente");
    expect(screen.getByTestId("timeline-timeOutAt")).not.toHaveTextContent("Pendiente");

    // Pendientes sí dicen "Pendiente"
    expect(screen.getByTestId("timeline-actualStart")).toHaveTextContent("Pendiente");
    expect(screen.getByTestId("timeline-signOutAt")).toHaveTextContent("Pendiente");
    expect(screen.getByTestId("timeline-actualEnd")).toHaveTextContent("Pendiente");
  });

  it("todos los timestamps presentes → ninguno dice Pendiente", () => {
    render(<IntraOpTimeline {...ALL_FILLED} />);

    const fields = ["signInAt", "timeOutAt", "actualStart", "signOutAt", "actualEnd"];
    for (const field of fields) {
      expect(screen.getByTestId(`timeline-${field}`)).not.toHaveTextContent("Pendiente");
    }
  });

  it("tiene elemento con rol de lista accesible", () => {
    render(<IntraOpTimeline {...SOME_FILLED} />);
    // El div wrapper tiene role="list" y el ol tiene role="list" implícito.
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThanOrEqual(1);
  });
});

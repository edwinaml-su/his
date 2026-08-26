import { describe, it, expect } from "vitest";
import { dueLabel } from "../due-label";

const NOW = new Date("2026-08-26T12:00:00Z").getTime();

describe("dueLabel", () => {
  it("retorna null si la tarea no tiene dueAt", () => {
    expect(dueLabel({ dueAt: null, status: "PENDIENTE" }, NOW)).toBeNull();
  });

  it("marca overdue solo si sigue PENDIENTE y dueAt ya pasó", () => {
    const past = new Date(NOW - 30 * 60_000).toISOString();
    const result = dueLabel({ dueAt: past, status: "PENDIENTE" }, NOW);
    expect(result).toEqual({ text: "Venció hace 30 min", overdue: true });
  });

  it("NO marca overdue si el dueAt pasó pero la tarea está EN_PROCESO", () => {
    const past = new Date(NOW - 30 * 60_000).toISOString();
    const result = dueLabel({ dueAt: past, status: "EN_PROCESO" }, NOW);
    expect(result).toEqual({ text: "Venció hace 30 min", overdue: false });
  });

  it("muestra tiempo restante cuando dueAt es futuro", () => {
    const future = new Date(NOW + 45 * 60_000).toISOString();
    const result = dueLabel({ dueAt: future, status: "PENDIENTE" }, NOW);
    expect(result).toEqual({ text: "Vence en 45 min", overdue: false });
  });

  it("acepta dueAt como Date además de string", () => {
    const future = new Date(NOW + 10 * 60_000);
    const result = dueLabel({ dueAt: future, status: "PENDIENTE" }, NOW);
    expect(result).toEqual({ text: "Vence en 10 min", overdue: false });
  });
});

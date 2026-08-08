/**
 * CC-0016 — Tests del schema de solicitud de radiología e imágenes.
 */
import { describe, it, expect } from "vitest";
import {
  imagingRequestCrearInput,
  imagingFormFieldConfigSetInput,
  imagingModuleRuleSetInput,
  imagingCatalogoUpsertInput,
  derivarEstadoSolicitud,
} from "../imaging-request";

const u = "00000000-0000-0000-0000-000000000001";
const u2 = "00000000-0000-0000-0000-000000000002";

describe("imagingRequestCrearInput", () => {
  it("acepta el mínimo: cuentaId + 1 prestación", () => {
    const r = imagingRequestCrearInput.safeParse({
      cuentaId: u,
      prestaciones: [{ labTestId: u2 }],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza sin prestaciones", () => {
    const r = imagingRequestCrearInput.safeParse({ cuentaId: u, prestaciones: [] });
    expect(r.success).toBe(false);
  });

  it("acepta todos los campos clínicos + pin", () => {
    const r = imagingRequestCrearInput.safeParse({
      cuentaId: u,
      prestaciones: [{ labTestId: u2, conContraste: true, nota: "urgente" }],
      dx: "M54.5",
      justificacion: "lumbalgia",
      prioridad: "URGENT",
      fechaDeseada: "2026-08-10",
      embarazo: "No",
      alergias: "Ninguna",
      creatinina: "0.9",
      observaciones: "paciente con marcapasos",
      pin: "123456",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza cuentaId inválido", () => {
    const r = imagingRequestCrearInput.safeParse({ cuentaId: "no-uuid", prestaciones: [{ labTestId: u2 }] });
    expect(r.success).toBe(false);
  });

  it("rechaza más de 50 prestaciones", () => {
    const prestaciones = Array.from({ length: 51 }, () => ({ labTestId: u2 }));
    const r = imagingRequestCrearInput.safeParse({ cuentaId: u, prestaciones });
    expect(r.success).toBe(false);
  });
});

describe("imagingFormFieldConfigSetInput", () => {
  it("acepta una combinación válida", () => {
    expect(imagingFormFieldConfigSetInput.safeParse({ fieldKey: "dx", estado: "obligatorio" }).success).toBe(
      true,
    );
  });

  it("rechaza fieldKey desconocido", () => {
    expect(imagingFormFieldConfigSetInput.safeParse({ fieldKey: "otro", estado: "opcional" }).success).toBe(
      false,
    );
  });

  it("rechaza estado desconocido", () => {
    expect(imagingFormFieldConfigSetInput.safeParse({ fieldKey: "dx", estado: "visible" }).success).toBe(
      false,
    );
  });
});

describe("imagingModuleRuleSetInput", () => {
  it("acepta toggle simple sin valorNum", () => {
    expect(imagingModuleRuleSetInput.safeParse({ ruleKey: "multi", enabled: true }).success).toBe(true);
  });

  it("acepta maxN con valorNum", () => {
    expect(
      imagingModuleRuleSetInput.safeParse({ ruleKey: "maxN", enabled: true, valorNum: 10 }).success,
    ).toBe(true);
  });

  it("rechaza ruleKey desconocido", () => {
    expect(imagingModuleRuleSetInput.safeParse({ ruleKey: "otro", enabled: true }).success).toBe(false);
  });
});

describe("imagingCatalogoUpsertInput", () => {
  it("acepta creación con code", () => {
    const r = imagingCatalogoUpsertInput.safeParse({ panelId: u, code: "RX999", name: "RX PRUEBA" });
    expect(r.success).toBe(true);
  });

  it("rechaza creación sin code ni labTestId", () => {
    const r = imagingCatalogoUpsertInput.safeParse({ panelId: u, name: "RX PRUEBA" });
    expect(r.success).toBe(false);
  });

  it("acepta actualización solo con labTestId (sin code)", () => {
    const r = imagingCatalogoUpsertInput.safeParse({ labTestId: u2, panelId: u, name: "RX PRUEBA" });
    expect(r.success).toBe(true);
  });

  it("aplica defaults de duracionMin/active/flags", () => {
    const r = imagingCatalogoUpsertInput.parse({ panelId: u, code: "RX999", name: "RX PRUEBA" });
    expect(r.duracionMin).toBe(20);
    expect(r.active).toBe(true);
    expect(r.requiereContraste).toBe(false);
  });
});

describe("derivarEstadoSolicitud", () => {
  it("pend si al menos una orden sigue ORDERED", () => {
    expect(derivarEstadoSolicitud(["ORDERED", "VALIDATED"])).toBe("pend");
  });

  it("prog si el mínimo es SCHEDULED o IN_PROGRESS", () => {
    expect(derivarEstadoSolicitud(["SCHEDULED", "COMPLETED"])).toBe("prog");
    expect(derivarEstadoSolicitud(["IN_PROGRESS", "REPORTED"])).toBe("prog");
  });

  it("real cuando el mínimo es COMPLETED", () => {
    expect(derivarEstadoSolicitud(["COMPLETED", "REPORTED", "VALIDATED"])).toBe("real");
  });

  it("inf cuando todas están REPORTED/VALIDATED", () => {
    expect(derivarEstadoSolicitud(["REPORTED", "VALIDATED"])).toBe("inf");
    expect(derivarEstadoSolicitud(["VALIDATED"])).toBe("inf");
  });

  it("ignora CANCELLED cuando hay otras órdenes activas", () => {
    expect(derivarEstadoSolicitud(["CANCELLED", "ORDERED"])).toBe("pend");
  });

  it("anulado cuando todas las órdenes están CANCELLED", () => {
    expect(derivarEstadoSolicitud(["CANCELLED", "CANCELLED"])).toBe("anulado");
  });

  it("anulado si no hay órdenes", () => {
    expect(derivarEstadoSolicitud([])).toBe("anulado");
  });
});

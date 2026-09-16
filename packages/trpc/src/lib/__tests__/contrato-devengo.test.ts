import { describe, it, expect } from "vitest";
import { calcularDevengoProrrateado } from "../contrato-devengo";

describe("calcularDevengoProrrateado", () => {
  it("prorratea INICIO a mitad de mes (REQ §12, contrato inicia a mitad de período)", () => {
    // Septiembre tiene 30 días. Inicia el 15 -> cubre 16 días (15..30 inclusive).
    const r = calcularDevengoProrrateado({
      rentaMensual: 1000,
      fecha: new Date("2026-09-15T00:00:00.000Z"),
      lado: "INICIO",
    });
    expect(r.diasEnMes).toBe(30);
    expect(r.diasCubiertos).toBe(16);
    expect(r.factor).toBeCloseTo(16 / 30, 10);
    expect(r.esProrrateo).toBe(true);
    expect(r.montoRenta).toBeCloseTo(533.33, 2);
    expect(r.periodo.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("INICIO el día 1 del mes -> factor 1, no es prorrateo", () => {
    const r = calcularDevengoProrrateado({
      rentaMensual: 1000,
      fecha: new Date("2026-09-01T00:00:00.000Z"),
      lado: "INICIO",
    });
    expect(r.diasCubiertos).toBe(30);
    expect(r.factor).toBe(1);
    expect(r.esProrrateo).toBe(false);
    expect(r.montoRenta).toBe(1000);
  });

  it("prorratea FIN a mitad de mes (término anticipado, US.AFIL.1.3.7)", () => {
    const r = calcularDevengoProrrateado({
      rentaMensual: 1000,
      fecha: new Date("2026-09-15T00:00:00.000Z"),
      lado: "FIN",
    });
    expect(r.diasCubiertos).toBe(15);
    expect(r.factor).toBe(0.5);
    expect(r.montoRenta).toBe(500);
    expect(r.esProrrateo).toBe(true);
  });

  it("FIN en el último día del mes -> factor 1, no es prorrateo", () => {
    const r = calcularDevengoProrrateado({
      rentaMensual: 1000,
      fecha: new Date("2026-09-30T00:00:00.000Z"),
      lado: "FIN",
    });
    expect(r.factor).toBe(1);
    expect(r.esProrrateo).toBe(false);
  });

  it("incluye SERVICIOS prorrateado cuando cuotaServicios > 0", () => {
    const r = calcularDevengoProrrateado({
      rentaMensual: 1000,
      cuotaServicios: 200,
      fecha: new Date("2026-09-15T00:00:00.000Z"),
      lado: "INICIO",
    });
    expect(r.montoServicios).toBeCloseTo(106.67, 2);
  });

  it("omite SERVICIOS cuando cuotaServicios es 0 o no se pasa", () => {
    const r1 = calcularDevengoProrrateado({
      rentaMensual: 1000,
      cuotaServicios: 0,
      fecha: new Date("2026-09-15T00:00:00.000Z"),
      lado: "INICIO",
    });
    expect(r1.montoServicios).toBeNull();

    const r2 = calcularDevengoProrrateado({
      rentaMensual: 1000,
      fecha: new Date("2026-09-15T00:00:00.000Z"),
      lado: "INICIO",
    });
    expect(r2.montoServicios).toBeNull();
  });

  it("respeta febrero (28/29 días) sin hardcodear 30/31", () => {
    // 2028 es bisiesto -> febrero tiene 29 días.
    const r = calcularDevengoProrrateado({
      rentaMensual: 290,
      fecha: new Date("2028-02-15T00:00:00.000Z"),
      lado: "INICIO",
    });
    expect(r.diasEnMes).toBe(29);
    expect(r.diasCubiertos).toBe(15);
    expect(r.montoRenta).toBeCloseTo(150, 2);
  });
});

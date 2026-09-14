/**
 * CC-0028 — Tests del motor de cobertura de seguros (coverage-resolver.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { resolverCobertura } from "../coverage-resolver";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const PATIENT_ID = "00000000-0000-0000-0000-000000000002";
const POLIZA_ID = "00000000-0000-0000-0000-000000000003";
const PLAN_ID = "00000000-0000-0000-0000-000000000004";
const CATEGORIA_ID = "00000000-0000-0000-0000-000000000005";

const FECHA = new Date("2026-09-14T12:00:00Z");

function poliza(overrides: Partial<{ id: string; planId: string; validFrom: Date; createdAt: Date }> = {}) {
  return {
    id: overrides.id ?? POLIZA_ID,
    planId: overrides.planId ?? PLAN_ID,
    organizationId: ORG_ID,
    validFrom: overrides.validFrom ?? new Date("2026-01-01T00:00:00Z"),
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

function makeTx(opts: {
  polizas?: ReturnType<typeof poliza>[];
  reglas?: Array<Record<string, unknown>>;
  planConfigs?: Array<Record<string, unknown>>;
  overrides?: Array<Record<string, unknown>>;
}) {
  return {
    patientCoverage: { findMany: vi.fn().mockResolvedValue(opts.polizas ?? []) },
    coverageRule: { findMany: vi.fn().mockResolvedValue(opts.reglas ?? []) },
    insurancePlanCoverage: { findMany: vi.fn().mockResolvedValue(opts.planConfigs ?? []) },
    patientCoverageOverride: { findMany: vi.fn().mockResolvedValue(opts.overrides ?? []) },
  };
}

const LINEA = { code: "COD1", ambito: "CONSULTA" as const, total: 100 };

describe("resolverCobertura", () => {
  it("sin póliza vigente: paciente paga todo, polizaId null", async () => {
    const tx = makeTx({ polizas: [] });
    const r = await resolverCobertura(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      fecha: FECHA,
      lineas: [LINEA],
    });
    expect(r.polizaId).toBeNull();
    expect(r.totalAsegurado).toBe(0);
    expect(r.totalPaciente).toBe(100);
    expect(r.porLinea[0].reglaAplicada).toEqual({ tipo: "sin_cobertura" });
  });

  it("elige la póliza con validFrom más reciente cuando hay varias vigentes", async () => {
    const vieja = poliza({ id: "vieja", validFrom: new Date("2025-01-01") });
    const nueva = poliza({ id: "nueva", validFrom: new Date("2026-06-01") });
    const tx = makeTx({ polizas: [vieja, nueva] });
    const r = await resolverCobertura(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      fecha: FECHA,
      lineas: [LINEA],
    });
    expect(r.polizaId).toBe("nueva");
  });

  it("ambito PORCENTAJE del plan cubre el % configurado", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [{ ambito: "CONSULTA", coverageType: "PORCENTAJE", insuredPercentage: "80", copayAmount: null, coverageLimit: null }],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0]).toEqual({ cubierto: 80, paciente: 20, reglaAplicada: { tipo: "ambito_plan", ambito: "CONSULTA" } });
    expect(r.totalAsegurado).toBe(80);
    expect(r.totalPaciente).toBe(20);
  });

  it("ambito MONTO_FIJO: paciente paga el copago fijo, resto lo cubre la aseguradora", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [{ ambito: "CONSULTA", coverageType: "MONTO_FIJO", insuredPercentage: null, copayAmount: "15", coverageLimit: null }],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0].cubierto).toBe(85);
    expect(r.porLinea[0].paciente).toBe(15);
  });

  it("ambito MONTO_FIJO: el copago no puede exceder el total de la línea", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [{ ambito: "CONSULTA", coverageType: "MONTO_FIJO", insuredPercentage: null, copayAmount: "500", coverageLimit: null }],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0].paciente).toBe(100);
    expect(r.porLinea[0].cubierto).toBe(0);
  });

  it("ambito PORCENTAJE_CON_TOPE: aplica min(%, límite restante) por línea", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [
        { ambito: "CONSULTA", coverageType: "PORCENTAJE_CON_TOPE", insuredPercentage: "90", copayAmount: null, coverageLimit: "50" },
      ],
    });
    // 90% de 100 = 90, pero el límite es 50 -> cubierto = 50.
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0].cubierto).toBe(50);
    expect(r.porLinea[0].paciente).toBe(50);
  });

  it("PORCENTAJE_CON_TOPE: el límite se acumula entre líneas de la misma liquidación", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [
        { ambito: "CONSULTA", coverageType: "PORCENTAJE_CON_TOPE", insuredPercentage: "100", copayAmount: null, coverageLimit: "120" },
      ],
    });
    const r = await resolverCobertura(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      fecha: FECHA,
      lineas: [
        { code: "A", ambito: "CONSULTA", total: 100 },
        { code: "B", ambito: "CONSULTA", total: 100 },
      ],
    });
    // línea 1: 100% de 100 = 100 (dentro del límite de 120, quedan 20).
    expect(r.porLinea[0].cubierto).toBe(100);
    // línea 2: 100% de 100 = 100, pero solo quedan 20 de presupuesto.
    expect(r.porLinea[1].cubierto).toBe(20);
    expect(r.porLinea[1].paciente).toBe(80);
    expect(r.totalAsegurado).toBe(120);
  });

  it("copayAmount es un modificador adicional bajo PORCENTAJE: resta del lado asegurado", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [{ ambito: "CONSULTA", coverageType: "PORCENTAJE", insuredPercentage: "80", copayAmount: "10", coverageLimit: null }],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    // 80% de 100 = 80, menos el copago de 10 -> cubierto = 70, paciente = 30.
    expect(r.porLinea[0].cubierto).toBe(70);
    expect(r.porLinea[0].paciente).toBe(30);
  });

  it("ámbito GENERAL del plan aplica cuando no hay config para el ámbito de la línea", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [{ ambito: "GENERAL", coverageType: "PORCENTAJE", insuredPercentage: "50", copayAmount: null, coverageLimit: null }],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0]).toEqual({ cubierto: 50, paciente: 50, reglaAplicada: { tipo: "ambito_plan", ambito: "GENERAL" } });
  });

  it("override de la póliza gana sobre la config del plan para el mismo ámbito", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      planConfigs: [{ ambito: "CONSULTA", coverageType: "PORCENTAJE", insuredPercentage: "50", copayAmount: null, coverageLimit: null }],
      overrides: [{ ambito: "CONSULTA", coverageType: "PORCENTAJE", insuredPercentage: "100", copayAmount: null, coverageLimit: null }],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0]).toEqual({ cubierto: 100, paciente: 0, reglaAplicada: { tipo: "ambito_poliza", ambito: "CONSULTA" } });
  });

  it("regla por CATEGORIA gana sobre la config de ámbito", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      reglas: [
        {
          id: "regla-cat",
          planId: PLAN_ID,
          coverageId: null,
          ruleOn: "CATEGORIA",
          serviceCategoryId: CATEGORIA_ID,
          code: null,
          ruleType: "PORCENTAJE",
          percentage: "60",
          amount: null,
          fullCover: false,
        },
      ],
      planConfigs: [{ ambito: "CONSULTA", coverageType: "PORCENTAJE", insuredPercentage: "10", copayAmount: null, coverageLimit: null }],
    });
    const r = await resolverCobertura(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      fecha: FECHA,
      lineas: [{ ...LINEA, categoria: CATEGORIA_ID }],
    });
    expect(r.porLinea[0].reglaAplicada).toEqual({ tipo: "regla_categoria", nivel: "plan", reglaId: "regla-cat" });
    expect(r.porLinea[0].cubierto).toBe(60);
  });

  it("regla por CODIGO gana sobre regla por CATEGORIA", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      reglas: [
        {
          id: "regla-cat",
          planId: PLAN_ID,
          coverageId: null,
          ruleOn: "CATEGORIA",
          serviceCategoryId: CATEGORIA_ID,
          code: null,
          ruleType: "PORCENTAJE",
          percentage: "60",
          amount: null,
          fullCover: false,
        },
        {
          id: "regla-cod",
          planId: PLAN_ID,
          coverageId: null,
          ruleOn: "CODIGO",
          serviceCategoryId: null,
          code: "COD1",
          ruleType: "PORCENTAJE",
          percentage: "90",
          amount: null,
          fullCover: false,
        },
      ],
    });
    const r = await resolverCobertura(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      fecha: FECHA,
      lineas: [{ ...LINEA, categoria: CATEGORIA_ID }],
    });
    expect(r.porLinea[0].reglaAplicada).toEqual({ tipo: "regla_codigo", nivel: "plan", reglaId: "regla-cod" });
    expect(r.porLinea[0].cubierto).toBe(90);
  });

  it("regla a nivel de póliza gana sobre la misma regla a nivel de plan", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      reglas: [
        {
          id: "regla-plan",
          planId: PLAN_ID,
          coverageId: null,
          ruleOn: "CODIGO",
          serviceCategoryId: null,
          code: "COD1",
          ruleType: "PORCENTAJE",
          percentage: "50",
          amount: null,
          fullCover: false,
        },
        {
          id: "regla-poliza",
          planId: null,
          coverageId: POLIZA_ID,
          ruleOn: "CODIGO",
          serviceCategoryId: null,
          code: "COD1",
          ruleType: "PORCENTAJE",
          percentage: "100",
          amount: null,
          fullCover: false,
        },
      ],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0].reglaAplicada).toEqual({ tipo: "regla_codigo", nivel: "poliza", reglaId: "regla-poliza" });
    expect(r.porLinea[0].cubierto).toBe(100);
  });

  it("fullCover cubre el 100% sin importar ruleType/percentage/amount", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      reglas: [
        {
          id: "regla-full",
          planId: PLAN_ID,
          coverageId: null,
          ruleOn: "CODIGO",
          serviceCategoryId: null,
          code: "COD1",
          ruleType: "MONTO",
          percentage: null,
          amount: "1",
          fullCover: true,
        },
      ],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0]).toEqual({
      cubierto: 100,
      paciente: 0,
      reglaAplicada: { tipo: "regla_codigo", nivel: "plan", reglaId: "regla-full" },
    });
  });

  it("regla ruleType=MONTO no cubre más que el total de la línea", async () => {
    const tx = makeTx({
      polizas: [poliza()],
      reglas: [
        {
          id: "regla-monto",
          planId: PLAN_ID,
          coverageId: null,
          ruleOn: "CODIGO",
          serviceCategoryId: null,
          code: "COD1",
          ruleType: "MONTO",
          percentage: null,
          amount: "500",
          fullCover: false,
        },
      ],
    });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0].cubierto).toBe(100);
    expect(r.porLinea[0].paciente).toBe(0);
  });

  it("sin regla ni config de ningún nivel: paciente paga todo", async () => {
    const tx = makeTx({ polizas: [poliza()] });
    const r = await resolverCobertura(tx, { organizationId: ORG_ID, patientId: PATIENT_ID, fecha: FECHA, lineas: [LINEA] });
    expect(r.porLinea[0]).toEqual({ cubierto: 0, paciente: 100, reglaAplicada: { tipo: "sin_cobertura" } });
    expect(r.polizaId).toBe(POLIZA_ID);
  });
});

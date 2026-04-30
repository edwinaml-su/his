/**
 * Tests del schema Bed.
 *
 * Las "transiciones permitidas" entre estados (FREE→OCCUPIED→DIRTY→FREE,
 * etc.) son una regla de dominio que vive en `packages/domain` o en el
 * router `bed.updateStatus`. El Zod schema solo valida que el estado es
 * uno del enum. Los tests de transiciones viven en `bed.router.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { bedStatusEnum, bedListSchema, bedUpdateStatusSchema } from "../bed";

const u = "00000000-0000-0000-0000-000000000001";

describe("bedStatusEnum", () => {
  it.each(["FREE", "OCCUPIED", "DIRTY", "BLOCKED", "MAINTENANCE", "RESERVED"])(
    "acepta estado %s",
    (s) => expect(bedStatusEnum.safeParse(s).success).toBe(true),
  );

  it("rechaza estado desconocido", () => {
    expect(bedStatusEnum.safeParse("BROKEN").success).toBe(false);
  });
});

describe("bedListSchema", () => {
  it("acepta filtros vacíos", () => {
    expect(bedListSchema.safeParse({}).success).toBe(true);
  });

  it("acepta filtro por servicio", () => {
    expect(bedListSchema.safeParse({ serviceUnitId: u }).success).toBe(true);
  });

  it("rechaza serviceUnitId no-UUID", () => {
    expect(bedListSchema.safeParse({ serviceUnitId: "x" }).success).toBe(false);
  });
});

describe("bedUpdateStatusSchema", () => {
  it("acepta cambio de estado válido", () => {
    expect(
      bedUpdateStatusSchema.safeParse({ bedId: u, status: "DIRTY" }).success,
    ).toBe(true);
  });

  it("acepta razón opcional <=200", () => {
    expect(
      bedUpdateStatusSchema.safeParse({
        bedId: u,
        status: "MAINTENANCE",
        reason: "Mantenimiento preventivo trimestral.",
      }).success,
    ).toBe(true);
  });

  it("rechaza razón > 200 chars", () => {
    expect(
      bedUpdateStatusSchema.safeParse({
        bedId: u,
        status: "DIRTY",
        reason: "x".repeat(201),
      }).success,
    ).toBe(false);
  });
});

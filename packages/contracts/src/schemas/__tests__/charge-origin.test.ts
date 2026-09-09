/**
 * docs/48 Ola 3 (C3-3) — taxonomía de `PatientAccountService.origen`.
 */
import { describe, it, expect } from "vitest";
import { CHARGE_ORIGINS, chargeOriginEnum } from "../charge-origin";

describe("chargeOriginEnum", () => {
  it.each(CHARGE_ORIGINS)("origen %s válido", (o) =>
    expect(chargeOriginEnum.safeParse(o).success).toBe(true),
  );

  it("rechaza un origen libre fuera de la taxonomía", () =>
    expect(chargeOriginEnum.safeParse("dispensacion").success).toBe(false));

  it("CHARGE_ORIGINS incluye los orígenes cableados en Ola 2/3", () => {
    expect(CHARGE_ORIGINS).toContain("DISPENSACION_FARMACIA");
    expect(CHARGE_ORIGINS).toContain("LABORATORIO");
    expect(CHARGE_ORIGINS).toContain("IMAGENES");
  });
});

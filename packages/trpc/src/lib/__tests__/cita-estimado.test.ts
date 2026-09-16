/**
 * CC-0036 Ola 4 (US.AGE.2.4 AC5) — Tests de `estimarConsulta`.
 *
 * El estimado es informativo: nunca debe lanzar, incluso si la resolución
 * de precio/cobertura falla o no hay catálogo configurado.
 */
import { describe, it, expect, vi } from "vitest";
import { estimarConsulta, CODIGO_CONSULTA_EXTERNA } from "../cita-estimado";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const PATIENT_ID = "00000000-0000-0000-0000-000000000002";
const TIPO_CUENTA_ID = "00000000-0000-0000-0000-000000000003";
const PRICE_LIST_ID = "00000000-0000-0000-0000-000000000004";

function fakeTx(overrides: Record<string, unknown> = {}) {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue({ functionalCurrency: "USD" }) },
    tipoCuenta: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $queryRaw: vi.fn().mockResolvedValue([]),
    patientCoverage: { findMany: vi.fn().mockResolvedValue([]) },
    labTest: { findFirst: vi.fn().mockResolvedValue(null) },
    ...overrides,
  } as never;
}

describe("estimarConsulta", () => {
  it("sin tipoCuentaId y sin lista DEFAULT -> advertencia, nunca lanza", async () => {
    const tx = fakeTx();
    const result = await estimarConsulta(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      fecha: new Date(),
    });

    expect(result.precio).toBeNull();
    expect(result.advertencias.length).toBeGreaterThan(0);
  });

  it("resuelve priceListId desde TipoCuenta pero sin tarifa para el código -> advertencia", async () => {
    const tx = fakeTx({
      tipoCuenta: { findFirst: vi.fn().mockResolvedValue({ priceListId: PRICE_LIST_ID }) },
    });
    const result = await estimarConsulta(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      tipoCuentaId: TIPO_CUENTA_ID,
      fecha: new Date(),
    });

    expect(result.precio).toBeNull();
    expect(result.advertencias.some((a) => a.includes(CODIGO_CONSULTA_EXTERNA))).toBe(true);
  });

  it("nunca lanza aunque `organization.findUnique` falle (resiliencia AC5)", async () => {
    const tx = fakeTx({
      organization: { findUnique: vi.fn().mockRejectedValue(new Error("db down")) },
    });
    const result = await estimarConsulta(tx, {
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      fecha: new Date(),
    });

    expect(result.precio).toBeNull();
    expect(result.advertencias.length).toBeGreaterThan(0);
  });
});

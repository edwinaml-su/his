/**
 * atributos.test.ts — R2.2. `atributosDesdeContexto` evaluaba `horaActual`
 * SIEMPRE en "America/El_Salvador" fijo; ahora resuelve la TZ de la
 * organización del tenant vía `resolverLocaleOrg`, con fallback exacto a SV.
 */
import { describe, it, expect, vi } from "vitest";
import { atributosDesdeContexto, horaActualHHMM } from "../atributos";
import { MOCK_TENANT } from "@his/test-utils";

function makePrisma(orgResult: unknown) {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(orgResult) },
  };
}

describe("horaActualHHMM", () => {
  it("formatea HH:MM en la TZ dada", () => {
    // 2026-01-15T05:30:00Z == 2026-01-14T23:30 en America/El_Salvador (UTC-6).
    const result = horaActualHHMM(new Date("2026-01-15T05:30:00Z"), "America/El_Salvador");
    expect(result).toBe("23:30");
  });

  it("usa el fallback SV cuando no se pasa timeZone", () => {
    const result = horaActualHHMM(new Date("2026-01-15T05:30:00Z"));
    expect(result).toBe("23:30");
  });
});

describe("atributosDesdeContexto", () => {
  it("arma rol/establecimiento/servicio/usuarioActivo desde el tenant, con horaActual en la TZ resuelta", async () => {
    const prisma = makePrisma({
      country: {
        isoAlpha2: "GT",
        isoAlpha3: "GTM",
        defaultTzId: "America/Guatemala",
        defaultLocale: "es-GT",
      },
      functionalCurr: { isoCode: "GTQ" },
    });

    const atributos = await atributosDesdeContexto(prisma, MOCK_TENANT);

    expect(atributos.rol).toEqual(MOCK_TENANT.roleCodes);
    expect(atributos.establecimiento).toEqual(MOCK_TENANT.establishmentId);
    expect(atributos.servicio).toEqual(MOCK_TENANT.assignedServiceUnitCodes);
    expect(atributos.usuarioActivo).toBe(true);
    expect(atributos.horaActual).toMatch(/^\d{2}:\d{2}$/);
    expect(prisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MOCK_TENANT.organizationId } }),
    );
  });

  it("cae al horario en TZ SV cuando la organización no resuelve país (fallback)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T05:30:00Z"));
    try {
      const prisma = makePrisma(null);
      const atributos = await atributosDesdeContexto(prisma, MOCK_TENANT);
      expect(atributos.horaActual).toBe("23:30");
    } finally {
      vi.useRealTimers();
    }
  });
});

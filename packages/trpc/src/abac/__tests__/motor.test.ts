/**
 * CC-0017 F2 — tests del motor ABAC (evaluarCondiciones, resolverDecision, evaluarAbac).
 *
 * Cubre:
 *   - evaluarCondiciones: AND de predicados, lista vacía = vacuously true.
 *   - Operadores: IGUAL/DIFERENTE/EN/NO_EN (array y scalar), ENTRE_HORAS
 *     (incluye wrap de medianoche), ES_VERDADERO/ES_FALSO (incluye undefined).
 *   - resolverDecision: fail-safe ALLOW sin reglas; DENY siempre gana sobre
 *     ALLOW sin importar prioridad; empate resuelto por mayor prioridad.
 *   - evaluarAbac: carga vía withTenantContext, filas con condiciones
 *     corruptas se excluyen sin tumbar la decisión.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import type { AbacCondicion } from "@his/contracts";
import { evaluarCondiciones, resolverDecision, evaluarAbac } from "../motor";
import type { AbacAtributosRuntime, AbacRuleRuntime } from "../types";

// ---------------------------------------------------------------------------
// evaluarCondiciones / operadores
// ---------------------------------------------------------------------------

describe("evaluarCondiciones", () => {
  const atributos: AbacAtributosRuntime = {
    rol: ["medico", "PHYSICIAN"],
    establecimiento: "est-1",
    servicio: ["LAB", "URG"],
    horaActual: "14:30",
    pacienteConTriaje: true,
    usuarioActivo: true,
    esPropioPaciente: false,
  };

  it("lista vacía = vacuously true (regla incondicional)", () => {
    expect(evaluarCondiciones([], atributos)).toBe(true);
  });

  it("AND: todas las condiciones deben cumplirse", () => {
    const condiciones: AbacCondicion[] = [
      { atributo: "rol", operador: "EN", valor: ["medico"] },
      { atributo: "usuarioActivo", operador: "ES_VERDADERO", valor: true },
    ];
    expect(evaluarCondiciones(condiciones, atributos)).toBe(true);
  });

  it("AND: una condición falsa tumba el AND completo", () => {
    const condiciones: AbacCondicion[] = [
      { atributo: "rol", operador: "EN", valor: ["medico"] },
      { atributo: "esPropioPaciente", operador: "ES_VERDADERO", valor: true },
    ];
    expect(evaluarCondiciones(condiciones, atributos)).toBe(false);
  });

  describe("EN / NO_EN sobre atributo array (rol)", () => {
    it("EN: intersección no vacía → true", () => {
      expect(
        evaluarCondiciones([{ atributo: "rol", operador: "EN", valor: ["medico", "enfermeria"] }], atributos),
      ).toBe(true);
    });

    it("EN: sin intersección → false", () => {
      expect(
        evaluarCondiciones([{ atributo: "rol", operador: "EN", valor: ["farmaceutico"] }], atributos),
      ).toBe(false);
    });

    it("NO_EN: niega EN", () => {
      expect(
        evaluarCondiciones([{ atributo: "rol", operador: "NO_EN", valor: ["farmaceutico"] }], atributos),
      ).toBe(true);
    });
  });

  describe("IGUAL / DIFERENTE sobre atributo scalar (establecimiento)", () => {
    it("IGUAL true cuando coincide", () => {
      expect(
        evaluarCondiciones([{ atributo: "establecimiento", operador: "IGUAL", valor: "est-1" }], atributos),
      ).toBe(true);
    });

    it("IGUAL false cuando no coincide", () => {
      expect(
        evaluarCondiciones([{ atributo: "establecimiento", operador: "IGUAL", valor: "est-2" }], atributos),
      ).toBe(false);
    });

    it("DIFERENTE niega IGUAL", () => {
      expect(
        evaluarCondiciones([{ atributo: "establecimiento", operador: "DIFERENTE", valor: "est-2" }], atributos),
      ).toBe(true);
    });
  });

  describe("IGUAL sobre atributo array (rol) — equivalente a includes", () => {
    it("IGUAL con un solo valor string funciona como membership", () => {
      expect(evaluarCondiciones([{ atributo: "rol", operador: "IGUAL", valor: "medico" }], atributos)).toBe(
        true,
      );
    });
  });

  describe("ES_VERDADERO / ES_FALSO", () => {
    it("ES_VERDADERO true cuando el atributo es true", () => {
      expect(
        evaluarCondiciones([{ atributo: "pacienteConTriaje", operador: "ES_VERDADERO", valor: true }], atributos),
      ).toBe(true);
    });

    it("ES_FALSO true cuando el atributo es false explícito", () => {
      expect(
        evaluarCondiciones([{ atributo: "esPropioPaciente", operador: "ES_FALSO", valor: true }], atributos),
      ).toBe(true);
    });

    it("ES_VERDADERO false cuando el atributo está undefined (no se asume)", () => {
      const sinTriage: AbacAtributosRuntime = { ...atributos, pacienteConTriaje: undefined };
      expect(
        evaluarCondiciones([{ atributo: "pacienteConTriaje", operador: "ES_VERDADERO", valor: true }], sinTriage),
      ).toBe(false);
    });

    it("ES_FALSO false cuando el atributo está undefined (no se asume)", () => {
      const sinFlag: AbacAtributosRuntime = { ...atributos, esPropioPaciente: undefined };
      expect(
        evaluarCondiciones([{ atributo: "esPropioPaciente", operador: "ES_FALSO", valor: true }], sinFlag),
      ).toBe(false);
    });
  });

  describe("ENTRE_HORAS", () => {
    it("dentro de rango simple (sin wrap)", () => {
      expect(
        evaluarCondiciones(
          [{ atributo: "horario", operador: "ENTRE_HORAS", valor: { desde: "08:00", hasta: "17:00" } }],
          { ...atributos, horaActual: "14:30" },
        ),
      ).toBe(true);
    });

    it("fuera de rango simple (sin wrap)", () => {
      expect(
        evaluarCondiciones(
          [{ atributo: "horario", operador: "ENTRE_HORAS", valor: { desde: "08:00", hasta: "17:00" } }],
          { ...atributos, horaActual: "20:00" },
        ),
      ).toBe(false);
    });

    it("rango con wrap de medianoche — dentro (madrugada)", () => {
      expect(
        evaluarCondiciones(
          [{ atributo: "horario", operador: "ENTRE_HORAS", valor: { desde: "22:00", hasta: "06:00" } }],
          { ...atributos, horaActual: "02:00" },
        ),
      ).toBe(true);
    });

    it("rango con wrap de medianoche — dentro (noche)", () => {
      expect(
        evaluarCondiciones(
          [{ atributo: "horario", operador: "ENTRE_HORAS", valor: { desde: "22:00", hasta: "06:00" } }],
          { ...atributos, horaActual: "23:30" },
        ),
      ).toBe(true);
    });

    it("rango con wrap de medianoche — fuera (mediodía)", () => {
      expect(
        evaluarCondiciones(
          [{ atributo: "horario", operador: "ENTRE_HORAS", valor: { desde: "22:00", hasta: "06:00" } }],
          { ...atributos, horaActual: "12:00" },
        ),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// resolverDecision — precedencia
// ---------------------------------------------------------------------------

describe("resolverDecision", () => {
  const atributos: AbacAtributosRuntime = { rol: ["medico"] };

  function regla(overrides: Partial<AbacRuleRuntime>): AbacRuleRuntime {
    return {
      id: "r-default",
      recurso: "patient",
      accion: "access",
      effect: "ALLOW",
      prioridad: 100,
      descripcion: null,
      condiciones: [],
      active: true,
      ...overrides,
    };
  }

  it("sin reglas → fail-safe ALLOW", () => {
    const decision = resolverDecision([], atributos);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRuleId).toBe("fail-safe-allow");
  });

  it("reglas existentes pero ninguna matchea (condición falsa) → fail-safe ALLOW", () => {
    const reglas = [
      regla({ id: "r1", condiciones: [{ atributo: "rol", operador: "EN", valor: ["farmaceutico"] }] }),
    ];
    const decision = resolverDecision(reglas, atributos);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRuleId).toBe("fail-safe-allow");
  });

  it("una regla ALLOW que matchea → ALLOW con su id", () => {
    const reglas = [regla({ id: "r1", effect: "ALLOW" })];
    const decision = resolverDecision(reglas, atributos);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRuleId).toBe("r1");
  });

  it("DENY gana sobre ALLOW aunque el ALLOW tenga MAYOR prioridad", () => {
    const reglas = [
      regla({ id: "allow-alta", effect: "ALLOW", prioridad: 900 }),
      regla({ id: "deny-baja", effect: "DENY", prioridad: 1 }),
    ];
    const decision = resolverDecision(reglas, atributos);
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRuleId).toBe("deny-baja");
  });

  it("entre varios DENY matcheados, gana el de mayor prioridad", () => {
    const reglas = [
      regla({ id: "deny-1", effect: "DENY", prioridad: 50 }),
      regla({ id: "deny-2", effect: "DENY", prioridad: 200 }),
    ];
    const decision = resolverDecision(reglas, atributos);
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRuleId).toBe("deny-2");
  });

  it("entre varios ALLOW matcheados (sin DENY), gana el de mayor prioridad", () => {
    const reglas = [
      regla({ id: "allow-1", effect: "ALLOW", prioridad: 50 }),
      regla({ id: "allow-2", effect: "ALLOW", prioridad: 200 }),
    ];
    const decision = resolverDecision(reglas, atributos);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRuleId).toBe("allow-2");
  });

  it("reglas inactivas (active=false) nunca matchean", () => {
    const reglas = [regla({ id: "inactiva", effect: "DENY", active: false })];
    const decision = resolverDecision(reglas, atributos);
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRuleId).toBe("fail-safe-allow");
  });

  it("reason usa descripcion cuando existe", () => {
    const reglas = [regla({ id: "r1", descripcion: "Solo médicos." })];
    const decision = resolverDecision(reglas, atributos);
    expect(decision.reason).toBe("Solo médicos.");
  });
});

// ---------------------------------------------------------------------------
// evaluarAbac — carga vía withTenantContext
// ---------------------------------------------------------------------------

describe("evaluarAbac", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  const tenant = { userId: "u1", organizationId: "org-1" };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenantContext hace prisma.$transaction(cb) → delegar al mismo mock.
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return cb;
    });
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  });

  it("ALLOW fail-safe cuando no hay filas", async () => {
    prisma.abacRule.findMany.mockResolvedValue([] as never);
    const decision = await evaluarAbac(prisma, tenant, {
      recurso: "prescription",
      accion: "prescribe",
      atributos: { rol: ["medico"] },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRuleId).toBe("fail-safe-allow");
  });

  it("evalúa las filas cargadas y respeta DENY", async () => {
    prisma.abacRule.findMany.mockResolvedValue([
      {
        id: "rule-1",
        organizationId: tenant.organizationId,
        recurso: "prescription",
        accion: "prescribe",
        effect: "DENY",
        prioridad: 100,
        descripcion: "Bloqueado por regla de prueba.",
        condiciones: [{ atributo: "rol", operador: "EN", valor: ["medico"] }],
        active: true,
        createdAt: new Date(),
        createdBy: null,
        updatedAt: new Date(),
        updatedBy: null,
      },
    ] as never);

    const decision = await evaluarAbac(prisma, tenant, {
      recurso: "prescription",
      accion: "prescribe",
      atributos: { rol: ["medico"] },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.matchedRuleId).toBe("rule-1");
  });

  it("fila con condiciones corruptas (no-array parseable) se excluye sin tumbar la decisión", async () => {
    prisma.abacRule.findMany.mockResolvedValue([
      {
        id: "rule-corrupta",
        organizationId: tenant.organizationId,
        recurso: "prescription",
        accion: "prescribe",
        effect: "DENY",
        prioridad: 999,
        descripcion: "No debería aplicar.",
        condiciones: [{ atributo: "no-existe", operador: "XYZ", valor: 123 }],
        active: true,
        createdAt: new Date(),
        createdBy: null,
        updatedAt: new Date(),
        updatedBy: null,
      },
    ] as never);

    const decision = await evaluarAbac(prisma, tenant, {
      recurso: "prescription",
      accion: "prescribe",
      atributos: { rol: ["medico"] },
    });
    // La regla corrupta se descarta → sin reglas efectivas → fail-safe ALLOW.
    expect(decision.allowed).toBe(true);
    expect(decision.matchedRuleId).toBe("fail-safe-allow");
  });

  it("pasa organizationId/recurso/accion/active=true en el filtro de carga", async () => {
    prisma.abacRule.findMany.mockResolvedValue([] as never);
    await evaluarAbac(prisma, tenant, {
      recurso: "dispensation",
      accion: "dispense",
      atributos: { rol: ["farmaceutico"] },
    });
    expect(prisma.abacRule.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: tenant.organizationId,
        recurso: "dispensation",
        accion: "dispense",
        active: true,
      },
    });
  });
});

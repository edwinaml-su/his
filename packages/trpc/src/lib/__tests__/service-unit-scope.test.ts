/**
 * service-unit-scope.test.ts — Tests unitarios de Nivel B (data scoping
 * por ServiceUnit en queries Prisma).
 *
 * Cubre los tres helpers:
 *   - serviceUnitIdInScope:   shape `{ in: ids } | undefined`.
 *   - serviceUnitWhereFragment: fragmento esparcible en `where`, con/sin
 *                                soporte `includeNullable`.
 *   - isOutOfServiceUnitScope: validación pre-mutación.
 *
 * El contrato de "rollout suave" (sin asignaciones → no aplica filtro) es
 * crítico: aquí se prueba explícitamente para evitar regresiones tras
 * cambios futuros.
 */
import { describe, it, expect } from "vitest";
import {
  serviceUnitIdInScope,
  serviceUnitWhereFragment,
  isOutOfServiceUnitScope,
} from "../service-unit-scope";

const ER = "00000000-0000-0000-0000-0000000000ER";
const QX = "00000000-0000-0000-0000-0000000000QX";
const UCIN = "00000000-0000-0000-0000-00000000UCIN";

/** Construye un TenantContext mínimo para los tests. */
function tenant(opts: {
  isCrossServiceRole?: boolean;
  ids?: string[];
}): { assignedServiceUnitIds: string[]; isCrossServiceRole: boolean } {
  return {
    isCrossServiceRole: opts.isCrossServiceRole ?? false,
    assignedServiceUnitIds: opts.ids ?? [],
  };
}

describe("serviceUnitIdInScope", () => {
  it("devuelve undefined para roles cross-service (bypass)", () => {
    const result = serviceUnitIdInScope(tenant({ isCrossServiceRole: true, ids: [ER] }));
    expect(result).toBeUndefined();
  });

  it("devuelve undefined cuando no hay asignaciones (rollout suave)", () => {
    const result = serviceUnitIdInScope(tenant({ ids: [] }));
    expect(result).toBeUndefined();
  });

  it("devuelve { in: ids } cuando el usuario está scoping con asignaciones", () => {
    const result = serviceUnitIdInScope(tenant({ ids: [ER, QX] }));
    expect(result).toEqual({ in: [ER, QX] });
  });

  it("respeta el orden de los IDs (importante para depuración)", () => {
    const result = serviceUnitIdInScope(tenant({ ids: [QX, ER, UCIN] }));
    expect(result).toEqual({ in: [QX, ER, UCIN] });
  });
});

describe("serviceUnitWhereFragment", () => {
  it("devuelve {} para roles cross-service (esparcible sin efecto)", () => {
    const result = serviceUnitWhereFragment(
      tenant({ isCrossServiceRole: true, ids: [ER] }),
      "serviceUnitId",
    );
    expect(result).toEqual({});
  });

  it("devuelve {} cuando no hay asignaciones (rollout suave)", () => {
    const result = serviceUnitWhereFragment(tenant({ ids: [] }), "serviceUnitId");
    expect(result).toEqual({});
  });

  it("devuelve { <field>: { in: ids } } por defecto (sin nullable)", () => {
    const result = serviceUnitWhereFragment(tenant({ ids: [ER, QX] }), "serviceUnitId");
    expect(result).toEqual({ serviceUnitId: { in: [ER, QX] } });
  });

  it("respeta el nombre del campo (no asume 'serviceUnitId')", () => {
    // Caso real: bed.getMap filtra ServiceUnit.id usando este helper.
    const result = serviceUnitWhereFragment(tenant({ ids: [ER] }), "id");
    expect(result).toEqual({ id: { in: [ER] } });
  });

  it("con includeNullable=true devuelve OR con field IS NULL", () => {
    const result = serviceUnitWhereFragment(
      tenant({ ids: [ER, QX] }),
      "serviceUnitId",
      { includeNullable: true },
    );
    expect(result).toEqual({
      OR: [{ serviceUnitId: { in: [ER, QX] } }, { serviceUnitId: null }],
    });
  });

  it("con includeNullable=true pero sin scope, sigue siendo {} (no aplica filtro)", () => {
    const result = serviceUnitWhereFragment(
      tenant({ isCrossServiceRole: true, ids: [ER] }),
      "serviceUnitId",
      { includeNullable: true },
    );
    expect(result).toEqual({});
  });
});

describe("isOutOfServiceUnitScope", () => {
  it("false para roles cross-service (bypass)", () => {
    expect(
      isOutOfServiceUnitScope(tenant({ isCrossServiceRole: true, ids: [] }), QX),
    ).toBe(false);
  });

  it("false cuando el usuario no tiene asignaciones (backward compat)", () => {
    expect(isOutOfServiceUnitScope(tenant({ ids: [] }), QX)).toBe(false);
  });

  it("false cuando el serviceUnitId está en el scope del usuario", () => {
    expect(isOutOfServiceUnitScope(tenant({ ids: [ER, QX] }), ER)).toBe(false);
  });

  it("true cuando el serviceUnitId NO está en el scope del usuario", () => {
    expect(isOutOfServiceUnitScope(tenant({ ids: [ER, UCIN] }), QX)).toBe(true);
  });

  it("false cuando serviceUnitId es null o undefined (no podemos validar)", () => {
    expect(isOutOfServiceUnitScope(tenant({ ids: [ER] }), null)).toBe(false);
    expect(isOutOfServiceUnitScope(tenant({ ids: [ER] }), undefined)).toBe(false);
  });
});

describe("contrato de rollout suave (regression guard)", () => {
  // Estas pruebas existen para impedir que alguien "endurezca" el helper
  // y rompa la compat backward: usuarios pre-Nivel-A no tienen asignaciones
  // y NO deben perder acceso a sus listados operativos hasta que un admin
  // los configure. Si esto cambia, debe ser un PR explícito y documentado.

  it("usuario sin asignaciones ve todo en serviceUnitIdInScope", () => {
    expect(serviceUnitIdInScope(tenant({ ids: [] }))).toBeUndefined();
  });

  it("usuario sin asignaciones ve todo en serviceUnitWhereFragment", () => {
    expect(serviceUnitWhereFragment(tenant({ ids: [] }), "serviceUnitId")).toEqual({});
  });

  it("usuario sin asignaciones no es bloqueado en mutaciones", () => {
    expect(isOutOfServiceUnitScope(tenant({ ids: [] }), QX)).toBe(false);
  });
});

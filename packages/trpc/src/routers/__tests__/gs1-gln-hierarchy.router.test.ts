/**
 * Tests unitarios: glnHierarchyRouter — US.F2.6.3.
 *
 * Estrategia: mock de Prisma + mock de withTenantContext.
 * Valida: CTE tree query, alta hijo, unicidad, validación GLN-13.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { glnHierarchyRouter } from "../gs1-gln-hierarchy.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// Mock de withTenantContext — en tests unitarios no queremos la transacción real.
vi.mock("../../rls-context", () => ({
  withTenantContext: vi.fn(async (_prisma: unknown, _tenant: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    return fn(_prisma);
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gs1AppendCheckDigit(root: string): string {
  const len = root.length;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const rightPos = len - 1 - i;
    const weight = rightPos % 2 === 0 ? 3 : 1;
    sum += parseInt(root[i]!, 10) * weight;
  }
  return root + ((10 - (sum % 10)) % 10).toString();
}

const VALID_GLN  = gs1AppendCheckDigit("061414199999");  // 13 dígitos
const GLN_ZERO   = "0000000000000";                      // todos ceros = check 0

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID_NF = "00000000-0000-0000-0000-000000000001";

let prisma: DeepMockProxy<PrismaClient>;

function mockQuery<T>(value: T) {
  return vi.fn().mockResolvedValue(value);
}

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// tree
// ---------------------------------------------------------------------------

describe("glnHierarchy.tree", () => {
  it("sin rootId construye query con parent_id IS NULL", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.tree({ rootId: undefined });

    expect(result).toEqual([]);
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("parent_id IS NULL");
  });

  it("con rootId usa WHERE id = $1", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await caller.tree({ rootId: UUID_A });

    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("WHERE id = $1::uuid");
  });

  it("construye árbol anidado a partir de filas planas", async () => {
    const rows = [
      { id: UUID_A, codigo: VALID_GLN, descripcion: "Almacén Central", tipo: "deposito", parent_id: null, depth: 0, activo: true },
      { id: UUID_B, codigo: GLN_ZERO,  descripcion: "Farmacia Piso 1", tipo: "farmacia", parent_id: UUID_A, depth: 1, activo: true },
    ];
    prisma.$queryRawUnsafe = mockQuery(rows);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const tree = await caller.tree({ rootId: undefined });

    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe(UUID_A);
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.id).toBe(UUID_B);
  });

  it("nodo huérfano (padre fuera del resultado) aparece como raíz", async () => {
    const rows = [
      { id: UUID_B, codigo: GLN_ZERO, descripcion: "Huérfano", tipo: "servicio", parent_id: UUID_NF, depth: 1, activo: true },
    ];
    prisma.$queryRawUnsafe = mockQuery(rows);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const tree = await caller.tree({});

    // El nodo sin padre en el mapa se eleva a raíz.
    expect(tree).toHaveLength(1);
    expect(tree[0]!.id).toBe(UUID_B);
  });
});

// ---------------------------------------------------------------------------
// createChild
// ---------------------------------------------------------------------------

describe("glnHierarchy.createChild", () => {
  it("rechaza GLN con longitud incorrecta (Zod)", async () => {
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.createChild({ codigo: "12345", descripcion: "Test", tipo: "farmacia" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rechaza GLN con dígito verificador inválido", async () => {
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    // Un GLN de 13 dígitos pero con el último dígito incorrecto.
    await expect(
      caller.createChild({ codigo: "0000000000001", descripcion: "X", tipo: "deposito" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("lanza CONFLICT si el código ya existe en el tenant", async () => {
    // Mock secuencia: 1er queryRawUnsafe = COUNT(*) = 1 (ya existe).
    prisma.$queryRawUnsafe = mockQuery([{ count: "1" }]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.createChild({ codigo: GLN_ZERO, descripcion: "Duplicado", tipo: "farmacia" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("inserta correctamente cuando el código no existe", async () => {
    // 1er call = COUNT = 0, 2do call = INSERT RETURNING id.
    let callCount = 0;
    prisma.$queryRawUnsafe = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? [{ count: "0" }] : [{ id: UUID_A }];
    });

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.createChild({
      codigo: GLN_ZERO,
      descripcion: "Farmacia Nueva",
      tipo: "farmacia",
      parentGlnId: UUID_B,
    });

    expect(result.id).toBe(UUID_A);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("rechaza tipo no permitido (Zod)", async () => {
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.createChild({
        codigo: GLN_ZERO,
        descripcion: "X",
        tipo: "almacen_refrigerado" as "deposito",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

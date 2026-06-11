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

// UUID_B: usado en parentGlnId del test createChild (input aceptado, no aplicado en DDL actual).
const UUID_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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
// NOTA: gs1_gln no tiene id/parent_id en DDL — tree devuelve lista plana.
// La jerarquía es BLOQUEANTE hasta que @DBA agregue esas columnas.
// ---------------------------------------------------------------------------

describe("glnHierarchy.tree", () => {
  it("sin rootCodigo retorna lista plana (depth=0, sin children)", async () => {
    const rows = [
      { codigo: VALID_GLN, descripcion: "Almacén Central", tipo: "deposito", activo: true },
      { codigo: GLN_ZERO,  descripcion: "Farmacia Piso 1", tipo: "farmacia", activo: true },
    ];
    prisma.$queryRawUnsafe = mockQuery(rows);
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.tree({});

    expect(result).toHaveLength(2);
    // Lista plana: todos depth=0, sin children
    expect(result[0]!.depth).toBe(0);
    expect(result[0]!.children).toEqual([]);
    // Retorna codigo, no id
    expect(result[0]!.codigo).toBe(VALID_GLN);
  });

  it("con rootCodigo usa LIKE $1 para filtrar por prefijo", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await caller.tree({ rootCodigo: "061" });

    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("LIKE $1");
  });

  it("retorna array vacío si BD no devuelve filas", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.tree({ rootCodigo: undefined });
    expect(result).toEqual([]);
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

  it("inserta correctamente cuando el código no existe y retorna codigo", async () => {
    // 1er call = COUNT = 0, 2do call = INSERT RETURNING codigo.
    let callCount = 0;
    prisma.$queryRawUnsafe = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? [{ count: "0" }] : [{ codigo: GLN_ZERO }];
    });

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.createChild({
      codigo: GLN_ZERO,
      descripcion: "Farmacia Nueva",
      tipo: "farmacia",
      // parentGlnId aceptado en input pero ignorado hasta que DDL tenga parent_id
      parentGlnId: UUID_B,
    });

    // Router retorna { codigo } — no { id }
    expect(result.codigo).toBe(GLN_ZERO);
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

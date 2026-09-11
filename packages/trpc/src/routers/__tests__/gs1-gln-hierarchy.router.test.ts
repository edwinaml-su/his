/**
 * Tests unitarios: glnHierarchyRouter — US.F2.6.3.
 *
 * Estrategia: mock de Prisma con `withEceContext` REAL (no se mockea el
 * módulo — mismo patrón que gs1-patient-trace.router.test.ts), porque el
 * router corre bajo el contexto RLS `ece` (GUC `app.ece_establecimiento_id`),
 * no `withTenantContext`. Se mockean `$transaction` (passthrough), `$executeRaw`
 * / `$executeRawUnsafe` (SET LOCAL del contexto ECE) y `$queryRaw` (usado por
 * `resolveEceEstablecimientoId`, que corre FUERA de la tx, sobre `ctx.prisma`
 * directo con rol bypass).
 * Valida: CTE tree query, alta hijo, unicidad, validación GLN-13, guard de
 * establecimiento activo, y que el INSERT setea `establecimiento_id`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { glnHierarchyRouter } from "../gs1-gln-hierarchy.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

const ECE_ESTABLECIMIENTO_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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

  // withEceContext real envuelve en $transaction e invoca SET LOCAL — mock
  // passthrough para que `tx` sea el mismo mock que `prisma` (igual que
  // gs1-patient-trace.router.test.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRaw = vi.fn().mockResolvedValue(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);
  // resolveEceEstablecimientoId corre sobre ctx.prisma directo (bypass, fuera
  // de la tx) vía $queryRaw (tagged template) — default: establecimiento ECE
  // ya inicializado. Tests que necesiten el caso "no inicializado" lo
  // sobrescriben con `[]`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRaw = vi.fn().mockResolvedValue([{ id: ECE_ESTABLECIMIENTO_ID }]);
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

  it("sin establecimiento activo: BAD_REQUEST, no toca prisma", async () => {
    const caller = glnHierarchyRouter.createCaller(
      makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
    );
    await expect(caller.tree({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("ECE no inicializado para el establecimiento: PRECONDITION_FAILED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = vi.fn().mockResolvedValue([]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.tree({})).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
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

  it("el INSERT setea establecimiento_id al resuelto para el establecimiento activo", async () => {
    let callCount = 0;
    prisma.$queryRawUnsafe = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? [{ count: "0" }] : [{ id: UUID_A }];
    });

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await caller.createChild({
      codigo: GLN_ZERO,
      descripcion: "Farmacia Nueva",
      tipo: "farmacia",
      parentGlnId: UUID_B,
    });

    const insertCall = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[1];
    const [sql, , , , , establecimientoIdParam] = insertCall as [string, ...unknown[]];
    expect(sql).toContain("establecimiento_id");
    expect(establecimientoIdParam).toBe(ECE_ESTABLECIMIENTO_ID);
  });

  it("sin establecimiento activo: BAD_REQUEST, no toca prisma", async () => {
    const caller = glnHierarchyRouter.createCaller(
      makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
    );
    await expect(
      caller.createChild({ codigo: GLN_ZERO, descripcion: "X", tipo: "deposito" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("ECE no inicializado para el establecimiento: PRECONDITION_FAILED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = vi.fn().mockResolvedValue([]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.createChild({ codigo: GLN_ZERO, descripcion: "X", tipo: "deposito" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
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

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("glnHierarchy.update", () => {
  it("rechaza si no envía ni descripcion ni tipo (Zod refine)", async () => {
    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.update({ id: UUID_A })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("actualiza descripcion y tipo, devuelve el id", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ id: UUID_A }]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.update({ id: UUID_A, descripcion: "Nueva desc", tipo: "farmacia" });

    expect(result).toEqual({ id: UUID_A });
    const [sql, ...params] = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(sql).toContain("UPDATE ece.gs1_gln SET");
    expect(sql).not.toContain("codigo =");
    expect(params).toEqual([UUID_A, "Nueva desc", "farmacia"]);
  });

  it("actualiza solo el campo enviado (descripcion)", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ id: UUID_A }]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await caller.update({ id: UUID_A, descripcion: "Solo desc" });

    const [, ...params] = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      ...unknown[],
    ];
    expect(params).toEqual([UUID_A, "Solo desc"]);
  });

  it("NOT_FOUND si el nodo no existe o es de otro establecimiento (RETURNING vacío)", async () => {
    prisma.$queryRawUnsafe = mockQuery([]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.update({ id: UUID_A, descripcion: "X" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sin establecimiento activo: BAD_REQUEST, no toca prisma", async () => {
    const caller = glnHierarchyRouter.createCaller(
      makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
    );
    await expect(
      caller.update({ id: UUID_A, descripcion: "X" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("ECE no inicializado para el establecimiento: PRECONDITION_FAILED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = vi.fn().mockResolvedValue([]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.update({ id: UUID_A, descripcion: "X" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

// ---------------------------------------------------------------------------
// setActivo
// ---------------------------------------------------------------------------

describe("glnHierarchy.setActivo", () => {
  it("desactiva un nodo sin hijos activos", async () => {
    let callCount = 0;
    prisma.$queryRawUnsafe = vi.fn().mockImplementation(async () => {
      callCount++;
      // 1er call: COUNT de hijos activos = 0. 2do call: UPDATE RETURNING id.
      return callCount === 1 ? [{ count: "0" }] : [{ id: UUID_A }];
    });

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.setActivo({ id: UUID_A, activo: false });

    expect(result).toEqual({ id: UUID_A, activo: false });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("bloquea desactivar un nodo con hijos activos (PRECONDITION_FAILED)", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ count: "2" }]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.setActivo({ id: UUID_A, activo: false }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("reactivar no consulta hijos — un solo UPDATE", async () => {
    prisma.$queryRawUnsafe = mockQuery([{ id: UUID_A }]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.setActivo({ id: UUID_A, activo: true });

    expect(result).toEqual({ id: UUID_A, activo: true });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("UPDATE ece.gs1_gln SET activo");
  });

  it("NOT_FOUND si el nodo no existe o es de otro establecimiento (RETURNING vacío)", async () => {
    let callCount = 0;
    prisma.$queryRawUnsafe = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? [{ count: "0" }] : [];
    });

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.setActivo({ id: UUID_A, activo: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sin establecimiento activo: BAD_REQUEST, no toca prisma", async () => {
    const caller = glnHierarchyRouter.createCaller(
      makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
    );
    await expect(
      caller.setActivo({ id: UUID_A, activo: false }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("ECE no inicializado para el establecimiento: PRECONDITION_FAILED", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = vi.fn().mockResolvedValue([]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.setActivo({ id: UUID_A, activo: false }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

// ---------------------------------------------------------------------------
// glnsDisponibles — selector Room/Bed (sql/231, encargo Edwin 2026-09-11)
// ---------------------------------------------------------------------------
describe("glnHierarchyRouter.glnsDisponibles", () => {
  it("lista GLN activos de los tipos pedidos y marca los ya asignados", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi
      .fn()
      .mockResolvedValueOnce([
        { codigo: "7410398000262", descripcion: "Sydney", tipo: "cama" },
        { codigo: "7410398000279", descripcion: "Tarawa", tipo: "cama" },
      ])
      .mockResolvedValueOnce([{ glnCodigo: "7410398000262", entity: "bed" }]);

    const caller = glnHierarchyRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.glnsDisponibles({ tipos: ["cama"] });

    expect(result).toEqual([
      { codigo: "7410398000262", descripcion: "Sydney", tipo: "cama", asignadoA: "bed" },
      { codigo: "7410398000279", descripcion: "Tarawa", tipo: "cama", asignadoA: null },
    ]);
    expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("ece.gs1_gln"),
      ["cama"],
    );
  });

  it("no filtra por establecimiento (los GLN cama no tienen establecimiento_id propio)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRawUnsafe = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const caller = glnHierarchyRouter.createCaller(
      makeCtx({ prisma, tenant: MOCK_TENANT_NO_ESTABLISHMENT }),
    );
    await expect(caller.glnsDisponibles({ tipos: ["cama"] })).resolves.toEqual([]);
  });
});

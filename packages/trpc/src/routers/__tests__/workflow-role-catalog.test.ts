/**
 * Tests de validación de roles contra el catálogo ECE — hallazgo PR #594
 * (2026-08-28, US.F2.2.18).
 *
 * `validateRoles` / `detectRoleOrphans` (workflow-publicacion.router) y
 * `validateGraph` (workflow-validator-visual.router) validaban códigos de
 * rol contra `public."Role"` — catálogo RBAC de tRPC cuya columna es
 * `code`, no `codigo` — así que la query rompía con SQL 42703 en cuanto
 * había roles que validar. El catálogo correcto es `ece.rol`, el mismo que
 * `ece.flujo_transicion.rol_autoriza_id` referencia por FK (mismo fix que
 * PR #594 aplicó a publish()).
 *
 * Estos tests cubren:
 *  1. validateRoles — marca existe true/false y consulta ece.rol.
 *  2. detectRoleOrphans — persiste solo los huérfanos y consulta ece.rol.
 *  3. detectRoleOrphans — sin roles referenciados no toca el catálogo.
 *  4. validateGraph — rol inexistente en ece.rol produce issue WF011.
 *
 * Mocking: mockDeep<PrismaClient> + createCaller (mismo patrón que
 * workflow-publicacion-rollback.test.ts / accounting.test.ts). $queryRaw se
 * secuencia con mockResolvedValueOnce en el orden exacto del router.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowPublicacionRouter } from "../workflow-publicacion.router";
import { workflowValidatorVisualRouter } from "../workflow-validator-visual.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const TIPO_DOC_ID = "30000000-0000-0000-0000-000000000001";
const DIR_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR"] };

/**
 * Extrae el texto SQL del primer argumento de una llamada a $queryRaw:
 * tagged template → TemplateStringsArray; Prisma.sql → instancia Sql con
 * `.strings`. En ambos casos el texto está en un array de fragmentos.
 */
function sqlTextOf(call: unknown[]): string {
  const first = call[0] as { strings?: readonly string[] } | readonly string[];
  if (Array.isArray(first)) return first.join(" ");
  return ((first as { strings?: readonly string[] }).strings ?? []).join(" ");
}

describe("workflowPublicacionRouter.validateRoles — valida contra ece.rol", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it("marca existe=true para roles del catálogo y false para los fantasma", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ codigo: "MC" }]);

    const caller = workflowPublicacionRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.validateRoles({ rolCodigos: ["MC", "ROL_FANTASMA"] });

    expect(result).toEqual([
      { codigo: "MC", existe: true },
      { codigo: "ROL_FANTASMA", existe: false },
    ]);
  });

  it("consulta ece.rol, no public.\"Role\" (42703: Role.codigo no existe)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any).mockResolvedValueOnce([]);

    const caller = workflowPublicacionRouter.createCaller(makeCtx({ prisma }));
    await caller.validateRoles({ rolCodigos: ["MC"] });

    const sql = sqlTextOf((prisma.$queryRaw as any).mock.calls[0]);
    expect(sql).toContain("ece.rol");
    expect(sql).not.toContain('"Role"');
  });
});

describe("workflowPublicacionRouter.detectRoleOrphans — catálogo ece.rol", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$executeRaw as any).mockResolvedValue(1);
  });

  function makeDirCaller() {
    return workflowPublicacionRouter.createCaller(makeCtx({ prisma, tenant: DIR_TENANT }));
  }

  it("persiste solo los roles que NO existen en ece.rol", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any)
      .mockResolvedValueOnce([
        {
          id: "30000000-0000-0000-0000-000000000010",
          tipo_doc_id: TIPO_DOC_ID,
          snapshot_jsonb: {
            edges: [
              { rolCodigo: "MC" },
              { rolCodigo: "ROL_FANTASMA" },
              { rolCodigo: undefined },
            ],
          },
        },
      ]) // 1. workflows publicados
      .mockResolvedValueOnce([{ codigo: "MC" }]); // 2. ece.rol existentes

    const result = await makeDirCaller().detectRoleOrphans({ tipDocumentoId: TIPO_DOC_ID });

    expect(result).toEqual({ detected: 1 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

    // El INSERT a workflow_role_orphan lleva el rol huérfano, no el válido
    const insertCall = JSON.stringify((prisma.$executeRaw as any).mock.calls[0]);
    expect(insertCall).toContain("ROL_FANTASMA");
    expect(insertCall).not.toContain('"MC"');

    // La query de catálogo apunta a ece.rol
    const sql = sqlTextOf((prisma.$queryRaw as any).mock.calls[1]);
    expect(sql).toContain("ece.rol");
    expect(sql).not.toContain('"Role"');
  });

  it("sin roles referenciados en los snapshots no consulta el catálogo", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any).mockResolvedValueOnce([
      {
        id: "30000000-0000-0000-0000-000000000011",
        tipo_doc_id: TIPO_DOC_ID,
        snapshot_jsonb: { edges: [{ rolCodigo: undefined }] },
      },
    ]);

    const result = await makeDirCaller().detectRoleOrphans({});

    expect(result).toEqual({ detected: 0 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("workflowValidatorVisualRouter.validateGraph — roles contra ece.rol", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  const NODES = [
    { id: "n1", nombre: "Borrador", es_inicial: true, es_final: false },
    { id: "n2", nombre: "Firmado", es_inicial: false, es_final: true },
  ];

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  function makeCaller() {
    return workflowValidatorVisualRouter.createCaller(makeCtx({ prisma }));
  }

  it("rol inexistente en ece.rol produce issue WF011 (error)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any).mockResolvedValueOnce([]); // ece.rol: ninguno existe

    const result = await makeCaller().validateGraph({
      nodes: NODES,
      edges: [
        { id: "e1", source: "n1", target: "n2", accion: "firmar", rolCodigo: "ROL_FANTASMA" },
      ],
      checkRoles: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "WF011")).toBe(true);

    const sql = sqlTextOf((prisma.$queryRaw as any).mock.calls[0]);
    expect(sql).toContain("ece.rol");
    expect(sql).not.toContain('"Role"');
  });

  it("rol existente en ece.rol no genera WF011", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ codigo: "MC" }]);

    const result = await makeCaller().validateGraph({
      nodes: NODES,
      edges: [{ id: "e1", source: "n1", target: "n2", accion: "firmar", rolCodigo: "MC" }],
      checkRoles: true,
    });

    expect(result.issues.some((i) => i.code === "WF011")).toBe(false);
  });
});

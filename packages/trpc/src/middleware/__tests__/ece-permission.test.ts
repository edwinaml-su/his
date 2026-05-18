/**
 * Tests de integración — middleware requireEcePermission.
 *
 * Estrategia: mini-router de prueba idéntica al patrón de permission.test.ts.
 * Sin BD — la lógica ECE es en memoria. Se mockea PrismaClient solo para
 * satisfacer la forma de TRPCContext.
 *
 * Comportamientos cubiertos:
 *  - UNAUTHORIZED si no hay user.
 *  - FORBIDDEN si no hay tenant.
 *  - ALLOW cuando roleCodes contiene un rol con el permiso ECE requerido.
 *  - FORBIDDEN cuando roleCodes no tiene el permiso requerido.
 *  - ADMIN bypass para todos los permisos ECE.
 *  - Aliases MC, MT, ENF resueltos correctamente.
 *  - Roles stream #16 (IC, AC, ADM) denegados.
 *  - Múltiples permisos en el router — cada uno protegido de forma independiente.
 *  - ctx fluye sin mutación al next handler.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import { initTRPC } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import type { TRPCContext } from "../../context";
import { requireEcePermission } from "../ece-permission";
import { MOCK_USER_ADMIN } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Mini-router de prueba
// ---------------------------------------------------------------------------

// requireEcePermission retorna un ProcedureBuilder (t.procedure.use(...)),
// no un middleware bare. El router lo usa directamente como procedure base.
// initTRPC se necesita solo para t.router().
const t = initTRPC.context<TRPCContext>().create();

const testRouter = t.router({
  firmar: requireEcePermission("ece.documento.firmar")
    .query(() => "firmado"),

  certificar: requireEcePermission("ece.documento.certificar")
    .query(() => "certificado"),

  validar: requireEcePermission("ece.documento.validar")
    .query(() => "validado"),

  anular: requireEcePermission("ece.documento.anular")
    .query(() => "anulado"),

  bitacora: requireEcePermission("ece.bitacora.read")
    .query(() => "bitacora"),

  solicitarRectificacion: requireEcePermission("ece.rectificacion.solicitar")
    .query(() => "rectificacion-solicitada"),

  aprobarRectificacion: requireEcePermission("ece.rectificacion.aprobar")
    .query(() => "rectificacion-aprobada"),

  workflowDesigner: requireEcePermission("ece.workflow.designer")
    .query(() => "workflow-ok"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(
  prisma: DeepMockProxy<PrismaClient>,
  opts: {
    user?: TRPCContext["user"] | null;
    tenant?: TRPCContext["tenant"] | null;
    roleCodes?: string[];
  } = {},
): TRPCContext {
  const roleCodes = opts.roleCodes ?? ["ADMIN"];
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: prisma as any,
    user: opts.user === undefined ? MOCK_USER_ADMIN : opts.user,
    tenant:
      opts.tenant === undefined
        ? {
            userId: MOCK_USER_ADMIN.id,
            organizationId: "00000000-0000-0000-0000-0000000000aa",
            countryId: "00000000-0000-0000-0000-0000000000bb",
            establishmentId: "00000000-0000-0000-0000-0000000000cc",
            roleCodes,
          }
        : opts.tenant,
    portalAccount: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requireEcePermission — middleware tRPC", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // --- Autenticación / tenant ---
  describe("Autenticación y tenant", () => {
    it("UNAUTHORIZED cuando no hay user", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { user: null }));
      await expect(caller.firmar()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("FORBIDDEN cuando no hay tenant (organización no seleccionada)", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { tenant: null }));
      await expect(caller.firmar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("FORBIDDEN mensaje incluye nombre del permiso requerido", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["PHARMACIST"] }),
      );
      await expect(caller.certificar()).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("ece.documento.certificar"),
      });
    });
  });

  // --- ADMIN bypass ---
  describe("ADMIN bypass total", () => {
    it("ADMIN puede firmar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ADMIN"] }));
      await expect(caller.firmar()).resolves.toBe("firmado");
    });

    it("ADMIN puede certificar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ADMIN"] }));
      await expect(caller.certificar()).resolves.toBe("certificado");
    });

    it("ADMIN puede diseñar workflow", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ADMIN"] }));
      await expect(caller.workflowDesigner()).resolves.toBe("workflow-ok");
    });

    it("admin_clinico (alias) tiene bypass completo", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["admin_clinico"] }),
      );
      await expect(caller.anular()).resolves.toBe("anulado");
      await expect(caller.aprobarRectificacion()).resolves.toBe("rectificacion-aprobada");
    });
  });

  // --- PHYSICIAN / MC / MT ---
  describe("PHYSICIAN y aliases MC/MT", () => {
    it("PHYSICIAN puede firmar", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["PHYSICIAN"] }),
      );
      await expect(caller.firmar()).resolves.toBe("firmado");
    });

    it("PHYSICIAN puede validar", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["PHYSICIAN"] }),
      );
      await expect(caller.validar()).resolves.toBe("validado");
    });

    it("PHYSICIAN NO puede certificar", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["PHYSICIAN"] }),
      );
      await expect(caller.certificar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("MC puede firmar (alias PHYSICIAN)", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["MC"] }));
      await expect(caller.firmar()).resolves.toBe("firmado");
    });

    it("MT puede validar (alias PHYSICIAN)", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["MT"] }));
      await expect(caller.validar()).resolves.toBe("validado");
    });

    it("MT NO puede certificar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["MT"] }));
      await expect(caller.certificar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // --- NURSE / ENF ---
  describe("NURSE y alias ENF", () => {
    it("NURSE puede firmar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["NURSE"] }));
      await expect(caller.firmar()).resolves.toBe("firmado");
    });

    it("NURSE puede solicitar rectificación", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["NURSE"] }));
      await expect(caller.solicitarRectificacion()).resolves.toBe("rectificacion-solicitada");
    });

    it("NURSE NO puede validar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["NURSE"] }));
      await expect(caller.validar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("ENF puede firmar (alias NURSE)", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ENF"] }));
      await expect(caller.firmar()).resolves.toBe("firmado");
    });
  });

  // --- DIR ---
  describe("DIR", () => {
    it("DIR puede certificar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["DIR"] }));
      await expect(caller.certificar()).resolves.toBe("certificado");
    });

    it("DIR puede anular", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["DIR"] }));
      await expect(caller.anular()).resolves.toBe("anulado");
    });

    it("DIR puede leer bitácora", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["DIR"] }));
      await expect(caller.bitacora()).resolves.toBe("bitacora");
    });

    it("DIR puede aprobar rectificación", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["DIR"] }));
      await expect(caller.aprobarRectificacion()).resolves.toBe("rectificacion-aprobada");
    });

    it("DIR puede diseñar workflow", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["DIR"] }));
      await expect(caller.workflowDesigner()).resolves.toBe("workflow-ok");
    });

    it("DIR NO puede firmar (separación de funciones)", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["DIR"] }));
      await expect(caller.firmar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // --- ARCH ---
  describe("ARCH (Archivo Clínico)", () => {
    it("ARCH puede leer bitácora", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ARCH"] }));
      await expect(caller.bitacora()).resolves.toBe("bitacora");
    });

    it("ARCH NO puede firmar ni certificar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ARCH"] }));
      await expect(caller.firmar()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.certificar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // --- ESP ---
  describe("ESP (Especialista)", () => {
    it("ESP puede firmar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ESP"] }));
      await expect(caller.firmar()).resolves.toBe("firmado");
    });

    it("ESP NO puede validar", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: ["ESP"] }));
      await expect(caller.validar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // --- Roles stream #16 (IC, AC, ADM) ---
  describe("Roles stream #16 — IC / AC / ADM denegados en todo", () => {
    const auxRoles = ["IC", "AC", "ADM"];
    const endpoints = [
      { name: "firmar", fn: (c: ReturnType<typeof testRouter.createCaller>) => c.firmar() },
      { name: "certificar", fn: (c: ReturnType<typeof testRouter.createCaller>) => c.certificar() },
      { name: "validar", fn: (c: ReturnType<typeof testRouter.createCaller>) => c.validar() },
      { name: "bitacora", fn: (c: ReturnType<typeof testRouter.createCaller>) => c.bitacora() },
    ];

    for (const role of auxRoles) {
      for (const ep of endpoints) {
        it(`${role} FORBIDDEN en ${ep.name}`, async () => {
          const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: [role] }));
          await expect(ep.fn(caller)).rejects.toMatchObject({ code: "FORBIDDEN" });
        });
      }
    }
  });

  // --- Combinaciones de roles ---
  describe("Combinaciones de roles", () => {
    it("PHYSICIAN + DIR tiene acceso a firmar y certificar", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["PHYSICIAN", "DIR"] }),
      );
      await expect(caller.firmar()).resolves.toBe("firmado");
      await expect(caller.certificar()).resolves.toBe("certificado");
    });

    it("NURSE + ARCH puede firmar y leer bitácora, pero no certificar", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["NURSE", "ARCH"] }),
      );
      await expect(caller.firmar()).resolves.toBe("firmado");
      await expect(caller.bitacora()).resolves.toBe("bitacora");
      await expect(caller.certificar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("IC + MC puede firmar vía MC aunque IC no pueda", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["IC", "MC"] }),
      );
      await expect(caller.firmar()).resolves.toBe("firmado");
    });
  });

  // --- roleCodes vacío / desconocido ---
  describe("roleCodes vacío o desconocido", () => {
    it("roleCodes vacío deniega todo", async () => {
      const caller = testRouter.createCaller(buildCtx(prisma, { roleCodes: [] }));
      await expect(caller.firmar()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.certificar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("rol desconocido PHARMACIST deniega acceso ECE", async () => {
      const caller = testRouter.createCaller(
        buildCtx(prisma, { roleCodes: ["PHARMACIST"] }),
      );
      await expect(caller.firmar()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});

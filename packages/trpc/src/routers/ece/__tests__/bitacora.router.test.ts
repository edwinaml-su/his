/**
 * Tests del bitacoraRouter (ECE — Bitácora de Acceso, NTEC Arts. 45-52).
 *
 * Cubre:
 *   list:      happy-path con filtros; sin resultados; FORBIDDEN sin rol.
 *   exportCsv: genera base64 válido con cabeceras CSV.
 *   register:  happy-path; rechaza userId ajeno con FORBIDDEN.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bitacoraRouter } from "../bitacora.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

const ROW_ID    = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const FIRMA_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID   = MOCK_USER_ADMIN.id;

function makeDbRow(overrides: Partial<{
  id: string;
  firma_id: string | null;
  user_id: string;
  paciente_id: string | null;
  accion: string;
  exito: boolean;
  contexto: string | null;
  ip: string | null;
  registrado_en: Date;
}> = {}) {
  return {
    id:            overrides.id            ?? ROW_ID,
    firma_id:      overrides.firma_id      ?? FIRMA_ID,
    user_id:       overrides.user_id       ?? USER_ID,
    paciente_id:   overrides.paciente_id   ?? null,
    accion:        overrides.accion        ?? "view",
    exito:         overrides.exito         ?? true,
    contexto:      overrides.contexto      ?? null,
    ip:            overrides.ip            ?? "127.0.0.1",
    registrado_en: overrides.registrado_en ?? new Date("2026-01-15T10:00:00Z"),
  };
}

/** Crea ctx con rol DIR por defecto. */
function makeDirCtx(prisma: DeepMockProxy<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: { ...MOCK_TENANT, roleCodes: ["DIR"] },
  });
}

describe("bitacoraRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------
  describe("list", () => {
    it("happy-path: devuelve items y total con filtros de fecha", async () => {
      const row = makeDbRow();
      // COUNT query
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ total: BigInt(1) }]);
      // DATA query
      prisma.$queryRawUnsafe.mockResolvedValueOnce([row]);

      const caller = bitacoraRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.list({
        desde: "2026-01-01T00:00:00Z",
        hasta:  "2026-01-31T23:59:59Z",
        limit: 50,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(ROW_ID);
      expect(result.items[0]?.accion).toBe("view");
      expect(result.items[0]?.registradoEn).toBe("2026-01-15T10:00:00.000Z");
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it("devuelve lista vacía cuando no hay registros", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ total: BigInt(0) }]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = bitacoraRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.list({ limit: 50, offset: 0 });

      expect(result.total).toBe(0);
      expect(result.items).toHaveLength(0);
    });

    it("filtra por accion correctamente", async () => {
      const row = makeDbRow({ accion: "export" });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ total: BigInt(1) }]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([row]);

      const caller = bitacoraRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.list({ accion: "export", limit: 50, offset: 0 });

      expect(result.items[0]?.accion).toBe("export");
    });

    it("devuelve FORBIDDEN si usuario no tiene rol DIR o ARCH", async () => {
      const sinRol = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["NURSE"] },
      });
      const caller = bitacoraRouter.createCaller(sinRol);
      await expect(
        caller.list({ limit: 50, offset: 0 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // -------------------------------------------------------------------------
  // exportCsv
  // -------------------------------------------------------------------------
  describe("exportCsv", () => {
    it("genera base64 con cabecera CSV y fila correcta", async () => {
      const row = makeDbRow({ ip: "10.0.0.1", contexto: "historia::view" });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([row]);

      const caller = bitacoraRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.exportCsv({});

      expect(result.rowCount).toBe(1);

      const decoded = Buffer.from(result.base64, "base64").toString("utf-8");
      const lines = decoded.split("\n");

      // Cabecera
      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("accion");
      expect(lines[0]).toContain("registrado_en");

      // Primera fila de datos
      expect(lines[1]).toContain(ROW_ID);
      expect(lines[1]).toContain("view");
      expect(lines[1]).toContain("historia::view");
    });

    it("devuelve FORBIDDEN sin rol DIR/ARCH", async () => {
      const sinRol = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] },
      });
      const caller = bitacoraRouter.createCaller(sinRol);
      await expect(caller.exportCsv({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // -------------------------------------------------------------------------
  // metrics
  // -------------------------------------------------------------------------
  describe("metrics", () => {
    it("retorna ceros cuando no hay filas en el periodo", async () => {
      // totalAccesos
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);
      // totalFirmas
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(0) }]);
      // topDocumentos
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);
      // topUsuarios
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      const caller = bitacoraRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.metrics({});

      expect(result.totalAccesos).toBe(0);
      expect(result.totalFirmas).toBe(0);
      expect(result.topDocumentos).toHaveLength(0);
      expect(result.topUsuarios).toHaveLength(0);
    });

    it("retorna metricas correctas con filas existentes", async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(42) }]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ count: BigInt(5) }]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { contexto: "historia::view", count: BigInt(10) },
        { contexto: "epicrisis::view", count: BigInt(8) },
      ]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        { user_id: USER_ID, count: BigInt(20) },
      ]);

      const caller = bitacoraRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.metrics({
        desde: "2026-01-01T00:00:00Z",
        hasta:  "2026-01-31T23:59:59Z",
      });

      expect(result.totalAccesos).toBe(42);
      expect(result.totalFirmas).toBe(5);
      expect(result.topDocumentos).toHaveLength(2);
      expect(result.topDocumentos[0]).toEqual({ documento: "historia::view", accesos: 10 });
      expect(result.topUsuarios[0]).toEqual({ userId: USER_ID, accesos: 20 });
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(4);
    });

    it("devuelve FORBIDDEN sin rol DIR/ARCH", async () => {
      const sinRol = makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] },
      });
      const caller = bitacoraRouter.createCaller(sinRol);
      await expect(caller.metrics({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------
  describe("register", () => {
    it("happy-path: inserta fila y devuelve ok:true", async () => {
      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      const caller = bitacoraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.register({
        userId:  USER_ID,
        accion:  "view",
        exito:   true,
        firmaId: FIRMA_ID,
        ip:      "192.168.1.1",
      });

      expect(result.ok).toBe(true);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledOnce();
    });

    it("rechaza userId diferente al usuario en sesión (FORBIDDEN)", async () => {
      const otroUserId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const caller = bitacoraRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.register({
          userId:  otroUserId,
          accion:  "view",
          exito:   true,
          firmaId: FIRMA_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("permite registro sin firmaId (log de sistema)", async () => {
      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      const caller = bitacoraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.register({
        userId: USER_ID,
        accion: "view",
        exito:  true,
        // firmaId omitido → log de sistema
      });

      expect(result.ok).toBe(true);
    });
  });
});

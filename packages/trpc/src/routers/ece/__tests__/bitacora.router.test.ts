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
const PERSO_ID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const RECURSO_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const USER_ID   = MOCK_USER_ADMIN.id;

// Columnas reales de ece.bitacora_acceso (remapeadas 2026-06-11):
//   exito→autorizado, ip→ip_origen, registrado_en→ocurrido_en,
//   user_id→auth_user_id, contexto→justificacion, + personal_id FK.
function makeDbRow(overrides: Partial<{
  id: string;
  personal_id: string | null;
  recurso_id: string | null;
  accion: string;
  autorizado: boolean;
  ip_origen: string | null;
  ocurrido_en: Date;
  justificacion: string | null;
  auth_user_id: string | null;
  establecimiento_id: string | null;
  flag_outlier: boolean;
  motivo_outlier: string | null;
}> = {}) {
  return {
    id:                 overrides.id                 ?? ROW_ID,
    personal_id:        overrides.personal_id        ?? PERSO_ID,
    recurso_id:         overrides.recurso_id         ?? null,
    accion:             overrides.accion             ?? "view",
    autorizado:         overrides.autorizado         ?? true,
    ip_origen:          overrides.ip_origen          ?? "127.0.0.1",
    ocurrido_en:        overrides.ocurrido_en        ?? new Date("2026-01-15T10:00:00Z"),
    justificacion:      overrides.justificacion      ?? null,
    auth_user_id:       overrides.auth_user_id       ?? USER_ID,
    establecimiento_id: overrides.establecimiento_id ?? null,
    flag_outlier:       overrides.flag_outlier       ?? false,
    motivo_outlier:     overrides.motivo_outlier     ?? null,
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
      expect(result.items[0]?.ocurridoEn).toBe("2026-01-15T10:00:00.000Z");
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
      const row = makeDbRow({ ip_origen: "10.0.0.1", justificacion: "historia::view" });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([row]);

      const caller = bitacoraRouter.createCaller(makeDirCtx(prisma));
      const result = await caller.exportCsv({});

      expect(result.rowCount).toBe(1);

      const decoded = Buffer.from(result.base64, "base64").toString("utf-8");
      const lines = decoded.split("\n");

      // Cabecera
      expect(lines[0]).toContain("id");
      expect(lines[0]).toContain("accion");
      expect(lines[0]).toContain("ocurrido_en");

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
    // El router remapeado siempre inserta ctx.user.id como auth_user_id; el
    // auth_user_id ya no es un input del cliente, por lo que el antiguo guard
    // "rechaza userId ajeno (FORBIDDEN)" dejó de aplicar — se reemplazó por una
    // assertion de que el INSERT usa el id de la sesión.
    it("happy-path: inserta fila y devuelve ok:true", async () => {
      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      const caller = bitacoraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.register({
        accion:     "view",
        autorizado: true,
        recursoId:  RECURSO_ID,
        ip:         "192.168.1.1",
      });

      expect(result.ok).toBe(true);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledOnce();
      // auth_user_id es el 7º parámetro del INSERT y proviene de ctx.user.id.
      const callParams = prisma.$executeRawUnsafe.mock.calls[0]?.slice(1);
      expect(callParams?.[6]).toBe(USER_ID);
    });

    it("registra acción no autorizada (autorizado:false)", async () => {
      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      const caller = bitacoraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.register({
        accion:     "view",
        autorizado: false,
      });

      expect(result.ok).toBe(true);
      const callParams = prisma.$executeRawUnsafe.mock.calls[0]?.slice(1);
      expect(callParams?.[3]).toBe(false); // autorizado
    });

    it("permite registro sin recursoId (log de sistema)", async () => {
      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      const caller = bitacoraRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.register({
        accion: "view",
        // recursoId omitido → log de sistema; autorizado usa default true
      });

      expect(result.ok).toBe(true);
    });
  });
});

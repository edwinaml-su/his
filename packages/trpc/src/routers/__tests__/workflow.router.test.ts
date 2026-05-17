/**
 * Tests de integración del motor de workflow ECE.
 *
 * Cubre:
 *   workflow.estado.*       — list, create, update (CRUD estados del flujo)
 *   workflow.transicion.*   — list, create, update (transiciones permitidas)
 *   workflow.role.*         — list, assign, revoke (matriz LLENA/RESP/AUTORIZA/FIRMA)
 *   canTransition / executeTransition — lógica de avance de instancias (§instance.*)
 *
 * Permisos: requireRole(["DIR","WORKFLOW_DESIGNER"]) bloquea tenants sin esos roles.
 * Mock: $queryRaw y $executeRaw mockeados con vi.fn(); $transaction pasa el mock directo.
 *
 * Trazabilidad:
 *   docs/backlog/fase2/03_epic_workflow_engine.md (US.F2.1.1 – US.F2.1.8)
 *   docs/backlog/fase2/_insumos/05_motor_workflow.sql
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { workflowEstadoRouter } from "../workflow-estado.router";
import { canTransition, executeTransition } from "../../workflow/transitions";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TIPO_DOC_ID = "00000000-0000-0000-0000-000000000001";
const ESTADO_A_ID = "00000000-0000-0000-0000-000000000002";  // borrador
const ESTADO_B_ID = "00000000-0000-0000-0000-000000000003";  // firmado
const TRANSICION_ID = "00000000-0000-0000-0000-000000000004";
const ROL_ID = "00000000-0000-0000-0000-000000000005";
const INSTANCIA_ID = "00000000-0000-0000-0000-000000000006";
const FIRMA_ID = "00000000-0000-0000-0000-000000000007";
const DOC_ROL_ID = "00000000-0000-0000-0000-000000000008";

/** Tenant con roles de workflow (DIR / WORKFLOW_DESIGNER). */
const WORKFLOW_TENANT = { ...MOCK_TENANT, roleCodes: ["DIR", "WORKFLOW_DESIGNER"] };

/** Tenant sin roles de workflow — debe recibir FORBIDDEN. */
const UNPRIVILEGED_TENANT = { ...MOCK_TENANT, roleCodes: ["PHYSICIAN"] };

/** EceContext mínimo para las funciones de transición. */
const ECE_CTX = {
  personalId: "00000000-0000-0000-0000-000000000010",
  establecimientoId: "00000000-0000-0000-0000-000000000011",
  roles: ["MC"],
};

/** Estado de flujo borrador. */
const ESTADO_BORRADOR = {
  id: ESTADO_A_ID,
  tipo_documento_id: TIPO_DOC_ID,
  codigo: "borrador",
  nombre: "Borrador",
  es_inicial: true,
  es_final: false,
  orden: 1,
};

/** Estado de flujo firmado. */
const ESTADO_FIRMADO = {
  id: ESTADO_B_ID,
  tipo_documento_id: TIPO_DOC_ID,
  codigo: "firmado",
  nombre: "Firmado",
  es_inicial: false,
  es_final: false,
  orden: 2,
};

/** Transición borrador → firmado, rol MC, requiere firma. */
const TRANSICION_ROW = {
  id: TRANSICION_ID,
  tipo_documento_id: TIPO_DOC_ID,
  estado_origen_id: ESTADO_A_ID,
  estado_destino_id: ESTADO_B_ID,
  accion: "firmar",
  rol_autoriza_id: ROL_ID,
  requiere_firma: true,
  rol_codigo: "MC",
  rol_nombre: "Médico Clínico",
};

/** Instancia en estado borrador. */
const INSTANCIA_ROW = {
  id: INSTANCIA_ID,
  estado_actual_id: ESTADO_A_ID,
  tipo_documento_id: TIPO_DOC_ID,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Crea ctx de workflow con mock de prisma y transacción identidad. */
function workflowCtx(prisma: Partial<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: WORKFLOW_TENANT,
  });
}

/** Crea ctx sin privilegios de workflow. */
function unprivilegedCtx(prisma: Partial<PrismaClient>) {
  return makeCtx({
    prisma,
    tenant: UNPRIVILEGED_TENANT,
  });
}

// ─── Suite principal ─────────────────────────────────────────────────────────

describe("workflowEstadoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // Transacciones: ejecutar el callback directamente sobre el mock.
    prisma.$transaction.mockImplementation(async (fn) => {
      if (typeof fn === "function") return fn(prisma as unknown as PrismaClient);
      return fn;
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PERMISOS TRANSVERSALES — requireRole(["DIR","WORKFLOW_DESIGNER"])
  // ═══════════════════════════════════════════════════════════════════════════

  describe("permisos — rol insuficiente", () => {
    it("estado.list rechaza usuario sin DIR/WORKFLOW_DESIGNER", async () => {
      const caller = workflowEstadoRouter.createCaller(unprivilegedCtx(prisma));
      await expect(
        caller.estado.list({ tipDocumentoId: TIPO_DOC_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("estado.create rechaza usuario sin DIR/WORKFLOW_DESIGNER", async () => {
      const caller = workflowEstadoRouter.createCaller(unprivilegedCtx(prisma));
      await expect(
        caller.estado.create({
          tipDocumentoId: TIPO_DOC_ID,
          codigo: "borrador",
          nombre: "Borrador",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("transicion.create rechaza usuario sin rol de workflow", async () => {
      const caller = workflowEstadoRouter.createCaller(unprivilegedCtx(prisma));
      await expect(
        caller.transicion.create({
          tipDocumentoId: TIPO_DOC_ID,
          estadoOrigenId: ESTADO_A_ID,
          estadoDestinoId: ESTADO_B_ID,
          accion: "firmar",
          rolAutorizaId: ROL_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("role.assign rechaza usuario sin rol de workflow", async () => {
      const caller = workflowEstadoRouter.createCaller(unprivilegedCtx(prisma));
      await expect(
        caller.role.assign({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "LLENA",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // workflow.estado.*
  // ═══════════════════════════════════════════════════════════════════════════

  describe("estado.list", () => {
    it("retorna lista de estados ordenada por tipo_documento_id", async () => {
      prisma.$queryRaw.mockResolvedValue([ESTADO_BORRADOR, ESTADO_FIRMADO] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.estado.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(2);
      expect(result[0]!.codigo).toBe("borrador");
      expect(result[1]!.codigo).toBe("firmado");
    });

    it("retorna lista vacía si no hay estados para el tipo", async () => {
      prisma.$queryRaw.mockResolvedValue([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.estado.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(0);
    });

    it("lanza BAD_REQUEST si tipDocumentoId no es UUID válido (Zod)", async () => {
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.estado.list({ tipDocumentoId: "no-es-uuid" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe("estado.create", () => {
    it("NOT_FOUND si tipo_documento no existe", async () => {
      // Primera query: tipo_documento lookup → vacío
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.estado.create({
          tipDocumentoId: TIPO_DOC_ID,
          codigo: "borrador",
          nombre: "Borrador",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("CONFLICT si ya existe un estado con el mismo codigo para el tipo", async () => {
      // 1ra: tipo_documento existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never);
      // 2da: duplicado existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_A_ID }] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.estado.create({
          tipDocumentoId: TIPO_DOC_ID,
          codigo: "borrador",
          nombre: "Borrador",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("crea estado correctamente y retorna {created, prev:null}", async () => {
      // 1ra: tipo_documento existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never);
      // 2da: sin duplicado
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      // 3ra: INSERT RETURNING
      prisma.$queryRaw.mockResolvedValueOnce([ESTADO_BORRADOR] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.estado.create({
        tipDocumentoId: TIPO_DOC_ID,
        codigo: "borrador",
        nombre: "Borrador",
        esInicial: true,
      });
      expect(result.created).toBeDefined();
      expect(result.prev).toBeNull();
      expect(result.created!.codigo).toBe("borrador");
    });

    it("lanza BAD_REQUEST si codigo vacío (Zod)", async () => {
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.estado.create({
          tipDocumentoId: TIPO_DOC_ID,
          codigo: "",
          nombre: "Borrador",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe("estado.update", () => {
    it("NOT_FOUND si el estado no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.estado.update({ id: ESTADO_A_ID, nombre: "Nuevo nombre" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("actualiza nombre y retorna {updated, prev} con snapshot anterior", async () => {
      // 1ra: SELECT previo
      prisma.$queryRaw.mockResolvedValueOnce([ESTADO_BORRADOR] as never);
      const actualizado = { ...ESTADO_BORRADOR, nombre: "Borrador v2" };
      // 2da: UPDATE RETURNING
      prisma.$queryRaw.mockResolvedValueOnce([actualizado] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.estado.update({
        id: ESTADO_A_ID,
        nombre: "Borrador v2",
      });
      expect(result.prev!.nombre).toBe("Borrador");
      expect(result.updated.nombre).toBe("Borrador v2");
    });

    it("aplica valores anteriores en campos no enviados (merge parcial)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([ESTADO_BORRADOR] as never);
      prisma.$queryRaw.mockResolvedValueOnce([ESTADO_BORRADOR] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.estado.update({ id: ESTADO_A_ID });
      // sin cambios — updated refleja los mismos valores
      expect(result.updated.orden).toBe(ESTADO_BORRADOR.orden);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // workflow.transicion.*
  // ═══════════════════════════════════════════════════════════════════════════

  describe("transicion.list", () => {
    it("retorna transiciones enriquecidas con rol_codigo y rol_nombre", async () => {
      prisma.$queryRaw.mockResolvedValue([TRANSICION_ROW] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.transicion.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(1);
      expect(result[0]!.rol_codigo).toBe("MC");
      expect(result[0]!.accion).toBe("firmar");
    });

    it("retorna lista vacía si no hay transiciones", async () => {
      prisma.$queryRaw.mockResolvedValue([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.transicion.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe("transicion.create", () => {
    it("BAD_REQUEST si estados no pertenecen al mismo tipo_documento (menos de 2 rows)", async () => {
      // Solo un estado encontrado (no ambos)
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ESTADO_A_ID }] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.transicion.create({
          tipDocumentoId: TIPO_DOC_ID,
          estadoOrigenId: ESTADO_A_ID,
          estadoDestinoId: ESTADO_B_ID,
          accion: "firmar",
          rolAutorizaId: ROL_ID,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("CONFLICT si ya existe la transición (tipo_doc, estado_origen, accion)", async () => {
      // 1ra: ambos estados existen
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: ESTADO_A_ID },
        { id: ESTADO_B_ID },
      ] as never);
      // 2da: duplicado encontrado
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TRANSICION_ID }] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.transicion.create({
          tipDocumentoId: TIPO_DOC_ID,
          estadoOrigenId: ESTADO_A_ID,
          estadoDestinoId: ESTADO_B_ID,
          accion: "firmar",
          rolAutorizaId: ROL_ID,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("NOT_FOUND si el rol autorizador no existe en ece.rol", async () => {
      // 1ra: estados válidos
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: ESTADO_A_ID },
        { id: ESTADO_B_ID },
      ] as never);
      // 2da: sin duplicado
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      // 3ra: rol no encontrado
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.transicion.create({
          tipDocumentoId: TIPO_DOC_ID,
          estadoOrigenId: ESTADO_A_ID,
          estadoDestinoId: ESTADO_B_ID,
          accion: "firmar",
          rolAutorizaId: ROL_ID,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea transición correctamente y retorna {created, prev:null}", async () => {
      // 1ra: estados válidos
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: ESTADO_A_ID },
        { id: ESTADO_B_ID },
      ] as never);
      // 2da: sin duplicado
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      // 3ra: rol existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ROL_ID }] as never);
      // 4ta: INSERT RETURNING
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.transicion.create({
        tipDocumentoId: TIPO_DOC_ID,
        estadoOrigenId: ESTADO_A_ID,
        estadoDestinoId: ESTADO_B_ID,
        accion: "firmar",
        rolAutorizaId: ROL_ID,
      });
      expect(result.created!.accion).toBe("firmar");
      expect(result.created!.requiere_firma).toBe(true);
      expect(result.prev).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe("transicion.update", () => {
    it("NOT_FOUND si la transición no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.transicion.update({ id: TRANSICION_ID, requiereFirma: false }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("BAD_REQUEST si estadoDestinoId nuevo no pertenece al mismo tipo_documento", async () => {
      const OTRO_ESTADO_ID = "00000000-0000-0000-0000-000000000099";
      // 1ra: transición existe
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      // 2da: estado_destino verificación → vacío (no es del mismo tipo_doc)
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.transicion.update({ id: TRANSICION_ID, estadoDestinoId: OTRO_ESTADO_ID }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("actualiza requiere_firma y retorna snapshot anterior", async () => {
      // 1ra: transición previa
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      // 2da: UPDATE RETURNING
      const actualizada = { ...TRANSICION_ROW, requiere_firma: false };
      prisma.$queryRaw.mockResolvedValueOnce([actualizada] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.transicion.update({
        id: TRANSICION_ID,
        requiereFirma: false,
      });
      expect(result.prev!.requiere_firma).toBe(true);
      expect(result.updated.requiere_firma).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // workflow.role.*  (matriz LLENA/RESPONSABLE/AUTORIZA/FIRMA)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("role.list", () => {
    it("retorna la matriz de roles funcionales enriquecida con rol_codigo", async () => {
      const DOC_ROL = {
        id: DOC_ROL_ID,
        tipo_documento_id: TIPO_DOC_ID,
        rol_id: ROL_ID,
        funcion: "LLENA" as const,
        obligatorio: true,
        rol_codigo: "MC",
        rol_nombre: "Médico Clínico",
      };
      prisma.$queryRaw.mockResolvedValue([DOC_ROL] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.role.list({ tipDocumentoId: TIPO_DOC_ID });
      expect(result).toHaveLength(1);
      expect(result[0]!.funcion).toBe("LLENA");
      expect(result[0]!.rol_codigo).toBe("MC");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe("role.assign", () => {
    it("NOT_FOUND si tipo_documento no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.role.assign({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "LLENA",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("NOT_FOUND si el rol ECE no existe", async () => {
      // 1ra: tipo_documento existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never);
      // 2da: rol no encontrado
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.role.assign({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "FIRMA",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("asigna correctamente y retorna {assigned, wasNew:true} en primera asignación", async () => {
      const DOC_ROL = {
        id: DOC_ROL_ID,
        tipo_documento_id: TIPO_DOC_ID,
        rol_id: ROL_ID,
        funcion: "LLENA",
        obligatorio: true,
      };
      // 1ra: tipo_documento existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never);
      // 2da: rol existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ROL_ID }] as never);
      // 3ra: prev snapshot → no existe (primera asignación)
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      // 4ta: INSERT ON CONFLICT RETURNING
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.role.assign({
        tipDocumentoId: TIPO_DOC_ID,
        rolId: ROL_ID,
        funcion: "LLENA",
        obligatorio: true,
      });
      expect(result.wasNew).toBe(true);
      expect(result.prev).toBeNull();
      expect(result.assigned!.funcion).toBe("LLENA");
    });

    it("asignación idempotente retorna {wasNew:false} si ya existía", async () => {
      const DOC_ROL = {
        id: DOC_ROL_ID,
        tipo_documento_id: TIPO_DOC_ID,
        rol_id: ROL_ID,
        funcion: "LLENA",
        obligatorio: true,
      };
      // 1ra: tipo_documento existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: TIPO_DOC_ID }] as never);
      // 2da: rol existe
      prisma.$queryRaw.mockResolvedValueOnce([{ id: ROL_ID }] as never);
      // 3ra: prev snapshot → ya existe
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL] as never);
      // 4ta: UPSERT RETURNING
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.role.assign({
        tipDocumentoId: TIPO_DOC_ID,
        rolId: ROL_ID,
        funcion: "LLENA",
      });
      expect(result.wasNew).toBe(false);
      expect(result.prev).toBeDefined();
    });

    it("lanza BAD_REQUEST si funcion no es valor permitido (Zod)", async () => {
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.role.assign({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "EDITA" as never,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe("role.revoke", () => {
    it("NOT_FOUND si la asignación no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.role.revoke({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "LLENA",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("revoca la función y retorna snapshot en prev", async () => {
      const DOC_ROL = {
        id: DOC_ROL_ID,
        tipo_documento_id: TIPO_DOC_ID,
        rol_id: ROL_ID,
        funcion: "LLENA",
        obligatorio: true,
      };
      prisma.$queryRaw.mockResolvedValueOnce([DOC_ROL] as never);
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      const result = await caller.role.revoke({
        tipDocumentoId: TIPO_DOC_ID,
        rolId: ROL_ID,
        funcion: "LLENA",
      });
      expect(result.prev!.funcion).toBe("LLENA");
    });

    it("lanza BAD_REQUEST si funcion no es valor permitido (Zod)", async () => {
      const caller = workflowEstadoRouter.createCaller(workflowCtx(prisma));
      await expect(
        caller.role.revoke({
          tipDocumentoId: TIPO_DOC_ID,
          rolId: ROL_ID,
          funcion: "OTRO" as never,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // workflow.instance.* — canTransition + executeTransition (§US.F2.1.8)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("canTransition (instance.canAdvance)", () => {
    it("NOT_FOUND si la instancia no existe", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      await expect(
        canTransition(prisma as unknown as PrismaClient, INSTANCIA_ID, "firmar", ["MC"]),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("allowed=false si no existe transición definida para (tipo, estado, accion)", async () => {
      // 1ra: instancia existe
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);
      // 2da: transición → vacía
      prisma.$queryRaw.mockResolvedValueOnce([] as never);
      const result = await canTransition(
        prisma as unknown as PrismaClient,
        INSTANCIA_ID,
        "anular",
        ["MC"],
      );
      expect(result.allowed).toBe(false);
      expect(result.targetStateId).toBeUndefined();
    });

    it("allowed=false si el rol del usuario no coincide con rol_autoriza", async () => {
      // 1ra: instancia existe
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);
      // 2da: transición existe pero rol_codigo es "DIR" (usuario tiene "MC")
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...TRANSICION_ROW, rol_codigo: "DIR" },
      ] as never);
      const result = await canTransition(
        prisma as unknown as PrismaClient,
        INSTANCIA_ID,
        "firmar",
        ["MC"],  // usuario tiene MC, no DIR
      );
      expect(result.allowed).toBe(false);
      expect(result.targetStateId).toBeUndefined();
    });

    it("allowed=true y targetStateId correcto cuando rol coincide", async () => {
      // 1ra: instancia existe
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);
      // 2da: transición: rol_codigo=MC, destino=ESTADO_B_ID
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      const result = await canTransition(
        prisma as unknown as PrismaClient,
        INSTANCIA_ID,
        "firmar",
        ["MC"],
      );
      expect(result.allowed).toBe(true);
      expect(result.requiresSignature).toBe(true);
      expect(result.targetStateId).toBe(ESTADO_B_ID);
    });

    it("requiresSignature=false cuando la transición no exige firma", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...TRANSICION_ROW, requiere_firma: false },
      ] as never);
      const result = await canTransition(
        prisma as unknown as PrismaClient,
        INSTANCIA_ID,
        "firmar",
        ["MC"],
      );
      expect(result.requiresSignature).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════

  describe("executeTransition (instance.advance)", () => {
    it("FORBIDDEN si canTransition retorna allowed=false", async () => {
      // Simula: instancia existe, transición existe pero rol no autorizado
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);        // instancia
      prisma.$queryRaw.mockResolvedValueOnce([
        { ...TRANSICION_ROW, rol_codigo: "DIR" },
      ] as never);  // transición con otro rol
      await expect(
        executeTransition(
          prisma as unknown as PrismaClient,
          INSTANCIA_ID,
          "firmar",
          { ...ECE_CTX, roles: ["MC"] },
          ECE_CTX.personalId,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("BAD_REQUEST si transición requiere firma y no se provee firmaId", async () => {
      // canTransition: instancia + transición (requiere_firma=true, rol MC)
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      await expect(
        executeTransition(
          prisma as unknown as PrismaClient,
          INSTANCIA_ID,
          "firmar",
          { ...ECE_CTX, roles: ["MC"] },
          ECE_CTX.personalId,
          undefined,  // firmaId ausente
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("actualiza estado e inserta bitácora cuando la transición es válida", async () => {
      // canTransition: instancia + transición (allowed, requiere_firma=true)
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      // rolRows dentro de executeTransition
      prisma.$queryRaw.mockResolvedValueOnce([
        { rol_autoriza_id: ROL_ID, estado_origen_id: ESTADO_A_ID },
      ] as never);
      prisma.$executeRaw.mockResolvedValue(1 as never);  // UPDATE instancia
      prisma.$executeRaw.mockResolvedValue(1 as never);  // INSERT historial

      await expect(
        executeTransition(
          prisma as unknown as PrismaClient,
          INSTANCIA_ID,
          "firmar",
          { ...ECE_CTX, roles: ["MC"] },
          ECE_CTX.personalId,
          FIRMA_ID,
          "Firma electrónica confirmada",
        ),
      ).resolves.toBeUndefined();

      // $executeRaw fue llamado al menos dos veces (UPDATE + INSERT historial)
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it("bitácora sin observación no incluye texto (undefined → null en SQL)", async () => {
      prisma.$queryRaw.mockResolvedValueOnce([INSTANCIA_ROW] as never);
      prisma.$queryRaw.mockResolvedValueOnce([TRANSICION_ROW] as never);
      prisma.$queryRaw.mockResolvedValueOnce([
        { rol_autoriza_id: ROL_ID, estado_origen_id: ESTADO_A_ID },
      ] as never);
      prisma.$executeRaw.mockResolvedValue(1 as never);
      prisma.$executeRaw.mockResolvedValue(1 as never);

      // Sin observacion — no debe lanzar error
      await expect(
        executeTransition(
          prisma as unknown as PrismaClient,
          INSTANCIA_ID,
          "firmar",
          { ...ECE_CTX, roles: ["MC"] },
          ECE_CTX.personalId,
          FIRMA_ID,
          // observacion omitida
        ),
      ).resolves.toBeUndefined();
    });
  });
});

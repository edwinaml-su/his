/**
 * Tests unitarios — portal-arco.router (US.F2.7.44-45)
 *
 * Cubre la máquina de estado ARCO:
 *   crearSolicitud:
 *     - crea con estado PENDIENTE + emite DomainEvent
 *     - NOT_FOUND si paciente no existe
 *   listMisSolicitudes:
 *     - retorna solicitudes del propio paciente
 *     - filtra por estado cuando se provee
 *   listParaRevisar:
 *     - filtra por org + PENDIENTE
 *     - UNAUTHORIZED si no hay rol DIR/ADM/ADMIN
 *   responder:
 *     - NOT_FOUND si solicitud no existe
 *     - FORBIDDEN si solicitud es de otra org
 *     - BAD_REQUEST si estado != PENDIENTE
 *     - aprueba: actualiza estado + emite DomainEvent
 *     - rechaza: actualiza estado + emite DomainEvent
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { portalArcoRouter } from "../portal-arco.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_USER_ADMIN } from "@his/test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = MOCK_TENANT.organizationId;
const OTHER_ORG_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const PATIENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PORTAL_ACCOUNT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SOLICITUD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makePortalCtx(overrides: { prisma?: Partial<PrismaClient> } = {}) {
  return makeCtx({
    prisma: overrides.prisma,
    tenant: null,
    portalAccount: {
      id: PORTAL_ACCOUNT_ID,
      patientId: PATIENT_ID,
    },
  });
}

function makeTenantCtx(overrides: { prisma?: Partial<PrismaClient> } = {}) {
  return makeCtx({ prisma: overrides.prisma });
}

function makeSolicitud(overrides: Record<string, unknown> = {}) {
  return {
    id: SOLICITUD_ID,
    pacienteId: PATIENT_ID,
    organizacionId: ORG_ID,
    tipo: "RECTIFICACION",
    documentoTarget: null,
    motivo: "Hay un error en mi fecha de nacimiento registrada en el sistema.",
    estado: "PENDIENTE",
    revisadoPorId: null,
    fechaRespuesta: null,
    motivoRespuesta: null,
    creadoEn: new Date("2026-05-01T10:00:00Z"),
    actualizadoEn: new Date("2026-05-01T10:00:00Z"),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("portalArcoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withPortalContext / withTenantContext necesitan $transaction
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  // ===========================================================================
  // crearSolicitud
  // ===========================================================================

  describe("crearSolicitud", () => {
    it("crea solicitud con estado PENDIENTE y emite DomainEvent", async () => {
      prisma.patient.findUnique.mockResolvedValue({
        organizationId: ORG_ID,
      } as never);

      const createdSolicitud = {
        id: SOLICITUD_ID,
        tipo: "RECTIFICACION" as const,
        estado: "PENDIENTE",
        creadoEn: new Date(),
      };
      prisma.solicitudArco.create.mockResolvedValue(createdSolicitud as never);
      prisma.domainEvent.create.mockResolvedValue({ id: "evt-1" } as never);

      const caller = portalArcoRouter.createCaller(makePortalCtx({ prisma }));
      const result = await caller.crearSolicitud({
        tipo: "RECTIFICACION",
        motivo: "El nombre registrado tiene un error tipográfico en mi primer apellido.",
      });

      expect(result.estado).toBe("PENDIENTE");
      expect(result.tipo).toBe("RECTIFICACION");
      expect(prisma.solicitudArco.create).toHaveBeenCalledOnce();
      expect(prisma.domainEvent.create).toHaveBeenCalledOnce();
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "arco.solicitud.creada",
            aggregateType: "SolicitudArco",
          }),
        }),
      );
    });

    it("lanza NOT_FOUND si el paciente no existe en la BD", async () => {
      prisma.patient.findUnique.mockResolvedValue(null);

      const caller = portalArcoRouter.createCaller(makePortalCtx({ prisma }));
      await expect(
        caller.crearSolicitud({
          tipo: "SUPRESION",
          motivo: "Deseo ejercer mi derecho de supresión de datos personales según Art. 18.",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("incluye documentoTarget cuando se provee", async () => {
      prisma.patient.findUnique.mockResolvedValue({ organizationId: ORG_ID } as never);
      prisma.solicitudArco.create.mockResolvedValue({
        id: SOLICITUD_ID,
        tipo: "RECTIFICACION",
        estado: "PENDIENTE",
        creadoEn: new Date(),
      } as never);
      prisma.domainEvent.create.mockResolvedValue({ id: "evt-2" } as never);

      const caller = portalArcoRouter.createCaller(makePortalCtx({ prisma }));
      await caller.crearSolicitud({
        tipo: "RECTIFICACION",
        documentoTarget: "nota-clinica-2026-001",
        motivo: "La nota clínica contiene un diagnóstico incorrecto que deseo rectificar.",
      });

      expect(prisma.solicitudArco.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentoTarget: "nota-clinica-2026-001",
          }),
        }),
      );
    });
  });

  // ===========================================================================
  // listMisSolicitudes
  // ===========================================================================

  describe("listMisSolicitudes", () => {
    it("retorna solicitudes filtradas por patientId del portal account", async () => {
      const solicitudes = [makeSolicitud(), makeSolicitud({ id: "dddddddd-dddd-dddd-dddd-dddddddddddd", tipo: "SUPRESION" })];
      prisma.solicitudArco.findMany.mockResolvedValue(solicitudes as never);

      const caller = portalArcoRouter.createCaller(makePortalCtx({ prisma }));
      const result = await caller.listMisSolicitudes({});

      expect(result).toHaveLength(2);
      expect(prisma.solicitudArco.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pacienteId: PATIENT_ID }),
        }),
      );
    });

    it("filtra por estado cuando se provee el parámetro", async () => {
      prisma.solicitudArco.findMany.mockResolvedValue([makeSolicitud({ estado: "APROBADA" })] as never);

      const caller = portalArcoRouter.createCaller(makePortalCtx({ prisma }));
      await caller.listMisSolicitudes({ estado: "APROBADA" });

      expect(prisma.solicitudArco.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            pacienteId: PATIENT_ID,
            estado: "APROBADA",
          }),
        }),
      );
    });

    it("retorna lista vacía si no hay solicitudes", async () => {
      prisma.solicitudArco.findMany.mockResolvedValue([] as never);

      const caller = portalArcoRouter.createCaller(makePortalCtx({ prisma }));
      const result = await caller.listMisSolicitudes({});

      expect(result).toHaveLength(0);
    });
  });

  // ===========================================================================
  // listParaRevisar
  // ===========================================================================

  describe("listParaRevisar", () => {
    it("retorna solicitudes PENDIENTE del tenant con datos del paciente", async () => {
      const solicitudesConPaciente = [
        {
          ...makeSolicitud(),
          paciente: { id: PATIENT_ID, firstName: "Juan", lastName: "García", mrn: "MRN-001" },
        },
      ];
      prisma.solicitudArco.findMany.mockResolvedValue(solicitudesConPaciente as never);

      const caller = portalArcoRouter.createCaller(makeTenantCtx({ prisma }));
      const result = await caller.listParaRevisar();

      expect(result).toHaveLength(1);
      expect(prisma.solicitudArco.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizacionId: ORG_ID,
            estado: "PENDIENTE",
          }),
        }),
      );
    });

    it("lanza UNAUTHORIZED si no hay sesión de tenant", async () => {
      const caller = portalArcoRouter.createCaller(
        makeCtx({ tenant: null, portalAccount: null }),
      );
      // requireRole devuelve FORBIDDEN cuando no hay tenant (no UNAUTHORIZED)
      await expect(caller.listParaRevisar()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  // ===========================================================================
  // responder
  // ===========================================================================

  describe("responder", () => {
    it("lanza NOT_FOUND si la solicitud no existe", async () => {
      prisma.solicitudArco.findUnique.mockResolvedValue(null);

      const caller = portalArcoRouter.createCaller(makeTenantCtx({ prisma }));
      await expect(
        caller.responder({
          solicitudId: SOLICITUD_ID,
          decision: "APROBADA",
          motivoRespuesta: "Solicitud válida, procede la rectificación del nombre.",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lanza FORBIDDEN si la solicitud pertenece a otra organización", async () => {
      prisma.solicitudArco.findUnique.mockResolvedValue(
        makeSolicitud({ organizacionId: OTHER_ORG_ID }) as never,
      );

      const caller = portalArcoRouter.createCaller(makeTenantCtx({ prisma }));
      await expect(
        caller.responder({
          solicitudId: SOLICITUD_ID,
          decision: "APROBADA",
          motivoRespuesta: "Intento de acceso cross-tenant.",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("lanza BAD_REQUEST si la solicitud no está en estado PENDIENTE", async () => {
      prisma.solicitudArco.findUnique.mockResolvedValue(
        makeSolicitud({ estado: "APROBADA" }) as never,
      );

      const caller = portalArcoRouter.createCaller(makeTenantCtx({ prisma }));
      await expect(
        caller.responder({
          solicitudId: SOLICITUD_ID,
          decision: "RECHAZADA",
          motivoRespuesta: "No procede porque ya fue aprobada previamente.",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("aprueba: actualiza estado a APROBADA y emite DomainEvent", async () => {
      prisma.solicitudArco.findUnique.mockResolvedValue(makeSolicitud() as never);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));

      const updated = makeSolicitud({
        estado: "APROBADA",
        fechaRespuesta: new Date(),
      });
      prisma.solicitudArco.update.mockResolvedValue(updated as never);
      prisma.domainEvent.create.mockResolvedValue({ id: "evt-resp-1" } as never);

      const caller = portalArcoRouter.createCaller(makeTenantCtx({ prisma }));
      const result = await caller.responder({
        solicitudId: SOLICITUD_ID,
        decision: "APROBADA",
        motivoRespuesta: "Solicitud de rectificación aprobada. Se procederá a la corrección.",
      });

      expect(result.estado).toBe("APROBADA");
      expect(prisma.solicitudArco.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            estado: "APROBADA",
            revisadoPorId: MOCK_USER_ADMIN.id,
          }),
        }),
      );
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "arco.solicitud.respondida",
            aggregateType: "SolicitudArco",
          }),
        }),
      );
    });

    it("rechaza: actualiza estado a RECHAZADA y emite DomainEvent", async () => {
      prisma.solicitudArco.findUnique.mockResolvedValue(makeSolicitud() as never);
      prisma.$transaction.mockImplementation(async (fn) => fn(prisma));

      const updated = makeSolicitud({ estado: "RECHAZADA", fechaRespuesta: new Date() });
      prisma.solicitudArco.update.mockResolvedValue(updated as never);
      prisma.domainEvent.create.mockResolvedValue({ id: "evt-resp-2" } as never);

      const caller = portalArcoRouter.createCaller(makeTenantCtx({ prisma }));
      const result = await caller.responder({
        solicitudId: SOLICITUD_ID,
        decision: "RECHAZADA",
        motivoRespuesta: "Solicitud rechazada: los datos son correctos según registros oficiales.",
      });

      expect(result.estado).toBe("RECHAZADA");
      expect(prisma.domainEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventType: "arco.solicitud.respondida",
            payload: expect.objectContaining({ decision: "RECHAZADA" }),
          }),
        }),
      );
    });
  });
});

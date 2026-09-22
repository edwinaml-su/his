/**
 * CC-0044 — Formularios de médico fuera de red (módulo de aseguradoras).
 *
 * Cubre:
 *   - callCensus.create con entries anidadas.
 *   - callCensus.sign: requiere rol médico (requireRole PHYSICIAN) y estado BORRADOR.
 *   - callCensus.anular: sólo desde BORRADOR/FIRMADO, guarda motivoAnulacion.
 *   - callCensus.list: filtra por organizationId/patientId/status.
 *   - outOfNetwork.create + markFirmado: sólo desde PENDIENTE_FIRMA.
 *   - outOfNetwork.list: filtra por organizationId.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { insuranceRouter } from "../insurance.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

const u = "00000000-0000-0000-0000-000000000001";
const patientId = "00000000-0000-0000-0000-000000000010";

describe("insuranceRouter — CC-0044 formularios fuera de red", () => {
  let prisma: DeepMockProxy<PrismaClient>;
  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    installTenantContextMock(prisma);
  });

  // -------------------------------------------------------------------------
  // P1-1 (revisión adversarial) + ajuste 2026-09-22 — formsWriterProc/
  // formsReaderProc gatean ambos sub-routers (antes sólo `sign` tenía rol).
  // Códigos reales verificados contra prod (`select distinct code from
  // public."Role"`): ni "ADMISION" ni "ACCOUNTANT" ni "BILLING" existen —
  // el set real es ADMIN/SUPER_ADMIN/ADMIN_CLINICO/ADMISSION_CLERK/
  // FACTURACION/GERENTE_FINANCIERO (+ PHYSICIAN/MEDICO_AFILIADO/
  // JEFE_MEDICO_SEDE en formsReaderProc). Un rol sin ninguno de esos debe
  // recibir FORBIDDEN.
  // -------------------------------------------------------------------------
  describe("gates de rol (formsWriterProc / formsReaderProc)", () => {
    const sinAcceso = { ...MOCK_TENANT, roleCodes: ["TRIAGIST"] };

    it("callCensus.list FORBIDDEN sin rol de formulario", async () => {
      const caller = insuranceRouter.createCaller(makeCtx({ prisma, tenant: sinAcceso }));
      await expect(caller.callCensus.list({ limit: 50, offset: 0 })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("callCensus.create FORBIDDEN sin rol de formulario", async () => {
      const caller = insuranceRouter.createCaller(makeCtx({ prisma, tenant: sinAcceso }));
      await expect(
        caller.callCensus.create({ patientId, aseguradoraNombre: "ISSS", diagnostico: "x", entries: [] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("callCensus.list OK con rol ADMISSION_CLERK (aunque no sea médico/admin)", async () => {
      prisma.networkCallCensus.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["ADMISSION_CLERK"] } }),
      );
      await expect(caller.callCensus.list({ limit: 50, offset: 0 })).resolves.toEqual([]);
    });

    it("callCensus.create OK con rol ADMISSION_CLERK (recepción, no requiere admin/médico)", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: patientId } as never);
      prisma.networkCallCensus.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["ADMISSION_CLERK"] } }),
      );
      const r = await caller.callCensus.create({
        patientId,
        aseguradoraNombre: "ISSS",
        diagnostico: "x",
        entries: [],
      });
      expect(r.id).toBe(u);
    });

    it("outOfNetwork.create FORBIDDEN sin rol de formulario", async () => {
      const caller = insuranceRouter.createCaller(makeCtx({ prisma, tenant: sinAcceso }));
      await expect(
        caller.outOfNetwork.create({
          patientId,
          aseguradoraNombre: "MAPFRE",
          aseguradoTitular: "Juan Pérez",
          parentesco: "TITULAR",
          doctorNombre: "Dr. Gómez",
          doctorEspecialidad: "Cirugía General",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("outOfNetwork.byId OK con rol MEDICO_AFILIADO (código médico multi-org, necesita leer)", async () => {
      prisma.outOfNetworkAttestation.findFirst.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["MEDICO_AFILIADO"] } }),
      );
      await expect(caller.outOfNetwork.byId({ id: u })).resolves.toMatchObject({ id: u });
    });
  });

  // -------------------------------------------------------------------------
  describe("callCensus.create", () => {
    it("NOT_FOUND si el paciente no pertenece al tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.callCensus.create({
          patientId,
          aseguradoraNombre: "ISSS",
          diagnostico: "Trauma craneoencefálico",
          entries: [],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea el censo con entries anidadas y organizationId del tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: patientId } as never);
      prisma.networkCallCensus.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.callCensus.create({
        patientId,
        aseguradoraNombre: "ISSS",
        diagnostico: "Trauma craneoencefálico",
        entries: [
          { doctorNombre: "Dr. Pérez", telefono: "2222-1111", atendioLlamada: false, comentarios: "No contestó" },
          { doctorNombre: "Dra. López", ordenIndex: 1 },
        ],
      });
      const args = prisma.networkCallCensus.create.mock.calls[0]![0]!;
      const data = args.data as {
        organizationId: string;
        aseguradoraNombre: string;
        entries: { create: Array<{ doctorNombre: string }> };
      };
      expect(data.organizationId).toBeTruthy();
      expect(data.aseguradoraNombre).toBe("ISSS");
      expect(data.entries.create).toHaveLength(2);
      expect(data.entries.create[0]!.doctorNombre).toBe("Dr. Pérez");
    });

    it("NOT_FOUND si insurerId no es visible para el tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: patientId } as never);
      prisma.insurer.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.callCensus.create({
          patientId,
          insurerId: u,
          diagnostico: "Fractura",
          entries: [],
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("callCensus.list", () => {
    it("filtra por organizationId del tenant", async () => {
      prisma.networkCallCensus.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.callCensus.list({ limit: 50, offset: 0 });
      const where = prisma.networkCallCensus.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });

    it("filtra por patientId y status cuando vienen", async () => {
      prisma.networkCallCensus.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.callCensus.list({ patientId, status: "FIRMADO", limit: 20, offset: 0 });
      const where = prisma.networkCallCensus.findMany.mock.calls[0]![0]!.where as {
        patientId: string;
        status: string;
      };
      expect(where.patientId).toBe(patientId);
      expect(where.status).toBe("FIRMADO");
    });
  });

  describe("callCensus.sign", () => {
    it("FORBIDDEN si el caller no tiene rol médico", async () => {
      const caller = insuranceRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["TRIAGIST"] } }),
      );
      await expect(caller.callCensus.sign({ id: u })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("NOT_FOUND si el censo no existe o no está en BORRADOR", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma })); // MOCK_TENANT incluye PHYSICIAN
      await expect(caller.callCensus.sign({ id: u })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    // P2 (revisión adversarial) — un censo firmado con 0 llamadas no tiene
    // valor probatorio del protocolo (documentar los intentos de localizar
    // un médico de la red).
    it("BAD_REQUEST si el censo no tiene ninguna fila (0 entries)", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue({
        _count: { entries: 0 },
      } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.callCensus.sign({ id: u })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(prisma.networkCallCensus.update).not.toHaveBeenCalled();
    });

    it("OK: transiciona BORRADOR -> FIRMADO y asigna medicoTurnoUserId=ctx.user.id", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue({
        _count: { entries: 2 },
      } as never);
      prisma.networkCallCensus.update.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.callCensus.sign({ id: u });
      expect(result.ok).toBe(true);
      const call = prisma.networkCallCensus.update.mock.calls[0]![0]!;
      expect((call.where as { id: string }).id).toBe(u);
      const data = call.data as { status: string; medicoTurnoUserId: string; firmadoAt: Date };
      expect(data.status).toBe("FIRMADO");
      expect(data.medicoTurnoUserId).toBeTruthy();
      expect(data.firmadoAt).toBeInstanceOf(Date);
    });

    // Ajuste 2026-09-22 — PHYSICIAN sólo existe en 1 de 21 orgs; el código
    // médico multi-org real es MEDICO_AFILIADO/JEFE_MEDICO_SEDE.
    // `formsSignProc` debe aceptarlos igual que PHYSICIAN.
    it("OK con rol MEDICO_AFILIADO (código médico multi-org, no PHYSICIAN)", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue({
        _count: { entries: 1 },
      } as never);
      prisma.networkCallCensus.update.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(
        makeCtx({ prisma, tenant: { ...MOCK_TENANT, roleCodes: ["MEDICO_AFILIADO"] } }),
      );
      const result = await caller.callCensus.sign({ id: u });
      expect(result.ok).toBe(true);
    });
  });

  describe("callCensus.anular", () => {
    it("guarda motivoAnulacion y permite BORRADOR o FIRMADO", async () => {
      prisma.networkCallCensus.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.callCensus.anular({ id: u, motivo: "Duplicado por error de captura" });
      const call = prisma.networkCallCensus.updateMany.mock.calls[0]![0]!;
      const where = call.where as { status: { in: string[] } };
      expect(where.status.in).toEqual(["BORRADOR", "FIRMADO"]);
      const data = call.data as { status: string; motivoAnulacion: string };
      expect(data.status).toBe("ANULADO");
      expect(data.motivoAnulacion).toBe("Duplicado por error de captura");
    });

    it("NOT_FOUND si ya está anulado", async () => {
      prisma.networkCallCensus.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.callCensus.anular({ id: u, motivo: "x" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("callCensus.update / addEntry / removeEntry — sólo BORRADOR", () => {
    it("update NOT_FOUND si el censo no está en BORRADOR", async () => {
      prisma.networkCallCensus.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.callCensus.update({ id: u, diagnostico: "Actualizado" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("addEntry NOT_FOUND si el censo no está en BORRADOR", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.callCensus.addEntry({ censusId: u, entry: { doctorNombre: "Dr. X" } }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("addEntry OK cuando el censo está en BORRADOR", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue({ id: u } as never);
      prisma.networkCallCensusEntry.create.mockResolvedValue({ id: "entry-1" } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const r = await caller.callCensus.addEntry({ censusId: u, entry: { doctorNombre: "Dr. X" } });
      expect(r.id).toBe("entry-1");
    });

    // P1-2 (revisión adversarial) — sin ordenIndex explícito, el router lo
    // calcula como max(ordenIndex existente)+1 dentro de la misma tx, no un
    // 0 fijo (el default de la columna). Dos addEntry seguidos quedan con
    // índices crecientes.
    it("addEntry asigna ordenIndex incremental cuando el caller no lo especifica (dos llamadas seguidas)", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue({ id: u } as never);
      prisma.networkCallCensusEntry.findFirst
        .mockResolvedValueOnce(null as never) // censo sin filas aún
        .mockResolvedValueOnce({ ordenIndex: 0 } as never); // ya existe la fila anterior
      prisma.networkCallCensusEntry.create
        .mockResolvedValueOnce({ id: "entry-1" } as never)
        .mockResolvedValueOnce({ id: "entry-2" } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));

      await caller.callCensus.addEntry({ censusId: u, entry: { doctorNombre: "Dr. A" } });
      await caller.callCensus.addEntry({ censusId: u, entry: { doctorNombre: "Dr. B" } });

      const firstData = prisma.networkCallCensusEntry.create.mock.calls[0]![0]!.data as {
        ordenIndex: number;
      };
      const secondData = prisma.networkCallCensusEntry.create.mock.calls[1]![0]!.data as {
        ordenIndex: number;
      };
      expect(firstData.ordenIndex).toBe(0);
      expect(secondData.ordenIndex).toBe(1);
    });

    it("addEntry respeta ordenIndex explícito del caller (no recalcula)", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue({ id: u } as never);
      prisma.networkCallCensusEntry.create.mockResolvedValue({ id: "entry-1" } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.callCensus.addEntry({ censusId: u, entry: { doctorNombre: "Dr. X", ordenIndex: 7 } });
      expect(prisma.networkCallCensusEntry.findFirst).not.toHaveBeenCalled();
      const data = prisma.networkCallCensusEntry.create.mock.calls[0]![0]!.data as { ordenIndex: number };
      expect(data.ordenIndex).toBe(7);
    });

    it("removeEntry NOT_FOUND si la fila no existe", async () => {
      prisma.networkCallCensus.findFirst.mockResolvedValue({ id: u } as never);
      prisma.networkCallCensusEntry.deleteMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.callCensus.removeEntry({ censusId: u, entryId: u }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  // ===========================================================================
  // outOfNetwork
  // ===========================================================================

  describe("outOfNetwork.create", () => {
    it("NOT_FOUND si el paciente no pertenece al tenant", async () => {
      prisma.patient.findFirst.mockResolvedValue(null as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.outOfNetwork.create({
          patientId,
          aseguradoraNombre: "MAPFRE",
          aseguradoTitular: "Juan Pérez",
          parentesco: "TITULAR",
          doctorNombre: "Dr. Gómez",
          doctorEspecialidad: "Cirugía General",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("crea la constancia en PENDIENTE_FIRMA por default", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: patientId } as never);
      prisma.outOfNetworkAttestation.create.mockResolvedValue({ id: u } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.outOfNetwork.create({
        patientId,
        aseguradoraNombre: "MAPFRE",
        aseguradoTitular: "Juan Pérez",
        parentesco: "TITULAR",
        doctorNombre: "Dr. Gómez",
        doctorEspecialidad: "Cirugía General",
      });
      const data = prisma.outOfNetworkAttestation.create.mock.calls[0]![0]!.data as {
        organizationId: string;
        parentesco: string;
      };
      expect(data.organizationId).toBeTruthy();
      expect(data.parentesco).toBe("TITULAR");
    });
  });

  describe("outOfNetwork.markFirmado", () => {
    it("NOT_FOUND si no está en PENDIENTE_FIRMA", async () => {
      prisma.outOfNetworkAttestation.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.outOfNetwork.markFirmado({ id: u })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("OK: transiciona PENDIENTE_FIRMA -> FIRMADO", async () => {
      prisma.outOfNetworkAttestation.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.outOfNetwork.markFirmado({ id: u });
      expect(result.ok).toBe(true);
      const call = prisma.outOfNetworkAttestation.updateMany.mock.calls[0]![0]!;
      expect((call.where as { status: string }).status).toBe("PENDIENTE_FIRMA");
      const data = call.data as { status: string; firmadoAt: Date };
      expect(data.status).toBe("FIRMADO");
      expect(data.firmadoAt).toBeInstanceOf(Date);
    });
  });

  describe("outOfNetwork.update — sólo PENDIENTE_FIRMA", () => {
    it("NOT_FOUND si ya está firmada", async () => {
      prisma.outOfNetworkAttestation.updateMany.mockResolvedValue({ count: 0 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.outOfNetwork.update({ id: u, doctorNombre: "Dr. Nuevo" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("outOfNetwork.anular", () => {
    it("guarda motivoAnulacion", async () => {
      prisma.outOfNetworkAttestation.updateMany.mockResolvedValue({ count: 1 } as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.outOfNetwork.anular({ id: u, motivo: "Paciente cambió de médico" });
      const data = prisma.outOfNetworkAttestation.updateMany.mock.calls[0]![0]!.data as {
        status: string;
        motivoAnulacion: string;
      };
      expect(data.status).toBe("ANULADO");
      expect(data.motivoAnulacion).toBe("Paciente cambió de médico");
    });
  });

  describe("outOfNetwork.list", () => {
    it("filtra por organizationId del tenant", async () => {
      prisma.outOfNetworkAttestation.findMany.mockResolvedValue([] as never);
      const caller = insuranceRouter.createCaller(makeCtx({ prisma }));
      await caller.outOfNetwork.list({ limit: 50, offset: 0 });
      const where = prisma.outOfNetworkAttestation.findMany.mock.calls[0]![0]!.where as {
        organizationId: string;
      };
      expect(where.organizationId).toBeTruthy();
    });
  });
});

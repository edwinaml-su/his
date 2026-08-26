/**
 * Tests unitarios — materializeOrdenesFromIndicacion (CC-0026 D2 order-consumer).
 *
 * Estrategia: mock directo de los miembros de `tx` que el consumer usa
 * (mismo patrón que `care-task-consumer.test.ts`), sin mockDeep.
 *
 * Casos cubiertos (mandato de la tarea):
 *   1. Ítem lab → LabOrder creada + CareTask LAB_TECHNICIAN.
 *   2. Ítem gabinete → ImagingRequest+ImagingOrder creados + CareTask RAD_TECHNICIAN.
 *   3. Paciente irresoluble (bridge NULL) → ordenesOmitidas, no crea nada, no lanza.
 *   4. Error real (constraint) → propaga (permite que firmar() revierta todo).
 *   5. categoriaUIDeItem — discriminador compartido con care-task-consumer.
 */
import { describe, it, expect, vi } from "vitest";
import {
  materializeOrdenesFromIndicacion,
  categoriaUIDeItem,
  type OrderIndicacionItem,
} from "../order-consumer";

const EPISODIO_ID = "22222222-2222-2222-2222-222222222222";
const ESTABLISHMENT_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const ORG_ID = "66666666-6666-6666-6666-666666666666";
const PATIENT_ID = "77777777-7777-7777-7777-777777777777";
const ENCOUNTER_ID = "88888888-8888-8888-8888-888888888888";
const LAB_TEST_ID = "99999999-9999-9999-9999-999999999999";
const ACCOUNT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

interface MockTx {
  $queryRaw: ReturnType<typeof vi.fn>;
  labTest: { findFirst: ReturnType<typeof vi.fn> };
  costCenter: { findFirst: ReturnType<typeof vi.fn> };
  patientAccount: { findFirst: ReturnType<typeof vi.fn> };
  serviceUnit: { findFirst: ReturnType<typeof vi.fn> };
  labOrder: { create: ReturnType<typeof vi.fn> };
  imagingRequest: { create: ReturnType<typeof vi.fn> };
  imagingOrder: { create: ReturnType<typeof vi.fn> };
  careTask: { create: ReturnType<typeof vi.fn> };
}

function makeTx(): MockTx {
  return {
    $queryRaw: vi.fn(),
    labTest: { findFirst: vi.fn() },
    costCenter: { findFirst: vi.fn().mockResolvedValue(null) },
    patientAccount: { findFirst: vi.fn().mockResolvedValue({ id: ACCOUNT_ID }) },
    serviceUnit: { findFirst: vi.fn().mockResolvedValue(null) },
    labOrder: { create: vi.fn().mockResolvedValue({ id: "lab-order-1" }) },
    imagingRequest: { create: vi.fn().mockResolvedValue({ id: "img-req-1", folio: "SOL-2026-0001" }) },
    imagingOrder: { create: vi.fn().mockResolvedValue({ id: "img-order-1" }) },
    careTask: { create: vi.fn().mockResolvedValue({ id: "task-1" }) },
  };
}

/** Prima org + bridge (episodio→encounter/patient). Orden de llamadas del consumer. */
function primeResolution(
  tx: MockTx,
  opts: { orgId?: string | null; encounterId?: string | null; patientId?: string | null } = {},
) {
  // "in" (no "??") porque un `null` EXPLÍCITO en opts debe ganar — con "??"
  // un `patientId: null` pasado a propósito caería de vuelta al default.
  const encounterId = "encounterId" in opts ? opts.encounterId! : ENCOUNTER_ID;
  const patientId = "patientId" in opts ? opts.patientId! : PATIENT_ID;
  tx.$queryRaw
    .mockResolvedValueOnce([{ org_id: opts.orgId ?? ORG_ID }])
    .mockResolvedValueOnce([{ encounter_id: encounterId, patient_id: patientId }]);
}

function baseParams(items: OrderIndicacionItem[]) {
  return {
    episodioId: EPISODIO_ID,
    establishmentId: ESTABLISHMENT_ID,
    userId: USER_ID,
    items,
  };
}

const LAB_ITEM: OrderIndicacionItem = {
  id: "item-lab",
  tipo: "ESTUDIO",
  descripcion: "Hemograma completo",
  detalle: { categoriaUI: "LABORATORIO", labTestId: LAB_TEST_ID, prioridad: "Urgente", tipoMuestra: "Sangre" },
};

const GAB_ITEM: OrderIndicacionItem = {
  id: "item-gab",
  tipo: "ESTUDIO",
  descripcion: "Rx tórax PA",
  detalle: { categoriaUI: "GABINETE", labTestId: LAB_TEST_ID, prioridad: "STAT", modalidad: "Rx" },
};

describe("categoriaUIDeItem", () => {
  it("solo clasifica ESTUDIO con categoriaUI LABORATORIO/GABINETE", () => {
    expect(categoriaUIDeItem("ESTUDIO", { categoriaUI: "LABORATORIO" })).toBe("LABORATORIO");
    expect(categoriaUIDeItem("ESTUDIO", { categoriaUI: "GABINETE" })).toBe("GABINETE");
    expect(categoriaUIDeItem("ESTUDIO", { categoriaUI: "OTRO" })).toBeNull();
    expect(categoriaUIDeItem("ESTUDIO", null)).toBeNull();
    expect(categoriaUIDeItem("ESTUDIO", undefined)).toBeNull();
    expect(categoriaUIDeItem("MEDICAMENTO", { categoriaUI: "LABORATORIO" })).toBeNull();
  });
});

describe("materializeOrdenesFromIndicacion", () => {
  it("sin ítems lab/gabinete: no consulta nada y devuelve ceros", async () => {
    const tx = makeTx();

    const result = await materializeOrdenesFromIndicacion(
      tx as never,
      baseParams([{ id: "1", tipo: "DIETA", descripcion: "x", detalle: null }]),
    );

    expect(result).toEqual({ labOrdersCreated: 0, imagingRequestsCreated: 0, ordenesOmitidas: [] });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("ítem lab → crea LabOrder + CareTask LAB_TECHNICIAN", async () => {
    const tx = makeTx();
    primeResolution(tx);
    tx.labTest.findFirst.mockResolvedValueOnce({ id: LAB_TEST_ID });

    const result = await materializeOrdenesFromIndicacion(tx as never, baseParams([LAB_ITEM]));

    expect(result.labOrdersCreated).toBe(1);
    expect(result.ordenesOmitidas).toEqual([]);
    expect(tx.labOrder.create).toHaveBeenCalledTimes(1);
    const orderData = tx.labOrder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(orderData.data).toMatchObject({
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      patientAccountId: ACCOUNT_ID,
      prescriberId: USER_ID,
      priority: "URGENT",
      status: "ORDERED",
    });

    expect(tx.careTask.create).toHaveBeenCalledTimes(1);
    const taskData = tx.careTask.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(taskData.data).toMatchObject({
      assignedRoleCode: "LAB_TECHNICIAN",
      sourceType: "LAB_ORDER",
      sourceId: "lab-order-1",
      taskType: "LAB_TO_PROCESS",
      priority: "HIGH",
      slaMinutes: 240,
      status: "PENDIENTE",
    });
  });

  it("ítem gabinete → crea ImagingRequest+ImagingOrder + CareTask RAD_TECHNICIAN", async () => {
    const tx = makeTx();
    primeResolution(tx);
    tx.labTest.findFirst.mockResolvedValueOnce({
      id: LAB_TEST_ID,
      imagingAttrs: { modalityType: "CR", modalityId: null, requiereContraste: false },
    });
    tx.$queryRaw.mockResolvedValueOnce([{ n: 1 }]); // fn_next_solicitud_imagen

    const result = await materializeOrdenesFromIndicacion(tx as never, baseParams([GAB_ITEM]));

    expect(result.imagingRequestsCreated).toBe(1);
    expect(result.ordenesOmitidas).toEqual([]);
    expect(tx.imagingRequest.create).toHaveBeenCalledTimes(1);
    expect(tx.imagingOrder.create).toHaveBeenCalledTimes(1);
    const orderData = tx.imagingOrder.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(orderData.data).toMatchObject({
      organizationId: ORG_ID,
      establishmentId: ESTABLISHMENT_ID,
      patientId: PATIENT_ID,
      requestId: "img-req-1",
      modalityType: "CR",
      priority: "STAT",
    });

    expect(tx.careTask.create).toHaveBeenCalledTimes(1);
    const taskData = tx.careTask.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(taskData.data).toMatchObject({
      assignedRoleCode: "RAD_TECHNICIAN",
      sourceType: "IMAGING_ORDER",
      sourceId: "img-order-1",
      taskType: "IMAGING_TO_PERFORM",
      priority: "CRITICAL",
      slaMinutes: 60,
    });
  });

  it("paciente irresoluble (bridge patientId NULL) → ordenesOmitidas sin crear nada ni lanzar", async () => {
    const tx = makeTx();
    primeResolution(tx, { patientId: null });

    const result = await materializeOrdenesFromIndicacion(
      tx as never,
      baseParams([LAB_ITEM, GAB_ITEM]),
    );

    expect(result.labOrdersCreated).toBe(0);
    expect(result.imagingRequestsCreated).toBe(0);
    expect(result.ordenesOmitidas).toHaveLength(2);
    expect(result.ordenesOmitidas[0]!.motivo).toMatch(/paciente/i);
    expect(tx.labOrder.create).not.toHaveBeenCalled();
    expect(tx.imagingRequest.create).not.toHaveBeenCalled();
    expect(tx.careTask.create).not.toHaveBeenCalled();
  });

  it("examen no encontrado en catálogo → se omite ese ítem sin lanzar", async () => {
    const tx = makeTx();
    primeResolution(tx);
    tx.labTest.findFirst.mockResolvedValueOnce(null);

    const result = await materializeOrdenesFromIndicacion(tx as never, baseParams([LAB_ITEM]));

    expect(result.labOrdersCreated).toBe(0);
    expect(result.ordenesOmitidas).toHaveLength(1);
    expect(result.ordenesOmitidas[0]!.motivo).toMatch(/catálogo/i);
    expect(tx.labOrder.create).not.toHaveBeenCalled();
  });

  it("organizationId no resoluble → lanza Error (contrato: aborta la firma)", async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValueOnce([{ org_id: null }]);

    await expect(
      materializeOrdenesFromIndicacion(tx as never, baseParams([LAB_ITEM])),
    ).rejects.toThrow(/current_org_id_or_ece_context/);
  });

  it("CONTRATO DE FALLO: error real en labOrder.create propaga (permite ROLLBACK completo)", async () => {
    const tx = makeTx();
    primeResolution(tx);
    tx.labTest.findFirst.mockResolvedValueOnce({ id: LAB_TEST_ID });
    const dbError = new Error('insert on table "LabOrder" violates foreign key constraint');
    tx.labOrder.create.mockRejectedValueOnce(dbError);

    await expect(
      materializeOrdenesFromIndicacion(tx as never, baseParams([LAB_ITEM])),
    ).rejects.toThrow(dbError);
  });
});

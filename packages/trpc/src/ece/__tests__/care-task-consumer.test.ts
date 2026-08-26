/**
 * Tests unitarios — materializeCareTasksFromIndicacion (CC-0026 D2 consumer).
 *
 * Estrategia: mock directo de `tx.$queryRaw` + `tx.careTask.create` (sin
 * mockDeep — el consumer solo usa esos dos miembros), siguiendo el patrón de
 * `ece/__tests__/mar-consumer.test.ts`.
 *
 * Casos cubiertos:
 *   1. Happy path — 1 CareTask por ítem, assignedRoleCode=NURSE,
 *      sourceType=INDICACION_ITEM, sourceId=item.id, title truncado a 200.
 *   2. Mapeo taskType por tipo (MEDICAMENTO/DIETA/CUIDADO_GENERAL/
 *      PROCEDIMIENTO/ESTUDIO/REPOSO) + fallback para un tipo desconocido.
 *   3. Prioridad: descripción con STAT o "urgente" (cualquier capitalización)
 *      → HIGH; cualquier otra → NORMAL.
 *   4. items=[] — no consulta nada, devuelve tasksCreated=0 sin tocar $queryRaw.
 *   5. organizationId no resoluble (current_org_id_or_ece_context() NULL) →
 *      lanza Error (no crea ninguna CareTask).
 *   6. CONTRATO DE FALLO: si `careTask.create` rechaza, la función NO atrapa
 *      la excepción — propaga tal cual (permite que firmar() revierta la
 *      transacción completa, igual que mar-consumer con farmacia).
 */
import { describe, it, expect, vi } from "vitest";
import {
  materializeCareTasksFromIndicacion,
  type CareTaskIndicacionItem,
} from "../care-task-consumer";

const INDICACION_ID = "11111111-1111-1111-1111-111111111111";
const EPISODIO_ID = "22222222-2222-2222-2222-222222222222";
const ECE_ESTAB_ID = "33333333-3333-3333-3333-333333333333";
const ESTABLISHMENT_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const ORG_ID = "66666666-6666-6666-6666-666666666666";

interface MockTx {
  $queryRaw: ReturnType<typeof vi.fn>;
  careTask: { create: ReturnType<typeof vi.fn> };
}

function makeTx(): MockTx {
  return { $queryRaw: vi.fn(), careTask: { create: vi.fn().mockResolvedValue({ id: "task" }) } };
}

/** Prima las dos respuestas que el consumer siempre pide (en orden): org, bridge. */
function primeResolution(
  tx: MockTx,
  opts: { orgId?: string | null; encounterId?: string | null; patientId?: string | null } = {},
) {
  tx.$queryRaw
    .mockResolvedValueOnce([{ org_id: opts.orgId ?? ORG_ID }])
    .mockResolvedValueOnce([
      { encounter_id: opts.encounterId ?? null, patient_id: opts.patientId ?? null },
    ]);
}

function baseParams(items: CareTaskIndicacionItem[]) {
  return {
    indicacionId: INDICACION_ID,
    episodioId: EPISODIO_ID,
    eceEstablecimientoId: ECE_ESTAB_ID,
    establishmentId: ESTABLISHMENT_ID,
    userId: USER_ID,
    items,
  };
}

describe("materializeCareTasksFromIndicacion", () => {
  it("happy path: 1 CareTask por ítem con NURSE/INDICACION_ITEM/sourceId=item.id", async () => {
    const tx = makeTx();
    primeResolution(tx);

    const items: CareTaskIndicacionItem[] = [
      { id: "item-1", tipo: "MEDICAMENTO", descripcion: "Paracetamol 500mg VO c/8h" },
      { id: "item-2", tipo: "DIETA", descripcion: "Dieta blanda hipocalórica" },
    ];

    const result = await materializeCareTasksFromIndicacion(tx as never, baseParams(items));

    expect(result.tasksCreated).toBe(2);
    expect(tx.careTask.create).toHaveBeenCalledTimes(2);

    const firstCall = tx.careTask.create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(firstCall.data).toMatchObject({
      organizationId: ORG_ID,
      establishmentId: ESTABLISHMENT_ID,
      serviceUnitId: null,
      assignedRoleCode: "NURSE",
      sourceType: "INDICACION_ITEM",
      sourceId: "item-1",
      taskType: "IND_MED_CUMPLIR",
      title: "Paracetamol 500mg VO c/8h",
      priority: "NORMAL",
      status: "PENDIENTE",
      createdBy: USER_ID,
    });
  });

  it("mapea taskType por tipo (incluye REPOSO, fuera del enum Zod pero dentro del CHECK de BD)", async () => {
    const tx = makeTx();
    primeResolution(tx);

    const items: CareTaskIndicacionItem[] = [
      { id: "1", tipo: "MEDICAMENTO", descripcion: "x" },
      { id: "2", tipo: "DIETA", descripcion: "x" },
      { id: "3", tipo: "CUIDADO_GENERAL", descripcion: "x" },
      { id: "4", tipo: "PROCEDIMIENTO", descripcion: "x" },
      { id: "5", tipo: "ESTUDIO", descripcion: "x" },
      { id: "6", tipo: "REPOSO", descripcion: "x" },
    ];

    await materializeCareTasksFromIndicacion(tx as never, baseParams(items));

    const taskTypes = tx.careTask.create.mock.calls.map(
      (c) => (c[0] as { data: { taskType: string } }).data.taskType,
    );
    expect(taskTypes).toEqual([
      "IND_MED_CUMPLIR",
      "IND_DIETA",
      "IND_CUIDADOS",
      "IND_PROCEDIMIENTO",
      "IND_ESTUDIO",
      "IND_REPOSO",
    ]);
  });

  it("tipo desconocido (drift BD↔código) cae a un taskType genérico en vez de lanzar", async () => {
    const tx = makeTx();
    primeResolution(tx);

    await materializeCareTasksFromIndicacion(
      tx as never,
      baseParams([{ id: "1", tipo: "ALGO_NUEVO", descripcion: "x" }]),
    );

    const data = tx.careTask.create.mock.calls[0]![0] as { data: { taskType: string } };
    expect(data.data.taskType).toBe("IND_GENERAL");
  });

  it.each([
    ["Administrar STAT Furosemida", "HIGH"],
    ["paciente urgente, valorar traslado", "HIGH"],
    ["URGENTE: avisar a médico de turno", "HIGH"],
    ["Dieta blanda de rutina", "NORMAL"],
  ])("prioridad por descripción %s → %s", async (descripcion, expected) => {
    const tx = makeTx();
    primeResolution(tx);

    await materializeCareTasksFromIndicacion(
      tx as never,
      baseParams([{ id: "1", tipo: "CUIDADO_GENERAL", descripcion }]),
    );

    const data = tx.careTask.create.mock.calls[0]![0] as { data: { priority: string } };
    expect(data.data.priority).toBe(expected);
  });

  it("title se trunca a 200 caracteres", async () => {
    const tx = makeTx();
    primeResolution(tx);
    const descripcionLarga = "A".repeat(250);

    await materializeCareTasksFromIndicacion(
      tx as never,
      baseParams([{ id: "1", tipo: "DIETA", descripcion: descripcionLarga }]),
    );

    const data = tx.careTask.create.mock.calls[0]![0] as { data: { title: string } };
    expect(data.data.title).toHaveLength(200);
  });

  it("items=[] no consulta nada y devuelve tasksCreated=0", async () => {
    const tx = makeTx();

    const result = await materializeCareTasksFromIndicacion(tx as never, baseParams([]));

    expect(result.tasksCreated).toBe(0);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.careTask.create).not.toHaveBeenCalled();
  });

  it("patientId/encounterId nulos en el bridge → CareTask con esos campos NULL (límite documentado)", async () => {
    const tx = makeTx();
    primeResolution(tx, { encounterId: null, patientId: null });

    await materializeCareTasksFromIndicacion(
      tx as never,
      baseParams([{ id: "1", tipo: "DIETA", descripcion: "x" }]),
    );

    const data = tx.careTask.create.mock.calls[0]![0] as {
      data: { patientId: unknown; encounterId: unknown; serviceUnitId: unknown; patientAccountId: unknown };
    };
    expect(data.data.patientId).toBeNull();
    expect(data.data.encounterId).toBeNull();
    expect(data.data.serviceUnitId).toBeNull();
    expect(data.data.patientAccountId).toBeNull();
  });

  it("encounterId/patientId resueltos por el bridge se propagan a la CareTask", async () => {
    const tx = makeTx();
    primeResolution(tx, { encounterId: "enc-1", patientId: "pat-1" });

    await materializeCareTasksFromIndicacion(
      tx as never,
      baseParams([{ id: "1", tipo: "DIETA", descripcion: "x" }]),
    );

    const data = tx.careTask.create.mock.calls[0]![0] as {
      data: { patientId: unknown; encounterId: unknown };
    };
    expect(data.data.encounterId).toBe("enc-1");
    expect(data.data.patientId).toBe("pat-1");
  });

  it("organizationId no resoluble (current_org_id_or_ece_context NULL) lanza Error sin crear tareas", async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValueOnce([{ org_id: null }]);

    await expect(
      materializeCareTasksFromIndicacion(
        tx as never,
        baseParams([{ id: "1", tipo: "DIETA", descripcion: "x" }]),
      ),
    ).rejects.toThrow(/current_org_id_or_ece_context/);

    expect(tx.careTask.create).not.toHaveBeenCalled();
  });

  it("CONTRATO DE FALLO: propaga la excepción de careTask.create en vez de tragarla", async () => {
    const tx = makeTx();
    primeResolution(tx);
    const dbError = new Error('insert on table "CareTask" violates foreign key constraint');
    tx.careTask.create.mockRejectedValueOnce(dbError);

    await expect(
      materializeCareTasksFromIndicacion(
        tx as never,
        baseParams([{ id: "1", tipo: "DIETA", descripcion: "x" }]),
      ),
    ).rejects.toThrow(dbError);
  });
});

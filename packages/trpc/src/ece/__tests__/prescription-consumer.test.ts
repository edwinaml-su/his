/**
 * Tests unitarios — materializePrescripcionFromIndicacion (ADR 0023 Ola 1).
 *
 * Estrategia: mock directo de los miembros de `tx` que el consumer usa
 * (`$queryRaw`, `$executeRaw`, `prescription.create`, `prescriptionItem.create`,
 * `prescriptionItem.findUnique`), sin mockDeep — mismo patrón de
 * `ece/__tests__/care-task-consumer.test.ts` / `order-consumer.test.ts`.
 *
 * Casos cubiertos:
 *   1. Happy path — 1 ítem MEDICAMENTO con drug_id + dosis/vía/frecuencia
 *      completos → crea Prescription SIGNED + PrescriptionItem + UPDATE de
 *      la cola a RECONCILIADO con prescription_item_id.
 *   2. Ítem MEDICAMENTO sin drug_id (texto libre) → no crea Prescription, no
 *      hace ninguna query (early return), sin itemsOmitidos.
 *   3. Ítem con drug_id pero sin vía válida → itemsOmitidos con motivo, sin
 *      Prescription, sin queries.
 *   4. Mezcla: 1 ítem elegible + 1 sin drug_id + 1 con drug_id pero sin dosis
 *      → 1 Prescription con 1 solo PrescriptionItem, 1 omitido.
 *   5. Bridge no resuelve encounter/patient → itemsOmitidos para todos los
 *      elegibles, sin Prescription.
 *   6. organizationId no resoluble → lanza Error, sin crear nada.
 *   7. Idempotencia: item ya RECONCILIADO con prescription_item_id → no
 *      duplica, devuelve el prescriptionId existente vía
 *      prescriptionItem.findUnique.
 *   8. CONTRATO DE FALLO: prescription.create rechaza → propaga la excepción.
 *   9. Múltiples ítems elegibles → 1 Prescription con N PrescriptionItem y N
 *      UPDATEs de cola.
 */
import { describe, it, expect, vi } from "vitest";
import {
  materializePrescripcionFromIndicacion,
  type PrescripcionIndicacionItem,
} from "../prescription-consumer";

const INDICACION_ID = "11111111-1111-1111-1111-111111111111";
const EPISODIO_ID = "22222222-2222-2222-2222-222222222222";
const PRESCRIBER_ID = "55555555-5555-5555-5555-555555555555";
const ORG_ID = "66666666-6666-6666-6666-666666666666";
const ENCOUNTER_ID = "77777777-7777-7777-7777-777777777777";
const PATIENT_ID = "88888888-8888-8888-8888-888888888888";
const DRUG_ID = "99999999-9999-9999-9999-999999999999";

interface MockTx {
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  prescription: { create: ReturnType<typeof vi.fn> };
  prescriptionItem: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
}

function makeTx(): MockTx {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(1),
    prescription: { create: vi.fn().mockResolvedValue({ id: "rx-1" }) },
    prescriptionItem: {
      create: vi.fn().mockResolvedValue({ id: "rxi-1" }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
}

/** Prima org + bridge (las dos primeras queries siempre, si se llega a ellas). */
function primeOrgAndBridge(
  tx: MockTx,
  opts: { orgId?: string | null; encounterId?: string | null; patientId?: string | null } = {},
) {
  // `=== undefined` (no `??`): un caller que pasa explícitamente `null` quiere
  // simular "bridge no resuelve" — `??` trataría ese `null` como "usa el
  // default" y rompería justo el escenario que ese caller quiere probar.
  const encounterId = opts.encounterId === undefined ? ENCOUNTER_ID : opts.encounterId;
  const patientId = opts.patientId === undefined ? PATIENT_ID : opts.patientId;
  tx.$queryRaw
    .mockResolvedValueOnce([{ org_id: opts.orgId ?? ORG_ID }])
    .mockResolvedValueOnce([{ encounter_id: encounterId, patient_id: patientId }]);
}

function medicamentoItem(
  overrides: Partial<PrescripcionIndicacionItem> = {},
): PrescripcionIndicacionItem {
  return {
    id: "item-1",
    tipo: "MEDICAMENTO",
    descripcion: "Paracetamol 500mg VO cada 8h",
    dosis: "500mg",
    via: "ORAL",
    frecuencia: "QID",
    duracion: "7 días",
    drugId: DRUG_ID,
    ...overrides,
  };
}

function baseParams(items: PrescripcionIndicacionItem[]) {
  return {
    indicacionId: INDICACION_ID,
    episodioId: EPISODIO_ID,
    prescriberId: PRESCRIBER_ID,
    items,
  };
}

describe("materializePrescripcionFromIndicacion", () => {
  it("happy path: crea Prescription SIGNED + PrescriptionItem + auto-concilia la cola", async () => {
    const tx = makeTx();
    primeOrgAndBridge(tx);
    tx.$queryRaw.mockResolvedValueOnce([]); // idempotencia: nada conciliado aún

    const result = await materializePrescripcionFromIndicacion(
      tx as never,
      baseParams([medicamentoItem()]),
    );

    expect(result).toEqual({ prescriptionId: "rx-1", itemsPrescritos: 1, itemsOmitidos: [] });

    expect(tx.prescription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG_ID,
        encounterId: ENCOUNTER_ID,
        prescriberId: PRESCRIBER_ID,
        patientId: PATIENT_ID,
        status: "SIGNED",
        signedAt: expect.any(Date),
      }),
    });

    expect(tx.prescriptionItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        prescriptionId: "rx-1",
        drugId: DRUG_ID,
        dosage: "500mg",
        route: "ORAL",
        frequency: "QID",
      }),
    });

    // UPDATE de la cola R04 vía $executeRaw (tagged template) — se llamó una vez.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("ítem MEDICAMENTO sin drug_id (texto libre) — no crea Prescription, no consulta nada", async () => {
    const tx = makeTx();

    const result = await materializePrescripcionFromIndicacion(
      tx as never,
      baseParams([medicamentoItem({ drugId: null })]),
    );

    expect(result).toEqual({ prescriptionId: null, itemsPrescritos: 0, itemsOmitidos: [] });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it("ítem con drug_id pero sin vía válida — itemsOmitidos, sin Prescription ni queries", async () => {
    const tx = makeTx();

    const result = await materializePrescripcionFromIndicacion(
      tx as never,
      baseParams([medicamentoItem({ via: null })]),
    );

    expect(result.prescriptionId).toBeNull();
    expect(result.itemsPrescritos).toBe(0);
    expect(result.itemsOmitidos).toHaveLength(1);
    expect(result.itemsOmitidos[0]!.motivo).toMatch(/dosis\/vía\/frecuencia/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it("ítem con drug_id pero sin dosis — itemsOmitidos", async () => {
    const tx = makeTx();

    const result = await materializePrescripcionFromIndicacion(
      tx as never,
      baseParams([medicamentoItem({ dosis: null })]),
    );

    expect(result.itemsOmitidos).toHaveLength(1);
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it("ítem con drug_id pero sin frecuencia — itemsOmitidos", async () => {
    const tx = makeTx();

    const result = await materializePrescripcionFromIndicacion(
      tx as never,
      baseParams([medicamentoItem({ frecuencia: null })]),
    );

    expect(result.itemsOmitidos).toHaveLength(1);
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it("mezcla: 1 elegible + 1 sin drug_id + 1 con drug_id sin dosis → 1 Prescription con 1 item, 1 omitido", async () => {
    const tx = makeTx();
    primeOrgAndBridge(tx);
    tx.$queryRaw.mockResolvedValueOnce([]); // idempotencia

    const items = [
      medicamentoItem({ id: "elegible", descripcion: "Paracetamol" }),
      medicamentoItem({ id: "sin-drug", drugId: null, descripcion: "Ibuprofeno texto libre" }),
      medicamentoItem({ id: "sin-dosis", dosis: null, descripcion: "Losartán sin dosis" }),
    ];

    const result = await materializePrescripcionFromIndicacion(tx as never, baseParams(items));

    expect(result.itemsPrescritos).toBe(1);
    expect(result.itemsOmitidos).toHaveLength(1);
    expect(result.itemsOmitidos[0]!.descripcion).toBe("Losartán sin dosis");
    expect(tx.prescription.create).toHaveBeenCalledTimes(1);
    expect(tx.prescriptionItem.create).toHaveBeenCalledTimes(1);
  });

  it("bridge no resuelve encounter/patient — todos los elegibles quedan omitidos, sin Prescription", async () => {
    const tx = makeTx();
    primeOrgAndBridge(tx, { encounterId: null, patientId: null });

    const result = await materializePrescripcionFromIndicacion(
      tx as never,
      baseParams([medicamentoItem()]),
    );

    expect(result.prescriptionId).toBeNull();
    expect(result.itemsPrescritos).toBe(0);
    expect(result.itemsOmitidos).toHaveLength(1);
    expect(result.itemsOmitidos[0]!.motivo).toMatch(/encounter\/patient/);
    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it("organizationId no resoluble — lanza Error sin crear nada", async () => {
    const tx = makeTx();
    tx.$queryRaw.mockResolvedValueOnce([{ org_id: null }]);

    await expect(
      materializePrescripcionFromIndicacion(tx as never, baseParams([medicamentoItem()])),
    ).rejects.toThrow(/current_org_id_or_ece_context/);

    expect(tx.prescription.create).not.toHaveBeenCalled();
  });

  it("idempotencia: ítem ya RECONCILIADO con prescription_item_id — no duplica, reusa prescriptionId", async () => {
    const tx = makeTx();
    primeOrgAndBridge(tx);
    tx.$queryRaw.mockResolvedValueOnce([
      { indicacion_item_id: "item-1", prescription_item_id: "rxi-existente" },
    ]);
    tx.prescriptionItem.findUnique.mockResolvedValueOnce({ prescriptionId: "rx-existente" });

    const result = await materializePrescripcionFromIndicacion(
      tx as never,
      baseParams([medicamentoItem()]),
    );

    expect(result).toEqual({ prescriptionId: "rx-existente", itemsPrescritos: 0, itemsOmitidos: [] });
    expect(tx.prescription.create).not.toHaveBeenCalled();
    expect(tx.prescriptionItem.create).not.toHaveBeenCalled();
    expect(tx.prescriptionItem.findUnique).toHaveBeenCalledWith({
      where: { id: "rxi-existente" },
      select: { prescriptionId: true },
    });
  });

  it("CONTRATO DE FALLO: propaga la excepción de prescription.create en vez de tragarla", async () => {
    const tx = makeTx();
    primeOrgAndBridge(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    const dbError = new Error('insert on table "Prescription" violates foreign key constraint');
    tx.prescription.create.mockRejectedValueOnce(dbError);

    await expect(
      materializePrescripcionFromIndicacion(tx as never, baseParams([medicamentoItem()])),
    ).rejects.toThrow(dbError);
  });

  it("múltiples ítems elegibles → 1 Prescription con N PrescriptionItem y N UPDATEs de cola", async () => {
    const tx = makeTx();
    primeOrgAndBridge(tx);
    tx.$queryRaw.mockResolvedValueOnce([]);
    tx.prescriptionItem.create
      .mockResolvedValueOnce({ id: "rxi-1" })
      .mockResolvedValueOnce({ id: "rxi-2" });

    const items = [
      medicamentoItem({ id: "item-1", descripcion: "Paracetamol" }),
      medicamentoItem({ id: "item-2", descripcion: "Amoxicilina", drugId: "aaaaaaaa-0000-0000-0000-000000000000" }),
    ];

    const result = await materializePrescripcionFromIndicacion(tx as never, baseParams(items));

    expect(result.itemsPrescritos).toBe(2);
    expect(tx.prescription.create).toHaveBeenCalledTimes(1);
    expect(tx.prescriptionItem.create).toHaveBeenCalledTimes(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
});

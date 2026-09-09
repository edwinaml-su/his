/**
 * Tests unitarios — checkPrescriptionSafety (ADR 0023 Ola 2).
 *
 * Estrategia: mock directo de los miembros de `tx` que la función usa
 * (`$queryRaw`, `drug.findMany`, `patient.findUnique`, `labResult.findFirst`),
 * sin mockDeep — mismo patrón de `ece/__tests__/prescription-consumer.test.ts`.
 *
 * Casos cubiertos:
 *   1. Sin ítems con drug_id → retorna de inmediato, sin tocar la BD.
 *   2. Interacción major entre dos ítems de ESTA indicación → blocking=true.
 *   3. Interacción entre un ítem de esta indicación y un medicamento "activo"
 *      del paciente (otra indicación firmada/vigente) → blocking=true.
 *   4. Interacción SOLO entre dos medicamentos activos preexistentes (ninguno
 *      de esta indicación) → NO se reporta (filtro del header del archivo).
 *   5. Severidad moderate/minor → blocking=false, alerta igual presente.
 *   6. Renal: ClCr < 60 con todos los insumos disponibles → advisory presente.
 *   7. Renal: sin patientId / sin birthDate / sexo no M-F / <18 años / sin
 *      peso / sin creatinina → advisory null (omite en silencio), sin lanzar.
 */
import { describe, it, expect, vi } from "vitest";
import { checkPrescriptionSafety } from "../prescription-safety-check";
import type { DrugInteractionEntry } from "../../../../contracts/src/schemas/pharmacy";
import type { PrismaClient } from "@his/database";

const EPISODIO_ID = "11111111-1111-1111-1111-111111111111";
const DRUG_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DRUG_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DRUG_C_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const DRUG_D_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PATIENT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

interface MockTx {
  $queryRaw: ReturnType<typeof vi.fn>;
  drug: { findMany: ReturnType<typeof vi.fn> };
  patient: { findUnique: ReturnType<typeof vi.fn> };
  labResult: { findFirst: ReturnType<typeof vi.fn> };
}

function makeTx(): MockTx {
  return {
    $queryRaw: vi.fn(),
    drug: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findUnique: vi.fn().mockResolvedValue(null) },
    labResult: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}

const MAJOR_DATASET: DrugInteractionEntry[] = [
  {
    atcA: "B01AA03",
    atcB: "M01AE01",
    severity: "major",
    description: "Warfarina + Ibuprofeno — riesgo de sangrado",
  },
];

describe("checkPrescriptionSafety", () => {
  it("sin ítems con drug_id retorna inmediatamente sin tocar la BD", async () => {
    const tx = makeTx();

    const result = await checkPrescriptionSafety(
      tx as unknown as PrismaClient,
      { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: null }] },
      MAJOR_DATASET,
    );

    expect(result).toEqual({ alerts: [], blocking: false, renalAdvisory: null });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.drug.findMany).not.toHaveBeenCalled();
  });

  it("interacción major entre dos ítems de la misma indicación bloquea", async () => {
    const tx = makeTx();
    tx.$queryRaw
      .mockResolvedValueOnce([]) // active-meds
      .mockResolvedValueOnce([{ patient_id: null }]); // renal bridge
    tx.drug.findMany.mockResolvedValue([
      { id: DRUG_A_ID, atcCode: "B01AA03", genericName: "Warfarina" },
      { id: DRUG_B_ID, atcCode: "M01AE01", genericName: "Ibuprofeno" },
    ]);

    const result = await checkPrescriptionSafety(
      tx as unknown as PrismaClient,
      {
        episodioId: EPISODIO_ID,
        currentItems: [
          { id: "i1", drugId: DRUG_A_ID },
          { id: "i2", drugId: DRUG_B_ID },
        ],
      },
      MAJOR_DATASET,
    );

    expect(result.blocking).toBe(true);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]!.severity).toBe("major");
  });

  it("interacción entre un ítem de esta indicación y un medicamento activo del paciente bloquea", async () => {
    const tx = makeTx();
    tx.$queryRaw
      .mockResolvedValueOnce([{ drug_id: DRUG_B_ID }]) // active-meds: Ibuprofeno ya activo
      .mockResolvedValueOnce([{ patient_id: null }]); // renal bridge
    tx.drug.findMany.mockResolvedValue([
      { id: DRUG_A_ID, atcCode: "B01AA03", genericName: "Warfarina" },
      { id: DRUG_B_ID, atcCode: "M01AE01", genericName: "Ibuprofeno" },
    ]);

    const result = await checkPrescriptionSafety(
      tx as unknown as PrismaClient,
      {
        episodioId: EPISODIO_ID,
        // Solo Warfarina se está firmando ahora; Ibuprofeno viene de la
        // query de "activos" (otra indicación).
        currentItems: [{ id: "i1", drugId: DRUG_A_ID }],
      },
      MAJOR_DATASET,
    );

    expect(result.blocking).toBe(true);
    expect(result.alerts).toHaveLength(1);
  });

  it("interacción SOLO entre dos medicamentos activos preexistentes (ninguno de esta indicación) no se reporta", async () => {
    const tx = makeTx();
    // Ambos fármacos del par ya están activos por OTRAS indicaciones — el
    // ítem que se firma ahora (DRUG_C_ID) no interactúa con ninguno.
    tx.$queryRaw
      .mockResolvedValueOnce([{ drug_id: DRUG_A_ID }, { drug_id: DRUG_B_ID }])
      .mockResolvedValueOnce([{ patient_id: null }]);
    tx.drug.findMany.mockResolvedValue([
      { id: DRUG_A_ID, atcCode: "B01AA03", genericName: "Warfarina" },
      { id: DRUG_B_ID, atcCode: "M01AE01", genericName: "Ibuprofeno" },
      { id: DRUG_C_ID, atcCode: "N02BE01", genericName: "Paracetamol" },
    ]);

    const result = await checkPrescriptionSafety(
      tx as unknown as PrismaClient,
      { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_C_ID }] },
      MAJOR_DATASET,
    );

    expect(result.alerts).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  it("severidad moderate no bloquea pero la alerta se reporta", async () => {
    const tx = makeTx();
    tx.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ patient_id: null }]);
    tx.drug.findMany.mockResolvedValue([
      { id: DRUG_A_ID, atcCode: "B01AA03", genericName: "Warfarina" },
      { id: DRUG_D_ID, atcCode: "N02BE01", genericName: "Paracetamol" },
    ]);

    const result = await checkPrescriptionSafety(
      tx as unknown as PrismaClient,
      {
        episodioId: EPISODIO_ID,
        currentItems: [
          { id: "i1", drugId: DRUG_A_ID },
          { id: "i2", drugId: DRUG_D_ID },
        ],
      },
      [
        {
          atcA: "B01AA03",
          atcB: "N02BE01",
          severity: "moderate",
          description: "Warfarina + Paracetamol crónico",
        },
      ],
    );

    expect(result.blocking).toBe(false);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]!.severity).toBe("moderate");
  });

  describe("advisory renal (Cockcroft-Gault)", () => {
    function primeInteractionsSinAlertas(tx: MockTx) {
      tx.drug.findMany.mockResolvedValue([
        { id: DRUG_A_ID, atcCode: null, genericName: "Warfarina" },
      ]);
    }

    it("ClCr < 60 con todos los insumos disponibles → advisory presente", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([]) // active-meds
        .mockResolvedValueOnce([{ patient_id: PATIENT_ID }]) // renal bridge
        .mockResolvedValueOnce([{ peso: "70" }]); // signos_vitales
      tx.patient.findUnique.mockResolvedValue({
        birthDate: new Date(Date.now() - 70 * 365.25 * 24 * 60 * 60 * 1000),
        biologicalSex: { code: "M" },
      });
      tx.labResult.findFirst.mockResolvedValue({ valueNumeric: 3.5 });

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toContain("Función renal reducida");
      expect(result.renalAdvisory).toContain("19.4");
    });

    it("sin patientId resoluble → advisory null", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ patient_id: null }]);

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toBeNull();
      expect(tx.patient.findUnique).not.toHaveBeenCalled();
    });

    it("paciente sin birthDate → advisory null", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ patient_id: PATIENT_ID }]);
      tx.patient.findUnique.mockResolvedValue({ birthDate: null, biologicalSex: { code: "M" } });

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toBeNull();
    });

    it("sexo no M/F → advisory null (Cockcroft-Gault solo define esos dos factores)", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ patient_id: PATIENT_ID }]);
      tx.patient.findUnique.mockResolvedValue({
        birthDate: new Date(Date.now() - 70 * 365.25 * 24 * 60 * 60 * 1000),
        biologicalSex: { code: "I" },
      });

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toBeNull();
    });

    it("paciente menor de 18 años → advisory null (fórmula no validada en pediatría)", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ patient_id: PATIENT_ID }]);
      tx.patient.findUnique.mockResolvedValue({
        birthDate: new Date(Date.now() - 10 * 365.25 * 24 * 60 * 60 * 1000),
        biologicalSex: { code: "F" },
      });

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toBeNull();
    });

    it("sin peso registrado en signos_vitales → advisory null", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ patient_id: PATIENT_ID }])
        .mockResolvedValueOnce([]); // sin fila de peso
      tx.patient.findUnique.mockResolvedValue({
        birthDate: new Date(Date.now() - 70 * 365.25 * 24 * 60 * 60 * 1000),
        biologicalSex: { code: "M" },
      });

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toBeNull();
      expect(tx.labResult.findFirst).not.toHaveBeenCalled();
    });

    it("sin creatinina validada → advisory null", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ patient_id: PATIENT_ID }])
        .mockResolvedValueOnce([{ peso: "70" }]);
      tx.patient.findUnique.mockResolvedValue({
        birthDate: new Date(Date.now() - 70 * 365.25 * 24 * 60 * 60 * 1000),
        biologicalSex: { code: "M" },
      });
      tx.labResult.findFirst.mockResolvedValue(null);

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toBeNull();
    });

    it("ClCr en rango normal (≥60) → advisory null (no molesta si la función renal está bien)", async () => {
      const tx = makeTx();
      primeInteractionsSinAlertas(tx);
      tx.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ patient_id: PATIENT_ID }])
        .mockResolvedValueOnce([{ peso: "70" }]);
      tx.patient.findUnique.mockResolvedValue({
        birthDate: new Date(Date.now() - 30 * 365.25 * 24 * 60 * 60 * 1000),
        biologicalSex: { code: "M" },
      });
      // ((140-30)*70/(72*0.9))*1 ≈ 118.8 mL/min — normal.
      tx.labResult.findFirst.mockResolvedValue({ valueNumeric: 0.9 });

      const result = await checkPrescriptionSafety(
        tx as unknown as PrismaClient,
        { episodioId: EPISODIO_ID, currentItems: [{ id: "i1", drugId: DRUG_A_ID }] },
        [],
      );

      expect(result.renalAdvisory).toBeNull();
    });
  });
});

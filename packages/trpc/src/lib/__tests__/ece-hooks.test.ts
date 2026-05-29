/**
 * Tests unitarios para lib/ece-hooks.ts
 *
 * Verifica que hookEcePacienteAfterCreate y hookEceEpisodioAfterAdmit:
 *   - Insertan cuando no existe registro previo.
 *   - Son idempotentes (no re-insertan si ya existe).
 *   - Fallback de creación de paciente ECE dentro de hookEceEpisodioAfterAdmit.
 *   - resolveEceEstablecimientoId retorna null si no hay establecimiento ECE.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hookEcePacienteAfterCreate,
  hookEceEpisodioAfterAdmit,
  resolveEceEstablecimientoId,
} from "../ece-hooks";

// ─── Mock de PrismaLike ───────────────────────────────────────────────────────

function makeTxMock(queryRawResponses: unknown[][] = [], executeRawResponse = 1) {
  let callIndex = 0;
  const $queryRaw = vi.fn().mockImplementation(() => {
    const resp = queryRawResponses[callIndex++] ?? [];
    return Promise.resolve(resp);
  });
  const $executeRaw = vi.fn().mockResolvedValue(executeRawResponse);
  return { $queryRaw, $executeRaw };
}

// ─── hookEcePacienteAfterCreate ───────────────────────────────────────────────

describe("hookEcePacienteAfterCreate", () => {
  it("retorna el id existente si ya hay registro (idempotente)", async () => {
    const tx = makeTxMock([[{ id: "ece-pac-existing" }]]);
    const result = await hookEcePacienteAfterCreate(
      tx,
      "patient-uuid",
      "establishment-uuid",
      "MRN-001",
    );
    expect(result).toBe("ece-pac-existing");
    // Solo 1 query (el SELECT de existencia), sin INSERT.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("inserta y retorna id nuevo si no existe registro previo", async () => {
    const tx = makeTxMock([
      [], // SELECT public_patient_id → no existe
      [], // SELECT numero_expediente colisión → no colisión
      [{ id: "ece-pac-new" }], // INSERT RETURNING
    ]);
    const result = await hookEcePacienteAfterCreate(
      tx,
      "patient-uuid",
      "establishment-uuid",
      "MRN-002",
    );
    expect(result).toBe("ece-pac-new");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("usa expediente con sufijo si hay colisión de MRN", async () => {
    const patientId = "aabbccdd-0000-0000-0000-000000000000";
    const tx = makeTxMock([
      [],                            // SELECT public_patient_id → no existe
      [{ id: "other-paciente" }],    // SELECT MRN → colisión
      [{ id: "ece-pac-suffix" }],    // INSERT RETURNING
    ]);

    // Capturar el argumento del INSERT para verificar el expediente con sufijo.
    const insertArgs: unknown[] = [];
    tx.$queryRaw.mockImplementation((...args: unknown[]) => {
      insertArgs.push(args);
      const call = tx.$queryRaw.mock.calls.length - 1;
      const responses = [[], [{ id: "other-paciente" }], [{ id: "ece-pac-suffix" }]];
      return Promise.resolve(responses[call] ?? []);
    });

    const result = await hookEcePacienteAfterCreate(
      tx,
      patientId,
      "establishment-uuid",
      "MRN-003",
    );
    expect(result).toBe("ece-pac-suffix");
    // El expediente en el INSERT debe contener el prefijo del patientId
    const insertCall = tx.$queryRaw.mock.calls[2];
    // El tag template literal tiene los args separados: verificamos que
    // "MRN-003-aabbccdd" aparezca en los valores pasados al tagged template.
    const allArgs = insertCall?.flat().map(String).join(" ");
    expect(allArgs).toContain("MRN-003-aabbccdd");
  });
});

// ─── hookEceEpisodioAfterAdmit ────────────────────────────────────────────────

describe("hookEceEpisodioAfterAdmit", () => {
  it("retorna id existente si ya hay episodio vinculado (idempotente)", async () => {
    const tx = makeTxMock([[{ id: "episodio-existing" }]]);
    const result = await hookEceEpisodioAfterAdmit(
      tx,
      "encounter-uuid",
      "patient-uuid",
      "EMERGENCY",
      new Date("2026-01-01"),
      "ece-estab-uuid",
      "establishment-uuid",
      "MRN-001",
    );
    expect(result).toBe("episodio-existing");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("crea episodio cuando no existe, con paciente ECE ya existente", async () => {
    const tx = makeTxMock([
      [],                             // SELECT episodio por encounter → no existe
      [{ id: "ece-pac-uuid" }],       // SELECT paciente ECE → existe
      [{ id: "episodio-new" }],       // INSERT episodio RETURNING
    ]);
    const result = await hookEceEpisodioAfterAdmit(
      tx,
      "encounter-uuid",
      "patient-uuid",
      "SCHEDULED",
      new Date("2026-02-01"),
      "ece-estab-uuid",
      "establishment-uuid",
      "MRN-002",
    );
    expect(result).toBe("episodio-new");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("crea paciente ECE como fallback si no existe, luego crea episodio", async () => {
    const tx = makeTxMock([
      [],                             // SELECT episodio → no existe
      [],                             // SELECT paciente ECE → no existe (fallback)
      [],                             // hookEcePacienteAfterCreate: SELECT public_patient_id → no existe
      [],                             // hookEcePacienteAfterCreate: SELECT MRN colisión → no
      [{ id: "ece-pac-fallback" }],   // hookEcePacienteAfterCreate: INSERT RETURNING
      [{ id: "episodio-fallback" }],  // INSERT episodio RETURNING
    ]);
    const result = await hookEceEpisodioAfterAdmit(
      tx,
      "encounter-uuid",
      "patient-uuid",
      "EMERGENCY",
      new Date("2026-03-01"),
      "ece-estab-uuid",
      "establishment-uuid",
      "MRN-003",
    );
    expect(result).toBe("episodio-fallback");
  });
});

// ─── resolveEceEstablecimientoId ─────────────────────────────────────────────

describe("resolveEceEstablecimientoId", () => {
  it("retorna null si no existe ece.establecimiento para el public id", async () => {
    const tx = makeTxMock([[]]);
    const result = await resolveEceEstablecimientoId(tx, "estab-uuid-not-found");
    expect(result).toBeNull();
  });

  it("retorna el id de ece.establecimiento si existe", async () => {
    const tx = makeTxMock([[{ id: "ece-estab-123" }]]);
    const result = await resolveEceEstablecimientoId(tx, "estab-uuid-found");
    expect(result).toBe("ece-estab-123");
  });
});

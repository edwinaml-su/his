/**
 * gln-resolver.test.ts — cascada bed → serviceUnit → null (ADR 0019 D8).
 *
 * Gap detectado por @QA: resolveLocationGln no tenía ningún test. Es la
 * pieza que decide si un evento EPCIS de paciente sale con WHERE resuelto
 * (GLN real) o degradado a null (D8, "deliberadamente no-bloqueante").
 */
import { describe, it, expect, vi } from "vitest";
import { resolveLocationGln } from "../gln-resolver";

function makeTx(overrides: {
  bedGln?: string | null;
  serviceUnitGln?: string | null;
} = {}) {
  return {
    bed: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.bedGln === undefined ? null : { glnCodigo: overrides.bedGln },
      ),
    },
    serviceUnit: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.serviceUnitGln === undefined ? null : { glnCodigo: overrides.serviceUnitGln },
      ),
    },
  };
}

describe("resolveLocationGln", () => {
  it("prioriza el GLN de la cama cuando está resuelto", async () => {
    const tx = makeTx({ bedGln: "7413000000001", serviceUnitGln: "7413000000099" });
    const result = await resolveLocationGln(tx, { bedId: "bed-1", serviceUnitId: "su-1" });
    expect(result).toBe("7413000000001");
    // No necesita consultar serviceUnit si la cama ya resolvió.
    expect(tx.serviceUnit.findUnique).not.toHaveBeenCalled();
  });

  it("cae a serviceUnit cuando la cama no tiene GLN", async () => {
    const tx = makeTx({ bedGln: null, serviceUnitGln: "7413000000099" });
    const result = await resolveLocationGln(tx, { bedId: "bed-1", serviceUnitId: "su-1" });
    expect(result).toBe("7413000000099");
  });

  it("cae a serviceUnit cuando no se provee bedId", async () => {
    const tx = makeTx({ serviceUnitGln: "7413000000099" });
    const result = await resolveLocationGln(tx, { bedId: null, serviceUnitId: "su-1" });
    expect(result).toBe("7413000000099");
    expect(tx.bed.findUnique).not.toHaveBeenCalled();
  });

  it("devuelve null cuando ni cama ni servicio tienen GLN (D8, no bloqueante)", async () => {
    const tx = makeTx({ bedGln: null, serviceUnitGln: null });
    const result = await resolveLocationGln(tx, { bedId: "bed-1", serviceUnitId: "su-1" });
    expect(result).toBeNull();
  });

  it("devuelve null cuando no se provee ni bedId ni serviceUnitId", async () => {
    const tx = makeTx();
    const result = await resolveLocationGln(tx, {});
    expect(result).toBeNull();
    expect(tx.bed.findUnique).not.toHaveBeenCalled();
    expect(tx.serviceUnit.findUnique).not.toHaveBeenCalled();
  });

  it("devuelve null cuando la cama no existe (findUnique resuelve null completo)", async () => {
    const tx = {
      bed: { findUnique: vi.fn().mockResolvedValue(null) },
      serviceUnit: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const result = await resolveLocationGln(tx, { bedId: "bed-inexistente", serviceUnitId: null });
    expect(result).toBeNull();
  });
});

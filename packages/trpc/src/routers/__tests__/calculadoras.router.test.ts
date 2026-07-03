/**
 * Tests del calculadoras router (CC-0009).
 *
 * Cubren los gates de gobernanza y el cableado del motor:
 *   - CA-2: publicar bloquea si hay casos en falla o cero casos.
 *   - CA-2: correrCasos evalúa por el motor (expr-eval) y marca pasa/falla.
 *   - CA-6: publicar exige validación clínica (Zod literal true).
 *   - MOTOR-2/3: create rechaza ids de input que colisionan con funciones.
 *   - publicar feliz: mueve versionActual y marca la versión inmutable.
 */
import { describe, it, expect, vi } from "vitest";
import { calculadorasRouter } from "../calculadoras.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const CALC_ID = "00000000-0000-0000-0000-0000000000c1";
const VERSION_ID = "00000000-0000-0000-0000-0000000000f1";

// Definición fórmula determinista: suma de dos entradas.
const defSuma = {
  inputs: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
  expr: "a + b",
  out: { label: "Suma", u: "", dec: 0 },
  interp: [{ n: "normal", t: "ok" }],
};

function caller(prisma: unknown) {
  return calculadorasRouter.createCaller(makeCtx({ prisma: prisma as never }));
}

describe("calculadorasRouter", () => {
  // ------------------------------------------------------------- correrCasos
  describe("correrCasos", () => {
    it("evalúa por el motor y cuenta pasa/falla", async () => {
      const casos = [
        { id: "k1", entradas: { a: 2, b: 3 }, esperado: 5, tolerancia: 0 }, // pasa
        { id: "k2", entradas: { a: 2, b: 3 }, esperado: 10, tolerancia: 0 }, // falla
      ];
      const update = vi.fn().mockResolvedValue({});
      const prisma = {
        calculadoraVersion: {
          findUnique: vi.fn().mockResolvedValue({
            id: VERSION_ID,
            definicion: defSuma,
            calculadora: { tipo: "formula" },
            casosPrueba: casos,
          }),
        },
        calculadoraCasoPrueba: { update },
      };
      const res = await caller(prisma).correrCasos({ versionId: VERSION_ID });
      expect(res).toEqual({ total: 2, pasan: 1, fallan: 1 });
      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { resultado: "pasa" } }),
      );
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { resultado: "falla" } }),
      );
    });
  });

  // ------------------------------------------------------------- publicar gate
  describe("publicar (gate CA-2/CA-6)", () => {
    it("bloquea si no hay casos de prueba", async () => {
      const prisma = {
        calculadoraVersion: {
          findFirst: vi.fn().mockResolvedValue({ id: VERSION_ID, casosPrueba: [] }),
        },
      };
      await expect(
        caller(prisma).publicar({
          id: CALC_ID,
          versionId: VERSION_ID,
          validacionClinica: true,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("bloquea si algún caso está en falla", async () => {
      const prisma = {
        calculadoraVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: VERSION_ID,
            casosPrueba: [
              { id: "k1", resultado: "pasa" },
              { id: "k2", resultado: "falla" },
            ],
          }),
        },
      };
      await expect(
        caller(prisma).publicar({
          id: CALC_ID,
          versionId: VERSION_ID,
          validacionClinica: true,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("exige validación clínica (rechaza sin el flag)", async () => {
      const prisma = { calculadoraVersion: { findFirst: vi.fn() } };
      await expect(
        // @ts-expect-error — validacionClinica debe ser literal true
        caller(prisma).publicar({ id: CALC_ID, versionId: VERSION_ID }),
      ).rejects.toThrow();
    });

    it("publica cuando todos los casos pasan y marca la versión inmutable", async () => {
      const versionUpdate = vi.fn().mockResolvedValue({});
      const calcUpdate = vi.fn().mockResolvedValue({});
      const prisma = {
        calculadoraVersion: {
          findFirst: vi.fn().mockResolvedValue({
            id: VERSION_ID,
            casosPrueba: [{ id: "k1", resultado: "pasa" }],
          }),
        },
        $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            calculadoraVersion: { update: versionUpdate },
            calculadora: { update: calcUpdate },
          }),
        ),
      };
      const res = await caller(prisma).publicar({
        id: CALC_ID,
        versionId: VERSION_ID,
        validacionClinica: true,
      });
      expect(res).toEqual({ estado: "publicada", versionId: VERSION_ID });
      expect(versionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ inmutable: true }) }),
      );
      expect(calcUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { estado: "publicada", versionActualId: VERSION_ID },
        }),
      );
    });
  });

  // ------------------------------------------------------------- create validación
  describe("create (validación de definición)", () => {
    it("rechaza id de input que colisiona con función del motor", async () => {
      const prisma = {};
      await expect(
        caller(prisma).create({
          codigo: "CALC-TEST-001",
          nombre: "Colisión",
          tipo: "formula",
          categoria: "Test",
          definicion: {
            inputs: [{ id: "max", label: "Máximo" }], // colisiona con max()
            expr: "max + 1",
            out: { label: "R", u: "", dec: 0 },
            interp: [{ n: "normal", t: "ok" }],
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});

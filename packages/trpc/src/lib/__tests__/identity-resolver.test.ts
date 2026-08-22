/**
 * identity-resolver.test.ts — R03, resolver canónico User (HIS) ↔ ece.personal_salud.
 *
 * Cubre el contrato central que motivó el módulo:
 *   - resolvePersonalSalud nunca inventa: null explícito si no hay fila.
 *   - requirePersonalSalud lanza PRECONDITION_FAILED con cause estructurado
 *     y un mensaje que dice QUÉ falta (no un genérico).
 *   - Ninguna de las dos funciones devuelve `hisUserId` como si fuera un id
 *     de ece.personal_salud — el bug concreto que se está cerrando
 *     (gs1-proceso-f.router.ts `autorizarDevolucion`).
 */
import { describe, it, expect, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  resolvePersonalSalud,
  requirePersonalSalud,
  type PersonalSaludTx,
} from "../identity-resolver";

const HIS_USER_ID = "00000000-0000-0000-0000-0000000000a1";
const PERSONAL_ID = "00000000-0000-0000-0000-0000000000b2";

function makeTx(rows: Array<{ id: string; nombre_completo: string }>): PersonalSaludTx {
  return { $queryRaw: vi.fn().mockResolvedValue(rows) };
}

describe("resolvePersonalSalud", () => {
  it("devuelve la fila mapeada cuando existe personal_salud activo vinculado", async () => {
    const tx = makeTx([{ id: PERSONAL_ID, nombre_completo: "Dra. Ana Pérez" }]);
    const result = await resolvePersonalSalud(tx, HIS_USER_ID);
    expect(result).toEqual({ id: PERSONAL_ID, nombreCompleto: "Dra. Ana Pérez" });
  });

  it("devuelve null explícito cuando no hay fila — nunca cae a hisUserId", async () => {
    const tx = makeTx([]);
    const result = await resolvePersonalSalud(tx, HIS_USER_ID);
    expect(result).toBeNull();
    // El id devuelto (cuando existe) nunca debe coincidir con el hisUserId de entrada:
    // son espacios de identificadores distintos.
    expect(result).not.toBe(HIS_USER_ID);
  });

  it("consulta con el hisUserId recibido como parámetro de la query", async () => {
    const tx = makeTx([{ id: PERSONAL_ID, nombre_completo: "Dr. Juan Ruiz" }]);
    await resolvePersonalSalud(tx, HIS_USER_ID);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const call = vi.mocked(tx.$queryRaw).mock.calls[0]!;
    // Segundo argumento posicional del tagged template es el valor interpolado.
    expect(call[1]).toBe(HIS_USER_ID);
  });
});

describe("requirePersonalSalud", () => {
  it("devuelve la fila cuando resolvePersonalSalud la encuentra", async () => {
    const tx = makeTx([{ id: PERSONAL_ID, nombre_completo: "Dra. Ana Pérez" }]);
    const result = await requirePersonalSalud(tx, HIS_USER_ID);
    expect(result.id).toBe(PERSONAL_ID);
  });

  it("lanza PRECONDITION_FAILED con cause estructurado cuando no hay fila", async () => {
    const tx = makeTx([]);
    await expect(requirePersonalSalud(tx, HIS_USER_ID)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: {
        code: "ECE_PERSONAL_SALUD_NOT_FOUND",
        hisUserId: HIS_USER_ID,
      },
    });
  });

  it("el error es una TRPCError real (no un objeto plano)", async () => {
    const tx = makeTx([]);
    await expect(requirePersonalSalud(tx, HIS_USER_ID)).rejects.toBeInstanceOf(TRPCError);
  });

  it("el mensaje incluye la acción cuando se provee — diagnosticable, no genérico", async () => {
    const tx = makeTx([]);
    await expect(
      requirePersonalSalud(tx, HIS_USER_ID, {
        action: "autorizar una devolución de inventario",
      }),
    ).rejects.toThrow(/autorizar una devolución de inventario/);
  });

  it("sin action, el mensaje sigue siendo específico (menciona ece.personal_salud)", async () => {
    const tx = makeTx([]);
    await expect(requirePersonalSalud(tx, HIS_USER_ID)).rejects.toThrow(/personal_salud/);
  });
});

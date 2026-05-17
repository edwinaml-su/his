/**
 * Middleware tRPC — enforce 5 correctos GS1 en procedimientos bedside.
 *
 * Uso:
 *   someRouter.registrarAdministracion = nurseRole
 *     .use(requireGs1Validation)
 *     .input(schema)
 *     .mutation(...)
 *
 * El input del procedure DEBE contener los campos GS1:
 *   gtin, lote, expiry, pacienteId, dosis, via, hora, indicacionItemId
 * El campo `pacienteGsrn` es opcional (GSRN del paciente).
 *
 * Si cualquier campo "error" falla → PRECONDITION_FAILED con causa GS1_HARDSTOP.
 * Warnings no bloquean.
 *
 * Cuando todas las 5 capacidades GS1 están disponibles (GTIN + lote + expiry
 * + indicacionItemId presentes en el input) la validación es obligatoria.
 * Si el input no contiene `gtin` el middleware pasa sin validar (capacidad
 * GS1 no disponible — compatible con flujos legacy no-GS1).
 */

import { TRPCError } from "@trpc/server";
import { validate5Correctos, type Validate5CorrectosInput } from "./validate-5-correctos";
import type { TRPCContext } from "../context";

/** Shape mínima que debe tener el input para que aplique la validación GS1. */
interface Gs1Input {
  gtin: string;
  lote: string;
  expiry: Date;
  pacienteId: string;
  pacienteGsrn?: string;
  dosis: string;
  via: string;
  hora: Date;
  indicacionItemId: string;
  episodioId?: string;
}

function hasGs1Fields(input: unknown): input is Gs1Input {
  if (typeof input !== "object" || input === null) return false;
  const i = input as Record<string, unknown>;
  return (
    typeof i["gtin"] === "string" &&
    typeof i["lote"] === "string" &&
    i["expiry"] instanceof Date &&
    typeof i["pacienteId"] === "string" &&
    typeof i["dosis"] === "string" &&
    typeof i["via"] === "string" &&
    i["hora"] instanceof Date &&
    typeof i["indicacionItemId"] === "string"
  );
}

export async function applyGs1Validation(
  ctx: TRPCContext,
  input: unknown,
): Promise<void> {
  // Si el input no trae campos GS1, la capacidad no está disponible → skip
  if (!hasGs1Fields(input)) return;

  const gs1Input: Validate5CorrectosInput = {
    gtin: input.gtin,
    lote: input.lote,
    expiry: input.expiry,
    pacienteId: input.pacienteId,
    pacienteGsrn: input.pacienteGsrn,
    dosis: input.dosis,
    via: input.via,
    hora: input.hora,
    indicacionItemId: input.indicacionItemId,
    episodioId: input.episodioId,
  };

  const result = await validate5Correctos(ctx.prisma, gs1Input);

  if (!result.valid) {
    const erroresHard = result.errores.filter((e) => e.severity === "error");
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `GS1_HARDSTOP: ${erroresHard.map((e) => `[${e.campo}] ${e.mensaje}`).join(" | ")}`,
      cause: { errores: result.errores, correctos: result.correctos },
    });
  }
}

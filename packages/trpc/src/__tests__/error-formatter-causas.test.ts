/**
 * errorFormatter — reenvío de `causas` al cliente (RN-HIS-BOT-001 R11).
 *
 * `patientAccount.cerrar` bloquea con PRECONDITION_FAILED y
 * `cause: { causas: [...] }` (las 5 causas de bloqueo). tRPC solo serializa
 * `shape`/`data` hacia el cliente — sin el reenvío en el errorFormatter la
 * estructura muere en el server y la UI solo ve el mensaje plano. Mismo
 * patrón quirúrgico que `interactionAlerts` (ADR 0023 Ola 2).
 *
 * El formatter se invoca directamente vía `router._def._config.errorFormatter`
 * (createCaller lanza el TRPCError crudo sin pasar por el formatter — ese
 * paso ocurre en la capa de respuesta HTTP).
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";

const testRouter = router({ ping: publicProcedure.query(() => "ok" as const) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorFormatter = (testRouter._def._config as any).errorFormatter as (opts: {
  shape: { message: string; code: number; data: Record<string, unknown> };
  error: TRPCError;
  type: string;
  path: string | undefined;
  input: unknown;
  ctx: undefined;
}) => { data: Record<string, unknown> };

function format(error: TRPCError) {
  return errorFormatter({
    shape: {
      message: error.message,
      code: -32603,
      data: { code: error.code, httpStatus: 412, path: "patientAccount.cerrar" },
    },
    error,
    type: "mutation",
    path: "patientAccount.cerrar",
    input: {},
    ctx: undefined,
  });
}

describe("errorFormatter — causas (RN-HIS-BOT-001 R11)", () => {
  it("reenvía `causas` en data cuando el cause trae { causas } (patrón patientAccount.cerrar)", () => {
    const causas = [
      { tipo: "CARGOS_PENDIENTE_TARIFA", mensaje: "2 cargo(s) sin tarifa resuelta.", count: 2, codes: ["MED-001", "MED-002"] },
      { tipo: "CUENTA_PENDIENTE_REGULARIZAR", mensaje: "Pagador sin definir." },
    ];
    const shaped = format(
      new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No se puede cerrar la cuenta: 2 causa(s) de bloqueo pendientes.",
        cause: { causas } as unknown as Error,
      }),
    );

    expect(shaped.data.causas).toEqual(causas);
    // El reenvío de causas no debe contaminar los otros campos del formatter.
    expect(shaped.data.interactionAlerts).toBeNull();
    expect(shaped.data.zodError).toBeNull();
  });

  it("deja `causas: null` cuando el cause es un Error normal (sin fuga de internals)", () => {
    const shaped = format(
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "boom",
        cause: new Error("detalle interno"),
      }),
    );

    expect(shaped.data.causas).toBeNull();
  });

  it("deja `causas: null` cuando no hay cause", () => {
    const shaped = format(
      new TRPCError({ code: "PRECONDITION_FAILED", message: "La cuenta ya está cerrada." }),
    );

    expect(shaped.data.causas).toBeNull();
  });
});

/**
 * CC-0017 F2 — `abacGuard`, helper de procedure tRPC análogo a `requireRole`.
 *
 * Se construye con `t.middleware()` (exportado como `middleware` desde
 * `../trpc`), NO derivado de `tenantProcedure` — así puede encadenarse con
 * `.use()` sobre CUALQUIER procedure, incluyendo `protectedProcedure` (sin
 * garantía de tenant). Si `ctx.tenant` es null, se salta la evaluación
 * (fail-safe ALLOW) — mismo principio que "sin regla configurada no bloquea".
 *
 * Uso típico (después de `.input()` para que `input` llegue ya parseado):
 *
 *   create: physicianProcedure.input(createSchema)
 *     .use(abacGuard("prescription", "prescribe"))
 *     .mutation(...)
 *
 * Opt-in: SOLO se aplica donde se cablea explícitamente (2-3 puntos de
 * prueba de concepto — ver `docs/CC/0017/REQ-SEC-ABAC-002-*.md`). No hay
 * enforcement automático en los ~99 routers restantes; eso es trabajo
 * incremental fuera de F2.
 */
import { TRPCError } from "@trpc/server";
import type { AbacAccion, AbacRecurso, TenantContext } from "@his/contracts";
import type { TRPCContext } from "../context";
import { middleware } from "../trpc";
import { evaluarAbac } from "./motor";
import { atributosDesdeContexto } from "./atributos";
import type { AbacAtributosRuntime } from "./types";

/** Contexto con `tenant` ya confirmado no-null (post early-return). */
type AbacGuardCtx = TRPCContext & { tenant: TenantContext };

/**
 * Middleware factory: evalúa ABAC para (recurso, accion) antes del handler.
 * `extractAtributos` es opcional — permite al caller enriquecer los
 * atributos base (rol/establecimiento/servicio/hora/usuarioActivo) con datos
 * específicos del recurso (ej. `pacienteConTriaje`, `esPropioPaciente`)
 * derivados del `input` de la mutation/query.
 */
export function abacGuard<TInput = unknown>(
  recurso: AbacRecurso,
  accion: AbacAccion,
  extractAtributos?: (ctx: AbacGuardCtx, input: TInput) => Partial<AbacAtributosRuntime>,
) {
  return middleware(async ({ ctx, input, next }) => {
    if (!ctx.tenant) {
      // Sin organización seleccionada no hay AbacRule que cargar — fail-safe ALLOW.
      return next();
    }
    const guardCtx = ctx as AbacGuardCtx;

    const atributos: AbacAtributosRuntime = {
      ...atributosDesdeContexto(guardCtx.tenant),
      ...(extractAtributos ? extractAtributos(guardCtx, input as TInput) : {}),
    };

    const decision = await evaluarAbac(guardCtx.prisma, guardCtx.tenant, {
      recurso,
      accion,
      atributos,
    });

    if (!decision.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `ABAC: acceso denegado (${recurso}/${accion}) — ${decision.reason}`,
      });
    }

    return next();
  });
}

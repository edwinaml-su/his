/**
 * Router tRPC: búsqueda CIE-11 (WHO ICD-11) — proxy server-side.
 *
 * CC-0001 RF-03 / RN-02: la autoridad del catálogo es la WHO ICD API. Este
 * router envuelve @his/infrastructure/who-icd para que el secreto OAuth NUNCA
 * llegue al browser. Si la API no está configurada, degrada a `configured:false`
 * y la UI permite captura manual (validada por CIE11_CODE_REGEX en el contrato).
 *
 * Reference data sin PHI ni acceso a BD → no requiere withTenantContext.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  buscarCie11,
  isWhoIcdConfigured,
  WhoIcdNotConfiguredError,
  type WhoIcdSearchItem,
} from "@his/infrastructure";
import { router, tenantProcedure } from "../trpc";

const buscarInput = z.object({
  q: z.string().trim().min(2, "Ingrese al menos 2 caracteres.").max(120),
  limit: z.number().int().min(1).max(50).default(20),
});

export const cie11Router = router({
  /** Indica si la integración WHO ICD-11 está disponible (la UI condiciona el autocomplete). */
  estado: tenantProcedure.query(() => ({ configured: isWhoIcdConfigured() })),

  /**
   * Busca diagnósticos CIE-11. Degrada a items:[] + configured:false si no hay
   * credenciales — la UI cae a captura manual sin romper el flujo.
   */
  buscar: tenantProcedure.input(buscarInput).query(async ({ input }) => {
    if (!isWhoIcdConfigured()) {
      return { configured: false as const, items: [] as WhoIcdSearchItem[] };
    }
    try {
      const { items } = await buscarCie11(input.q, { limit: input.limit });
      return { configured: true as const, items };
    } catch (err) {
      if (err instanceof WhoIcdNotConfiguredError) {
        return { configured: false as const, items: [] as WhoIcdSearchItem[] };
      }
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: `WHO ICD-11 no respondió: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }),
});

/**
 * R1.4 (plan de remediación 2026-09) — `ssoProviderConfigRouter`.
 *
 * CRUD admin de `SsoProviderConfig` (sql/258), tenant-scoped. Reemplaza el
 * localStorage de `/admin/sso-config`. Lectura: cualquier usuario del
 * tenant (necesita ver qué hay configurado). Escritura: ADMIN/DIR, igual
 * que el resto de catálogos administrables (ver `catalogAdminProc` en
 * `lis.router.ts`).
 *
 * IMPORTANTE — sin client secrets: `config` (jsonb) solo guarda metadata NO
 * sensible (clientId, redirectUri, organizationDomain, autoProvision,
 * roleClaimMap). Un client_secret real NUNCA se acepta aquí — si Sprint
 * futuro lo necesita, va a Supabase Vault (mismo patrón que
 * PortalAccount.mfaSecret), nunca a esta tabla. Ver cabecera sql/258.
 *
 * `listSsoProvidersForLogin` (usado por la pantalla PRE-login `/sso`, sin
 * sesión) NO pasa por este router — lee la tabla directo con fallback a env
 * (ver `apps/web/src/app/actions/sso.ts`).
 */
import { TRPCError } from "@trpc/server";
import {
  ssoProviderConfigUpsertInput,
  ssoProviderConfigDeleteInput,
  ssoProviderConfigMetaSchema,
  ssoProviderEnum,
  type SsoProvider,
  type SsoProviderConfigMeta,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

const ssoAdminProc = requireRole(["ADMIN", "DIR"]);

/** El jsonb de BD no es de fiar como tipo — se re-valida al leer. */
function parseConfig(raw: unknown): SsoProviderConfigMeta {
  const parsed = ssoProviderConfigMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : { autoProvision: false };
}

/**
 * La columna `provider` es `varchar` + CHECK en SQL (sql/258), no un enum
 * nativo de Postgres — Prisma la tipa como `string`. Se re-valida contra el
 * enum Zod al leer para que el output del router quede correctamente
 * angosto (`SsoProvider`), igual que `parseConfig` para `config`.
 */
function parseProvider(raw: string): SsoProvider {
  const parsed = ssoProviderEnum.safeParse(raw);
  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Provider SSO desconocido en BD: "${raw}".`,
    });
  }
  return parsed.data;
}

export const ssoProviderConfigRouter = router({
  /** Lista los providers configurados para la organización activa. */
  list: tenantProcedure.query(async ({ ctx }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const rows = await tx.ssoProviderConfig.findMany({
        where: { organizationId: ctx.tenant.organizationId },
        orderBy: { displayName: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        organizationId: r.organizationId,
        provider: parseProvider(r.provider),
        displayName: r.displayName,
        enabled: r.enabled,
        config: parseConfig(r.config),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    });
  }),

  /**
   * Crea o actualiza (idempotente por `organizationId + provider`, igual
   * que `lis.sla.upsert`). Un solo registro por provider por organización.
   */
  upsert: ssoAdminProc.input(ssoProviderConfigUpsertInput).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const row = await tx.ssoProviderConfig.upsert({
        where: {
          organizationId_provider: {
            organizationId: ctx.tenant.organizationId,
            provider: input.provider,
          },
        },
        create: {
          organizationId: ctx.tenant.organizationId,
          provider: input.provider,
          displayName: input.displayName,
          enabled: input.enabled,
          config: input.config,
        },
        update: {
          displayName: input.displayName,
          enabled: input.enabled,
          config: input.config,
        },
      });
      return {
        id: row.id,
        organizationId: row.organizationId,
        provider: parseProvider(row.provider),
        displayName: row.displayName,
        enabled: row.enabled,
        config: parseConfig(row.config),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }),

  /** Elimina un provider. IDOR: verifica pertenencia al tenant antes de borrar. */
  delete: ssoAdminProc.input(ssoProviderConfigDeleteInput).mutation(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const existing = await tx.ssoProviderConfig.findFirst({
        where: { id: input.id, organizationId: ctx.tenant.organizationId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Provider SSO no encontrado." });
      }
      await tx.ssoProviderConfig.delete({ where: { id: input.id } });
      return { ok: true as const };
    });
  }),
});

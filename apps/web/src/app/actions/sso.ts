"use server";

/**
 * Server Actions — SSO SAML/OIDC (US-2.5).
 *
 * MVP (Sprint 1) — STUB. Estas funciones existen para que la UI pueda
 * importarlas con tipos correctos, pero NO hacen llamadas a IdP reales.
 *
 * Decisión arquitectónica (ver docs/15_sso_integration.md):
 *
 *   1. Supabase Auth nativo cubre OAuth con Google y Microsoft (Azure AD)
 *      sin costo adicional. Lo activamos en Sprint 2 simplemente
 *      configurando los providers en el dashboard de Supabase.
 *
 *   2. WorkOS / Auth0 son necesarios SOLO si tenemos clientes con SAML
 *      enterprise (AD on-prem federado). Costo:
 *        - WorkOS: $125/mes por connection (free tier 1M MAU pero por
 *          connection, así que cada hospital cliente añade $125).
 *        - Auth0: tier B2B desde $240/mes 10k MAU, más caro pero más
 *          features (passwordless, anomaly detection).
 *      MVP NO incluye SAML porque ningún cliente firmado lo requiere.
 *
 *   3. Por qué stub y no skip total: el blueprint TDR §29.7 lo requiere
 *      para acreditar diseño. La UI muestra placeholders y los Server
 *      Actions retornan respuestas tipadas correctas — listas para
 *      cablearse en Sprint 2 sin tocar callers.
 *
 * TODO(Sprint 2):
 *   1. `initiateSsoLogin` — generar state CSRF, llamar
 *      `supabase.auth.signInWithOAuth({ provider: 'google'|'azure' })` y
 *      devolver redirectUrl. Para WORKOS/AUTH0 usar SDK respectivo.
 *   2. `handleSsoCallback` — intercambiar `code` por session vía
 *      `supabase.auth.exchangeCodeForSession`, leer claims, hacer upsert
 *      atómico de User + UserExternalIdentity.
 *   3. Persistir SsoProviderConfig en BD nueva (tabla `SsoProvider`,
 *      migración pendiente). Por ahora localStorage en cliente.
 */

import { randomUUID } from "node:crypto";
import {
  type InitiateSsoLoginInput,
  type InitiateSsoLoginResult,
  type SsoCallbackInput,
  type SsoClaims,
  type SsoProvider,
  type SsoProviderConfig,
} from "@his/contracts/schemas/sso";

/**
 * Inicia el flujo SSO. MVP: siempre devuelve NOT_CONFIGURED.
 *
 * Sprint 2 hará algo así:
 * ```ts
 * const supabase = createSupabaseServerClient();
 * if (input.provider === 'GOOGLE_WORKSPACE' || input.provider === 'AZURE_AD') {
 *   const { data } = await supabase.auth.signInWithOAuth({
 *     provider: input.provider === 'GOOGLE_WORKSPACE' ? 'google' : 'azure',
 *     options: { redirectTo: `${origin}/sso/callback?next=${input.redirectTo}` }
 *   });
 *   return { ok: true, redirectUrl: data.url, state: ... };
 * }
 * if (input.provider === 'WORKOS') {
 *   const workos = new WorkOS(env.WORKOS_API_KEY);
 *   const url = workos.sso.getAuthorizationUrl({ ... });
 *   return { ok: true, redirectUrl: url, state };
 * }
 * ```
 */
export async function initiateSsoLogin(
  input: InitiateSsoLoginInput,
): Promise<InitiateSsoLoginResult> {
  // MVP stub: registrar el intento en consola servidor para debugging.
  // En Sprint 2 esto se reemplaza por la llamada real al IdP.
  console.info("[SSO STUB] initiateSsoLogin", {
    provider: input.provider,
    domain: input.organizationDomain,
    redirectTo: input.redirectTo,
  });

  return {
    ok: false,
    reason: "NOT_CONFIGURED",
    message:
      "SSO no configurado en MVP. Contacta al admin para activar en Sprint 2 " +
      "(integración Supabase Auth para Google/Microsoft, WorkOS para SAML).",
  };
}

/**
 * Maneja el callback OAuth/OIDC del IdP. MVP: stub que documenta el flujo.
 *
 * Sprint 2:
 *   1. `supabase.auth.exchangeCodeForSession(code)` — Supabase valida con
 *      el IdP y crea session.
 *   2. Leer JWT, extraer claims (email, sub, given_name, family_name).
 *   3. Validar con `ssoClaimsSchema`.
 *   4. Buscar `UserExternalIdentity` por (provider, sub).
 *      - Si existe: usar user_id mapeado.
 *      - Si no: si `autoProvision=true` y email matchea organizationDomain,
 *        crear User + UserExternalIdentity en transacción. Si no, devolver
 *        error "ACCOUNT_NOT_PROVISIONED" y mostrar mensaje al usuario.
 *   5. Aplicar `roleClaimMap` si existe — asignar UserOrgRole para grupos.
 *   6. Auditar evento (audit.AuditLog action='SSO_LOGIN').
 *   7. Redirect a `redirectTo` original.
 */
export async function handleSsoCallback(
  _input: SsoCallbackInput,
  _provider: SsoProvider,
): Promise<{ ok: false; reason: string; message: string }> {
  // MVP stub. Devuelve siempre error porque nunca llegará un callback real.
  return {
    ok: false,
    reason: "NOT_CONFIGURED",
    message:
      "Callback SSO recibido pero IdP no configurado. " +
      "Esta ruta queda activa para Sprint 2.",
  };
}

/**
 * MVP: lee configs desde una constante (mock). Sprint 2: query Prisma.
 *
 * Devuelve solo metadatos públicos (sin clientSecret) para mostrar en UI
 * pública /sso. La versión admin (con secrets) se obtiene desde
 * `listSsoProvidersAdmin` (no implementado en MVP).
 */
export async function listSsoProvidersForLogin(
  organizationDomain?: string,
): Promise<
  Array<Pick<SsoProviderConfig, "id" | "provider" | "displayName" | "organizationDomain">>
> {
  // Mock data para que la UI tenga algo que mostrar.
  // TODO(Sprint 2): const rows = await prisma.ssoProvider.findMany({
  //   where: { active: true, ...(organizationDomain ? { organizationDomain } : {}) },
  //   select: { id: true, provider: true, displayName: true, organizationDomain: true },
  // });
  const mock: Array<
    Pick<SsoProviderConfig, "id" | "provider" | "displayName" | "organizationDomain">
  > = [
    {
      id: randomUUID(),
      provider: "GOOGLE_WORKSPACE",
      displayName: "Google Workspace (Avante)",
      organizationDomain: "complejoavante.com",
    },
    {
      id: randomUUID(),
      provider: "AZURE_AD",
      displayName: "Microsoft 365 (Hospital Central)",
      organizationDomain: "hospitalcentral.sv",
    },
  ];

  if (!organizationDomain) return mock;
  return mock.filter((p) => p.organizationDomain === organizationDomain);
}

/**
 * Resuelve provider por dominio email. Útil para autorouting cuando el
 * usuario teclea su email en el form principal.
 */
export async function resolveProviderByEmail(
  email: string,
): Promise<
  | (Pick<SsoProviderConfig, "id" | "provider" | "displayName"> & { domain: string })
  | null
> {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const matches = await listSsoProvidersForLogin(domain);
  if (matches.length === 0) return null;
  const m = matches[0];
  return {
    id: m.id!,
    provider: m.provider,
    displayName: m.displayName,
    domain,
  };
}

/**
 * Stub para tests / Sprint 2 — convertir claims IdP a forma para upsert.
 * No hace IO; expuesto por si la UI quiere preview en /sso-config "test claims".
 */
export async function normalizeSsoClaims(
  claims: SsoClaims,
): Promise<{ email: string; fullName: string; externalId: string }> {
  const fullName =
    claims.name ??
    [claims.givenName, claims.familyName].filter(Boolean).join(" ").trim() ||
    claims.email.split("@")[0];

  return {
    email: claims.email.toLowerCase(),
    fullName,
    externalId: claims.sub,
  };
}

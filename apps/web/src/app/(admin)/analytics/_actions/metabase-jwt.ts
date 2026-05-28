"use server";

/**
 * metabase-jwt.ts — Server Action que firma tokens JWT para embedding Metabase.
 *
 * Implementa el protocolo de Signed Embedding de Metabase (HS256, HMAC-SHA256).
 * Ref: https://www.metabase.com/docs/latest/embedding/signed-embedding
 *
 * Responsabilidades:
 * 1. Verificar que el usuario tiene permiso analytics-read para el KPI pedido.
 * 2. Firmar el JWT con METABASE_SECRET_KEY (HS256, TTL 5 min).
 * 3. Inyectar organizationId del tenant como filtro locked en el payload.
 */

import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

// KPI IDs validos y su dashboard_id de Metabase correspondiente.
// Los dashboard IDs se configuran via variables de entorno post-setup.
export type KpiId = "K-CLI-01" | "K-CLI-02" | "K-CLI-03" | "K-FIN-01" | "K-OPS-01";

const KPI_ENV_MAP: Record<KpiId, string> = {
  "K-CLI-01": "METABASE_DASHBOARD_K_CLI_01",
  "K-CLI-02": "METABASE_DASHBOARD_K_CLI_02",
  "K-CLI-03": "METABASE_DASHBOARD_K_CLI_03",
  "K-FIN-01": "METABASE_DASHBOARD_K_FIN_01",
  "K-OPS-01": "METABASE_DASHBOARD_K_OPS_01",
};

// Roles minimos requeridos por KPI (al menos uno debe coincidir con tenant.roleCodes).
const KPI_REQUIRED_ROLES: Record<KpiId, string[]> = {
  "K-CLI-01": ["PHYSICIAN", "NURSE", "ADMIN", "MEDICAL_DIRECTOR", "COO", "CEO"],
  "K-CLI-02": ["PHYSICIAN", "ADMIN", "MEDICAL_DIRECTOR", "COO", "CEO"],
  "K-CLI-03": ["PHYSICIAN", "NURSE", "TRIAGE_NURSE", "MEDICAL_DIRECTOR", "COO"],
  "K-FIN-01": ["CFO", "COO", "ADMIN", "CEO"],
  "K-OPS-01": ["PHYSICIAN", "NURSE", "MEDICAL_DIRECTOR", "BLOOD_BANK", "ADMIN"],
};

export interface MetabaseTokenResult {
  token: string;
  iframeUrl: string;
}

export interface MetabaseTokenError {
  error: string;
}

/**
 * Firma un JWT Metabase para el KPI solicitado.
 * Retorna el token y la URL del iframe, o un error descriptivo.
 *
 * Contrato: NUNCA lanza. Cualquier excepción interna (sesión rota, env vars
 * faltantes, cookie rota) se captura y se retorna como `{ error }`. Esto
 * evita que el cliente caiga en el catch genérico "Error de conexión" — el
 * usuario siempre ve un mensaje específico y accionable.
 */
export async function getMetabaseEmbedToken(
  kpiId: KpiId
): Promise<MetabaseTokenResult | MetabaseTokenError> {
  try {
    // 0. Fast path: si NINGUNA env var Metabase está configurada, retorna
    //    "no configurado" antes de tocar sesión/RLS — útil para entornos
    //    pre-Beta.19c donde Metabase todavía no está deployado y la
    //    consulta a `getTenantContext` podría fallar por otras razones.
    const hasAnyMetabaseEnv =
      !!process.env.METABASE_SECRET_KEY ||
      !!process.env.METABASE_SITE_URL ||
      !!process.env[KPI_ENV_MAP[kpiId]];
    if (!hasAnyMetabaseEnv) {
      return {
        error: `Dashboard ${kpiId} no configurado. Metabase aún no está desplegado para este entorno (Beta.19c pendiente).`,
      };
    }

    // 1. Validar sesion y tenant.
    const user = await getCurrentUser();
    if (!user) {
      return { error: "No autenticado" };
    }

    const tenant = await getTenantContext();
    if (!tenant) {
      return { error: "Sin organización asignada" };
    }

    // 2. Verificar permiso RBAC.
    const requiredRoles = KPI_REQUIRED_ROLES[kpiId];
    const hasPermission = tenant.roleCodes.some((role: string) =>
      requiredRoles.includes(role),
    );
    if (!hasPermission) {
      return { error: "Sin permiso para ver este dashboard" };
    }

    // 3. Resolver dashboard_id desde env vars.
    const envKey = KPI_ENV_MAP[kpiId];
    const dashboardIdStr = process.env[envKey];
    if (!dashboardIdStr) {
      return {
        error: `Dashboard ${kpiId} no configurado. Contacte al administrador.`,
      };
    }
    const dashboardId = parseInt(dashboardIdStr, 10);
    if (isNaN(dashboardId)) {
      return { error: `ID de dashboard invalido para ${kpiId}` };
    }

    // 4. Verificar METABASE_SECRET_KEY y SITE_URL.
    const secretKey = process.env.METABASE_SECRET_KEY;
    if (!secretKey) {
      return { error: "Configuracion de BI incompleta (METABASE_SECRET_KEY)" };
    }
    const siteUrl = process.env.METABASE_SITE_URL;
    if (!siteUrl) {
      return { error: "Configuracion de BI incompleta (METABASE_SITE_URL)" };
    }

    // 5. Firmar JWT Metabase (HS256).
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 5 * 60; // TTL 5 minutos.
    const payload = {
      resource: { dashboard: dashboardId },
      params: {
        organization_id: tenant.organizationId,
      },
      exp,
    };
    const token = await signJwtHS256(payload, secretKey);
    const iframeUrl = `${siteUrl}/embed/dashboard/${token}#bordered=true&titled=true`;
    return { token, iframeUrl };
  } catch (err) {
    // Catch-all: log server-side para diagnóstico, pero al cliente solo
    // un mensaje genérico — evita filtrar detalles internos al iframe del
    // analytics tab que cualquier usuario logueado puede ver.
    console.error("[metabase-jwt] uncaught error", err);
    return {
      error: "Configuracion de BI no disponible. Contacte al administrador.",
    };
  }
}

/**
 * Firma un payload JWT con HMAC-SHA256 (HS256).
 * Usa Web Crypto API (disponible en Node.js >= 18 y Edge Runtime).
 * No requiere dependencias externas (no jose, no jsonwebtoken).
 */
async function signJwtHS256(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };

  const encodeBase64Url = (obj: unknown): string => {
    const json = JSON.stringify(obj);
    return Buffer.from(json)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  };

  const headerEncoded = encodeBase64Url(header);
  const payloadEncoded = encodeBase64Url(payload);
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    keyMaterial,
    new TextEncoder().encode(signingInput)
  );

  const signatureBase64Url = Buffer.from(signatureBuffer)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${signatureBase64Url}`;
}

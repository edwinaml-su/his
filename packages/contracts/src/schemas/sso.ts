/**
 * @his/contracts/schemas/sso — schemas Zod para SSO SAML/OIDC.
 *
 * US-2.5 — Single Sign-On con proveedores externos (WorkOS / Auth0 / Google
 * Workspace / Azure AD).
 *
 * MVP (Sprint 1): STUB. NO se integra ningún IdP real.
 *   - Las clases de proveedor están definidas y los schemas validados.
 *   - La UI (`/sso`, `/sso-config`) usa estos schemas pero los Server Actions
 *     devuelven respuestas de cortesía: "SSO no configurado en MVP".
 *   - Persistencia: localStorage en cliente (admin-only) en MVP.
 *
 * TODO(Sprint 2): cablear contra Supabase Auth nativo (Google, Microsoft) y
 * WorkOS Directory Sync. Ver docs/15_sso_integration.md para la decisión.
 *
 * Justificación arquitectónica (resumen — ver doc 15 para detalle):
 *   - Supabase Auth ya viene gratis con OAuth (Google, Microsoft, GitHub,
 *     etc.) — cubre el 80% de casos enterprise de Avante sin costo extra.
 *   - WorkOS / Auth0 son necesarios solo para SAML enterprise (clientes
 *     hospitales con AD on-prem). Costo: WorkOS $125/mes/connection vs
 *     Auth0 $240/mes (10k MAU). La decisión MVP es DIFERIR.
 */
import { z } from "zod";

/**
 * Catálogo de proveedores SSO soportados.
 *
 * - WORKOS: SAML / OIDC genérico vía WorkOS (preferido para SAML enterprise).
 * - AUTH0: alternativa SaaS, más cara pero con más features.
 * - GOOGLE_WORKSPACE: OAuth2 nativo de Supabase (gratis).
 * - AZURE_AD: OAuth2 nativo de Supabase (Microsoft) (gratis).
 *
 * MVP soporta GOOGLE_WORKSPACE y AZURE_AD vía Supabase.
 * Sprint 2 añade WORKOS para SAML.
 */
export const ssoProviderEnum = z.enum([
  "WORKOS",
  "AUTH0",
  "GOOGLE_WORKSPACE",
  "AZURE_AD",
]);

export type SsoProvider = z.infer<typeof ssoProviderEnum>;

/**
 * Tipo de protocolo (informativo — el proveedor lo dicta, pero ayuda en UI).
 */
export const ssoProtocolEnum = z.enum(["SAML", "OIDC", "OAUTH2"]);

/**
 * Configuración de un proveedor SSO para una organización.
 *
 * - `clientId` / `redirectUri` aplican a OIDC/OAuth2.
 * - SAML usa adicionalmente entityId, ssoUrl, x509Certificate (no en MVP).
 * - `organizationDomain` permite multi-tenant: "@hospitalcentral.com" =>
 *   este IdP. Útil cuando una sola instalación de HIS atiende a varios
 *   hospitales con AD distinto.
 */
export const ssoProviderConfigSchema = z.object({
  id: z.string().uuid().optional(), // generado al crear
  provider: ssoProviderEnum,
  protocol: ssoProtocolEnum,
  /** Nombre legible para mostrar en UI ("Hospital Central AD"). */
  displayName: z.string().min(1).max(100),
  clientId: z.string().min(1),
  /** Secreto OIDC/OAuth — NUNCA se devuelve al cliente. Solo escribir. */
  clientSecret: z.string().min(1).optional(),
  /** URL de callback que el IdP debe llamar tras autenticación. */
  redirectUri: z.string().url(),
  /**
   * Dominio email para enrutamiento automático. Si el usuario teclea
   * "juan@hospitalcentral.com" en /sso, lo redirigimos a este provider.
   * Opcional: si no se configura, aparece como botón manual.
   */
  organizationDomain: z.string().optional(),
  /** ID de organización HIS a la que pertenece esta config. */
  organizationId: z.string().uuid(),
  /** Activo/inactivo (deshabilitado temporalmente por admin). */
  active: z.boolean().default(true),
  /**
   * Permitir auto-aprovisionamiento: crear User local automáticamente al
   * primer login SSO si email coincide con organización. Sin esto, el admin
   * debe pre-crear cuentas. Default false (más seguro).
   */
  autoProvision: z.boolean().default(false),
  /**
   * Mapping de claim de roles. Si se define, los grupos del IdP se mapean
   * a roles HIS. Ej: `{ "Doctores": "MEDICO", "Admins": "ADMIN_ORG" }`.
   * MVP: ignorado (todos los SSO users entran sin roles, admin debe asignar).
   */
  roleClaimMap: z.record(z.string()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export type SsoProviderConfig = z.infer<typeof ssoProviderConfigSchema>;

/**
 * Input para iniciar login SSO desde la UI.
 */
export const initiateSsoLoginInputSchema = z.object({
  provider: ssoProviderEnum,
  /**
   * organizationDomain o providerId — uno de los dos para identificar config.
   * En UI: si el usuario hace click en un botón de provider, mandamos
   * providerId. Si autocompletó email, mandamos domain.
   */
  providerId: z.string().uuid().optional(),
  organizationDomain: z.string().optional(),
  /** Para devolver al usuario tras el SSO. Default /dashboard. */
  redirectTo: z.string().default("/dashboard"),
});

export type InitiateSsoLoginInput = z.infer<typeof initiateSsoLoginInputSchema>;

/**
 * Resultado del initiate. En MVP siempre `{ ok: false, reason: 'NOT_CONFIGURED' }`.
 * En Sprint 2 devuelve `{ ok: true, redirectUrl }` apuntando al IdP.
 */
export const initiateSsoLoginResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    redirectUrl: z.string().url(),
    state: z.string(), // CSRF / nonce
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      "NOT_CONFIGURED", // MVP default
      "PROVIDER_NOT_FOUND",
      "PROVIDER_INACTIVE",
      "DOMAIN_NOT_MAPPED",
    ]),
    message: z.string(),
  }),
]);

export type InitiateSsoLoginResult = z.infer<typeof initiateSsoLoginResultSchema>;

/**
 * Schema para el callback del IdP. Llega via querystring tras redirect.
 *
 * OIDC/OAuth: { code, state }
 * SAML: { SAMLResponse } (POST body, no querystring) — Sprint 2.
 */
export const ssoCallbackInputSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  /** Errores devueltos por IdP (RFC 6749 §4.1.2.1). */
  error: z.string().optional(),
  errorDescription: z.string().optional(),
});

export type SsoCallbackInput = z.infer<typeof ssoCallbackInputSchema>;

/**
 * Mapeo claims IdP -> User HIS local. Llega tras intercambiar `code` por
 * `id_token` con el IdP. Es el contrato interno entre handleSsoCallback y
 * el upsert de User + UserExternalIdentity.
 *
 * Claims obligatorios: email, sub (subject ID inmutable del IdP).
 * Opcionales: given_name, family_name, picture, groups (para roleClaimMap).
 */
export const ssoClaimsSchema = z.object({
  /** Subject inmutable del IdP — la PK externa. */
  sub: z.string().min(1),
  email: z.string().email(),
  emailVerified: z.boolean().default(false),
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  /** Nombre completo: si no viene, lo armamos como `given + family`. */
  name: z.string().optional(),
  picture: z.string().url().optional(),
  /** Grupos AD / roles del IdP para mapear a roles HIS via roleClaimMap. */
  groups: z.array(z.string()).optional(),
});

export type SsoClaims = z.infer<typeof ssoClaimsSchema>;

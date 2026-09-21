/**
 * Sesión MFA del personal interno — OWASP A07:2025 (Authentication Failures).
 *
 * Contexto: el TOTP de staff YA existía (enrolamiento en `/mfa/enroll`,
 * verificación en `/mfa`, backup codes, `User.mfaEnabled`), pero NADIE lo
 * exigía: `verifyMfa` marcaba la BD y devolvía ok sin dejar rastro en la
 * sesión, y ningún gate mandaba a `/mfa`. Es decir, MFA era opcional incluso
 * para DIR/ARCH/ADMIN (hallazgo A07-P3 del pentest 2026-05-30).
 *
 * Este módulo aporta la pieza que faltaba: una marca de sesión FIRMADA que
 * prueba que este navegador pasó el segundo factor.
 *
 * Formato de la cookie: `<userId>.<issuedAtMs>.<hmacSHA256>`
 *   - Firmada con `MFA_SESSION_SECRET`: una cookie httpOnly sin firmar sería
 *     trivial de falsificar por cualquiera que use curl con la contraseña
 *     robada — justo el escenario que MFA debe cubrir.
 *   - Ligada al `userId`: no se puede reusar la marca de otra cuenta.
 *   - TTL propio (12 h) independiente del de Supabase: re-pedir el factor
 *     una vez por jornada es el equilibrio acordado para turnos clínicos.
 *
 * Política (apagada por defecto): `MFA_REQUIRED_ROLE_CODES` es un CSV de
 * códigos de rol. Vacía/ausente = enforcement desactivado, comportamiento
 * idéntico al de antes. Si se configuran roles pero falta el secreto, la
 * política se considera MAL CONFIGURADA y se deniega (fail-closed): quien
 * pidió MFA debe obtener denegación, no un bypass silencioso.
 *
 * R4.5 — switch por organización (`Organization.mfaStaffRequired`, SQL 263):
 * además del CSV de roles (global, vía env), cada organización puede exigir
 * MFA a TODO su staff con un toggle en runtime desde `/organizations`
 * (default `false`). Es un OR sobre la política de roles: si la org lo tiene
 * apagado (el caso por defecto y el de producción hoy), el comportamiento es
 * BIT A BIT el mismo que antes de este cambio. Sigue exigiendo
 * `MFA_SESSION_SECRET` para firmar la cookie — sin secreto, fail-closed igual
 * que la política por roles.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const MFA_COOKIE_NAME = "his.mfa";
export const MFA_TTL_SECONDS = 12 * 60 * 60;

export type MfaPolicy =
  | { mode: "off" }
  | { mode: "enforced"; roleCodes: string[]; secret: string; orgRequired?: boolean }
  | { mode: "misconfigured"; reason: string };

/**
 * Lee la política combinando env vars (CSV de roles global) + el switch de
 * organización (`orgMfaStaffRequired`, resuelto por el caller desde
 * `Organization.mfaStaffRequired` de la org activa — este módulo no toca BD).
 * Ambas fuentes desactivadas (el default) → apagada, igual que antes de R4.5.
 */
export function readMfaPolicy(
  env: NodeJS.ProcessEnv = process.env,
  orgMfaStaffRequired = false,
): MfaPolicy {
  const roleCodes = (env.MFA_REQUIRED_ROLE_CODES ?? "")
    .split(",")
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);

  if (roleCodes.length === 0 && !orgMfaStaffRequired) return { mode: "off" };

  const secret = env.MFA_SESSION_SECRET ?? "";
  if (secret.length < 32) {
    return {
      mode: "misconfigured",
      reason:
        "Hay una política de MFA activa (roles por env o switch de organización) pero MFA_SESSION_SECRET falta o tiene menos de 32 caracteres.",
    };
  }
  return { mode: "enforced", roleCodes, secret, orgRequired: orgMfaStaffRequired };
}

/** ¿Alguno de los roles del usuario exige segundo factor? */
export function mfaRequiredForRoles(roleCodes: string[], policy: MfaPolicy): boolean {
  if (policy.mode === "off") return false;
  if (policy.mode === "misconfigured") return true; // fail-closed
  if (policy.orgRequired === true) return true; // switch de organización: todo el staff
  return roleCodes.some((r) => policy.roleCodes.includes(r.toUpperCase()));
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Emite el valor de la cookie tras un TOTP/backup code verificado. */
export function issueMfaCookie(userId: string, secret: string, now = Date.now()): string {
  const payload = `${userId}.${now}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * ¿La cookie prueba que ESTE usuario pasó el segundo factor y sigue vigente?
 * Cualquier anomalía (formato, firma, expiración, otro usuario) → false.
 */
export function verifyMfaCookie(
  raw: string | undefined,
  userId: string,
  secret: string,
  now = Date.now(),
): boolean {
  if (!raw) return false;
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [cookieUserId, issuedAtRaw, mac] = parts as [string, string, string];

  if (cookieUserId !== userId) return false;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;
  if (issuedAt > now + 60_000) return false; // emitida en el futuro → sospechosa
  if (now - issuedAt > MFA_TTL_SECONDS * 1000) return false;

  const expected = sign(`${cookieUserId}.${issuedAtRaw}`, secret);
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Resuelve si la request satisface la política de MFA.
 * `true` cuando la política está apagada o el rol no la exige.
 *
 * `policy` es OBLIGATORIO a propósito (R4.5, hallazgo de review P2-2): un
 * default `args.policy ?? readMfaPolicy()` es el mismo footgun que causó el
 * P0 de `markMfaSession` — `readMfaPolicy()` sin argumentos es env-only y
 * ignora el switch de organización. Los dos callers reales ya resuelven la
 * política completa (env + org) antes de llamar esta función; si aparece un
 * tercero que no compila por faltarle `policy`, esa es la señal correcta —
 * mejor un error de tipos que un bypass silencioso en producción.
 */
export function isMfaSatisfied(args: {
  userId: string | null;
  roleCodes: string[];
  cookie: string | undefined;
  policy: MfaPolicy;
  now?: number;
}): boolean {
  const { policy } = args;
  if (!mfaRequiredForRoles(args.roleCodes, policy)) return true;
  if (policy.mode !== "enforced" || !args.userId) return false;
  return verifyMfaCookie(args.cookie, args.userId, policy.secret, args.now ?? Date.now());
}

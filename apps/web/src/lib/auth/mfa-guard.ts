/**
 * Gate de MFA para las páginas del personal — OWASP A07:2025.
 *
 * Se llama desde los layouts `(clinical)` y `(admin)`. Es un no-op cuando la
 * política está apagada (`MFA_REQUIRED_ROLE_CODES` vacía), que es el default.
 *
 * Vive separado de `mfa-session.ts` porque éste importa `next/headers` +
 * `next/navigation` (sólo Server Components / Server Actions), mientras que
 * aquél es lógica pura y testeable.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { MFA_COOKIE_NAME, isMfaSatisfied, readMfaPolicy } from "./mfa-session";

/**
 * Redirige a `/mfa` si el usuario debe presentar el segundo factor.
 *
 * Es `async` desde Next 15: `cookies()` devuelve promesa. El codemod había
 * dejado aquí `UnsafeUnwrappedCookies`, que preserva el acceso síncrono con un
 * cast — funciona en 15 (deprecado) pero **desaparece en Next 16**, y esto es
 * un gate de seguridad: no se deja como deuda.
 *
 * `orgMfaStaffRequired` (R4.5, default `false`) es el switch de
 * `Organization.mfaStaffRequired` de la org activa — el caller lo resuelve
 * desde `TenantContext` (sin tenant/org, p.ej. usuario sin membresías, queda
 * en `false` y el comportamiento es el de la política legada por roles).
 */
export async function assertMfaOrRedirect(
  userId: string,
  roleCodes: string[],
  orgMfaStaffRequired = false,
): Promise<void> {
  const policy = readMfaPolicy(process.env, orgMfaStaffRequired);
  if (policy.mode === "off") return;

  const cookieStore = await cookies();
  const satisfied = isMfaSatisfied({
    userId,
    roleCodes,
    cookie: cookieStore.get(MFA_COOKIE_NAME)?.value,
    policy,
  });
  if (satisfied) return;

  if (policy.mode === "misconfigured") {
    // Fail-closed y ruidoso: alguien pidió MFA pero falta el secreto de firma.
    // eslint-disable-next-line no-console
    console.error(`[mfa] política mal configurada: ${policy.reason}`);
  }
  redirect("/mfa");
}

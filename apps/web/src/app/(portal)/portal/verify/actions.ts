"use server";

/**
 * Server action de verificación del magic link (S-K-1).
 *
 * Reemplaza la llamada directa `trpc.portal.auth.verifyLogin.useMutation`
 * desde el cliente. El `sessionRaw` devuelto por el procedure tRPC vive solo
 * en este server context — se mueve a una cookie HttpOnly antes de retornar
 * al browser. El cliente nunca ve el token (cierra K-02 del audit Stream K).
 *
 * El procedure tRPC subyacente (`portal.auth.verifyLogin`) se mantiene
 * inalterado por compatibilidad y para que tests unitarios sigan pasando.
 */
import { cookies, headers } from "next/headers";
import { TRPCError } from "@trpc/server";
import { appRouter, createTRPCContext } from "@his/trpc";
import { PORTAL_SESSION_COOKIE } from "@/lib/portal-session";

export interface VerifyResult {
  status: "OK" | "MFA_REQUIRED" | "ERROR";
  message?: string;
  /** Ruta a la que el cliente debe redirigir tras un OK. */
  redirectTo?: string;
}

export async function verifyMagicLink(input: {
  token: string;
  totpCode?: string;
}): Promise<VerifyResult> {
  const hdrs = headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const userAgent = hdrs.get("user-agent") ?? undefined;

  const ctx = createTRPCContext({
    user: null,
    tenant: null,
    portalAccount: null,
    ip,
    userAgent,
  });
  const caller = appRouter.createCaller(ctx);

  try {
    const result = await caller.portal.auth.verifyLogin({
      token: input.token,
      ...(input.totpCode ? { totpCode: input.totpCode } : {}),
    });

    // El token llega solo a este server context. Lo movemos a cookie HttpOnly
    // y descartamos la referencia. El cliente recibe solo `{ status: "OK" }`.
    const cookieStore = cookies();
    cookieStore.set(PORTAL_SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: result.expiresAt,
    });

    return { status: "OK", redirectTo: "/portal/dashboard" };
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === "PRECONDITION_FAILED") {
        return { status: "MFA_REQUIRED" };
      }
      return {
        status: "ERROR",
        message: err.message || "El enlace no es válido. Solicite uno nuevo.",
      };
    }
    return {
      status: "ERROR",
      message: "Error de red. Intente de nuevo.",
    };
  }
}

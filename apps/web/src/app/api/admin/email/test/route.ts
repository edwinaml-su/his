/**
 * POST /api/admin/email/test
 *
 * Envía un email de prueba al destinatario indicado para verificar que la
 * configuración SMTP (M365) está operativa. Restringido a usuarios con rol
 * ADMIN o DIRECTOR del tenant activo.
 *
 * Body JSON: { to: string, subject?: string }
 *
 * Respuestas:
 *   200 { ok: true, providerMessageId, providerName, latencyMs }
 *   401 sin sesión
 *   403 sin rol
 *   422 input inválido
 *   500 { ok: false, error, errorClass, hint? } — captura SMTP error completo
 *       (auth, network, DNS) para diagnóstico desde el dashboard admin.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  sendMail,
  EmailNotConfiguredError,
  PermanentProviderError,
  TransientProviderError,
} from "@his/infrastructure/notifications";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

// Node runtime: nodemailer requiere `net`/`tls` (NO es Edge-compatible).
export const runtime = "nodejs";

const inputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(2).max(150).default("Prueba SMTP — HIS Avante"),
});

const ALLOWED_ROLES = new Set(["ADMIN", "DIRECTOR", "DIR"]);

export async function POST(req: NextRequest) {
  // 1) Auth + rol.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sin sesión." }, { status: 401 });
  }
  const tenant = await getTenantContext();
  if (!tenant) {
    return NextResponse.json(
      { ok: false, error: "Sin organización activa." },
      { status: 401 },
    );
  }
  const hasRole = tenant.roleCodes.some((r) => ALLOWED_ROLES.has(r));
  if (!hasRole) {
    return NextResponse.json(
      { ok: false, error: "Acceso restringido a ADMIN / DIRECTOR." },
      { status: 403 },
    );
  }

  // 2) Parsear input.
  const body = await req.json().catch(() => ({}));
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Input inválido.", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const { to, subject } = parsed.data;

  // 3) Enviar.
  const startedAt = Date.now();
  try {
    const result = await sendMail({
      to,
      subject,
      html: buildTestEmailHtml({
        triggeredBy: user.fullName,
        triggeredByEmail: user.email ?? "",
        sentAt: new Date(),
      }),
      tags: { source: "admin-email-test", userId: user.id },
    });
    return NextResponse.json({
      ok: true,
      providerMessageId: result.providerMessageId,
      providerName: "smtp",
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return classifyAndRespond(err, Date.now() - startedAt);
  }
}

function classifyAndRespond(err: unknown, latencyMs: number): NextResponse {
  if (err instanceof EmailNotConfiguredError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        errorClass: "NOT_CONFIGURED",
        hint:
          "Configura SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM en Vercel y haz redeploy.",
        latencyMs,
      },
      { status: 500 },
    );
  }
  if (err instanceof PermanentProviderError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        errorClass: "PERMANENT",
        hint: getHintFromMessage(err.message),
        latencyMs,
      },
      { status: 500 },
    );
  }
  if (err instanceof TransientProviderError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        errorClass: "TRANSIENT",
        hint: "Reintenta en unos segundos. Si persiste, revisa logs y red.",
        latencyMs,
      },
      { status: 500 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido.",
      errorClass: "UNKNOWN",
      latencyMs,
    },
    { status: 500 },
  );
}

/** Convierte errores SMTP típicos en hints accionables para el admin. */
function getHintFromMessage(msg: string): string | undefined {
  if (/5\.7\.139|SmtpClientAuthentication|SMTP AUTH/i.test(msg)) {
    return "M365 tiene SMTP AUTH deshabilitado en este buzón. Habilítalo con: Set-CASMailbox -Identity <buzón> -SmtpClientAuthenticationDisabled $false";
  }
  if (/5\.7\.57|535|Authentication unsuccessful/i.test(msg)) {
    return "Credenciales rechazadas. Si la cuenta tiene MFA, necesitas un App Password (16 chars) generado en mysignins.microsoft.com.";
  }
  if (/SPF|DKIM|550 5\.7\.1/i.test(msg)) {
    return "El servidor destino rechaza por SPF/DKIM. Verifica los registros DNS de complejoavante.com.";
  }
  if (/Mailbox unavailable|550 5\.1\.1/i.test(msg)) {
    return "El email destinatario no existe.";
  }
  return undefined;
}

function buildTestEmailHtml(opts: {
  triggeredBy: string;
  triggeredByEmail: string;
  sentAt: Date;
}): string {
  const stamp = opts.sentAt.toLocaleString("es-SV", {
    dateStyle: "full",
    timeStyle: "long",
  });
  return `<!doctype html>
<html lang="es">
  <body style="font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #111;">
    <div style="max-width: 560px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px;">
      <h1 style="margin: 0 0 12px; font-size: 22px;">✅ Configuración SMTP operativa</h1>
      <p>Este es un email de prueba enviado desde el HIS Avante para verificar la integración con Microsoft 365.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
      <p style="font-size: 14px; color: #555;">
        <strong>Disparado por:</strong> ${escapeHtml(opts.triggeredBy)} (${escapeHtml(opts.triggeredByEmail)})<br/>
        <strong>Timestamp:</strong> ${escapeHtml(stamp)}<br/>
        <strong>Origen:</strong> <code>/api/admin/email/test</code>
      </p>
      <p style="font-size: 12px; color: #888; margin-top: 24px;">
        Si recibiste este email sin haberlo solicitado, ignóralo. Es una prueba interna del equipo de TI.
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

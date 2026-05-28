/**
 * SmtpProvider — adapter SMTP del contrato `EmailProvider`.
 *
 * Implementación con nodemailer apuntando a un SMTP corporativo (típicamente
 * Microsoft 365 / Exchange Online: smtp.office365.com:587 STARTTLS). Reusa la
 * arquitectura hexagonal del módulo notifications: el router/poller depende
 * de `EmailProvider`, este archivo es el detalle concreto.
 *
 * Clasificación de errores (parity con ResendProvider):
 *   - Conexión / DNS / TLS handshake / timeout → TransientProviderError
 *   - SMTP 5.x.x (550 invalid recipient, 552 size, 554 spam, etc) → Permanent
 *   - SMTP 4.x.x (421 temporary down, 450 mailbox busy) → Transient
 *   - 535 / 5.7.x auth → Permanent (no se va a "auto-resolver" reintentando)
 *
 * Por qué nodemailer y no fetch directo:
 *   SMTP es un protocolo binario sobre TCP con STARTTLS/EHLO/AUTH stateful.
 *   Reimplementarlo a mano es trivial-no-trivial; nodemailer cubre los edge
 *   cases (XOAUTH2, pooled connections, encoding 8bit, attachments) y está
 *   bien mantenido. Lo importamos dinámico para que el bundle del Edge runtime
 *   no lo levante si no se usa.
 */
import {
  type EmailProvider,
  type EmailSendInput,
  type EmailSendResult,
  TransientProviderError,
  PermanentProviderError,
} from "@his/contracts";
import { createTransport, type Transporter, type SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

export interface SmtpProviderOptions {
  host: string;
  port: number;
  /** STARTTLS al puerto 587 (Office 365). True implícito si port=465. */
  secure?: boolean;
  user: string;
  password: string;
  /** Nombre legible "HIS Avante" para el From header. Default: user. */
  fromName?: string;
  /** Override para tests. */
  transporter?: Transporter;
  /** Timeout de conexión (ms). Default 15s. M365 a veces tarda ≈8s en handshake. */
  connectionTimeoutMs?: number;
}

/** Códigos SMTP que clasifican como auth permanente (no reintentes). */
const PERMANENT_AUTH_PREFIXES = ["535", "534", "530", "501", "550", "552", "553", "554"];

export class SmtpProvider implements EmailProvider {
  readonly providerName = "smtp";
  readonly host: string;
  readonly fromName: string;
  private readonly transporter: Transporter;

  constructor(opts: SmtpProviderOptions) {
    if (!opts.host) throw new Error("SmtpProvider: host requerido.");
    if (!opts.user) throw new Error("SmtpProvider: user requerido.");
    if (!opts.password) throw new Error("SmtpProvider: password requerido.");
    if (!opts.port) throw new Error("SmtpProvider: port requerido.");

    this.host = opts.host;
    this.fromName = opts.fromName ?? opts.user;
    // Pool desactivado: cada request del HIS es de baja frecuencia (alertas
    // críticas, invitaciones). Una conexión pooled mantiene un socket que
    // M365 cierra tras ~10 min — mejor abrir-cerrar por mensaje (default
    // de nodemailer cuando se omite `pool`).
    const smtpOptions: SMTPTransport.Options = {
      host: opts.host,
      port: opts.port,
      secure: opts.secure ?? opts.port === 465,
      auth: { user: opts.user, pass: opts.password },
      connectionTimeout: opts.connectionTimeoutMs ?? 15_000,
      // Office 365 / Exchange Online recomienda STARTTLS explícito en 587.
      requireTLS: opts.port === 587,
    };
    this.transporter = opts.transporter ?? createTransport(smtpOptions);
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const mail: SendMailOptions = {
      from:
        input.from && input.from.includes("@")
          ? input.from
          : `"${this.fromName}" <${input.from}>`,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      // M365 ignora la mayoría de headers custom; pasamos `tags` como
      // X-* headers para correlación interna y debugging futuro.
      headers: input.tags
        ? Object.fromEntries(
            Object.entries(input.tags).map(([k, v]) => [
              `X-HIS-${k.toUpperCase()}`,
              v,
            ]),
          )
        : undefined,
    };

    try {
      const info = await this.transporter.sendMail(mail);
      if (!info?.messageId) {
        throw new PermanentProviderError(
          "SMTP envío sin messageId — respuesta inesperada del servidor.",
        );
      }
      return { providerMessageId: info.messageId, status: "SENT" };
    } catch (cause) {
      throw classifySmtpError(cause);
    }
  }
}

/**
 * Clasifica un error de nodemailer/SMTP en Transient vs Permanent.
 * Visible (no `private`) para tests unitarios.
 */
export function classifySmtpError(cause: unknown): Error {
  const err = cause as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
  };
  const msg = err?.message ?? "unknown SMTP error";
  const code = err?.code ?? "";
  const responseCode = err?.responseCode;

  // Errores de conexión / red / DNS / TLS → reintentable.
  if (
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ESOCKET" ||
    code === "EDNS" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND"
  ) {
    return new TransientProviderError(`SMTP network error (${code}): ${msg}`, cause);
  }

  // Respuesta SMTP — clasificar por código numérico.
  if (typeof responseCode === "number") {
    if (responseCode >= 500) {
      // 5xx — auth, recipient inválido, contenido rechazado, etc.
      const responsePrefix = (err.response ?? "").slice(0, 3);
      const isPermanent = PERMANENT_AUTH_PREFIXES.some((p) =>
        responsePrefix.startsWith(p),
      );
      return isPermanent
        ? new PermanentProviderError(
            `SMTP ${responseCode}: ${(err.response ?? msg).slice(0, 200)}`,
            cause,
          )
        : new PermanentProviderError(
            `SMTP ${responseCode}: ${(err.response ?? msg).slice(0, 200)}`,
            cause,
          );
    }
    if (responseCode >= 400) {
      // 4xx — temporal (greylisting, mailbox busy, rate limit).
      return new TransientProviderError(
        `SMTP ${responseCode}: ${(err.response ?? msg).slice(0, 200)}`,
        cause,
      );
    }
  }

  // Fallback: por defecto transient para no perder mensajes por bugs nuestros
  // en la clasificación. El poller lo reintentará.
  return new TransientProviderError(`SMTP error: ${msg}`, cause);
}

// ---------------------------------------------------------------------------
// Factory — selecciona provider según env vars disponibles.
// ---------------------------------------------------------------------------

/**
 * Construye el `EmailProvider` apropiado según el entorno.
 *
 * Orden de preferencia:
 *  1. SMTP custom (SMTP_HOST + SMTP_USER + SMTP_PASS presentes) ← M365 / SES / etc.
 *  2. Resend (RESEND_API_KEY presente) — legacy Beta.15
 *  3. null — no hay provider; caller debe degradar a no-op o lanzar
 *
 * Pensado para llamarse 1 vez al inicio del proceso (singleton). NO leemos
 * env vars en cada send() para evitar latencia y permitir testing por DI.
 */
export function createEmailProviderFromEnv(): EmailProvider | null {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    return new SmtpProvider({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT ?? 587),
      user: smtpUser,
      password: smtpPass,
      fromName: process.env.SMTP_FROM_NAME ?? "HIS Avante",
      secure: process.env.SMTP_SECURE === "true",
    });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    // Import dinámico para no levantar el adapter Resend si no hay key.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ResendProvider } = require("./resend");
    return new ResendProvider({ apiKey: resendKey });
  }

  return null;
}

/**
 * Helper de envío directo (no pasa por el dispatcher Beta.15). Útil para
 * notificaciones operativas que no requieren routing complejo: invitaciones,
 * recuperación, menciones, alertas ad-hoc.
 *
 * - Lazy-singleton del provider (1 instancia por proceso Node).
 * - From default: SMTP_FROM o SMTP_USER si no se pasa.
 * - Si no hay provider configurado, lanza `EmailNotConfiguredError` (no falla
 *   en silencio para que el caller decida si degradar o propagar).
 */
let _cachedProvider: EmailProvider | null | undefined;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email no configurado: define SMTP_HOST + SMTP_USER + SMTP_PASS (o RESEND_API_KEY) en el entorno.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  tags?: Record<string, string>;
}): Promise<EmailSendResult> {
  if (_cachedProvider === undefined) {
    _cachedProvider = createEmailProviderFromEnv();
  }
  if (!_cachedProvider) {
    throw new EmailNotConfiguredError();
  }
  const from =
    input.from ?? process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "";
  if (!from) {
    throw new EmailNotConfiguredError();
  }
  return _cachedProvider.send({
    to: input.to,
    from,
    subject: input.subject,
    html: input.html,
    text: input.text ?? stripHtml(input.html),
    tags: input.tags,
  });
}

/** Solo para tests: reset del singleton entre tests. */
export function __resetEmailProviderCache(): void {
  _cachedProvider = undefined;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

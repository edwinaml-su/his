/**
 * Beta.15 — contrato genérico de provider de email (adapter).
 *
 * Implementaciones concretas viven en `packages/infrastructure` (hoy: Resend;
 * futuro: SES/SMTP). El router/poller depende SOLO de esta interface, nunca
 * del adapter concreto (arquitectura hexagonal — TDR §29 / ADR 0008).
 */

export interface EmailSendInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  /** Etiquetas opcionales para telemetría / threading del provider. */
  tags?: Record<string, string>;
}

export interface EmailSendResult {
  /** id del mensaje en el provider (ej. Resend message_id). */
  providerMessageId: string;
  /** Provider-specific status si retorna algo más rico que SENT. */
  status?: string;
}

export interface EmailProvider {
  /** Envía el email. Lanza Transient/Permanent error si falla. */
  send(input: EmailSendInput): Promise<EmailSendResult>;
  /** Nombre del provider para logging/audit (ej. "resend", "ses"). */
  readonly providerName: string;
}

/**
 * Error de fallo transitorio — el caller (poller) debe reintentar con backoff.
 * HTTP 5xx, timeouts, errores de red/DNS/TLS clasifican acá.
 */
export class TransientProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TransientProviderError";
  }
}

/**
 * Error de fallo permanente — el caller marca la notificación como FAILED.
 * HTTP 4xx (auth inválida, email inválido, payload inválido) clasifica acá.
 */
export class PermanentProviderError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PermanentProviderError";
  }
}

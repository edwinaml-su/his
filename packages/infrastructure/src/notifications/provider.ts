/**
 * EmailProvider port — Beta.15 (US.B15.2.3).
 *
 * NOTA Track A coexistencia:
 *   Esta interface duplica temporalmente la que Track A define en
 *   `@his/contracts/notifications/provider`. Si #58 (Track A — Resend
 *   adapter) mergea antes que este PR, dedup eliminando este archivo y
 *   actualizando el import en `dispatcher.ts`.
 *   Si este PR mergea primero, Track A debe re-exportar / reusar estas
 *   definiciones — son source-of-truth equivalente.
 *
 * Diseño hexagonal:
 *   El dispatcher solo conoce el puerto (interface) — el adapter concreto
 *   (Resend, SES, log-stub) se inyecta por DI en el caller.
 */

export interface EmailProviderSendInput {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  /** Tags para tracking/analytics del provider (ej: eventId, severity). */
  tags?: Record<string, string>;
}

export interface EmailProviderSendResult {
  /** ID asignado por el provider (ej. Resend ULID). */
  providerMessageId: string;
  /** Status reportado por el provider (ej. "queued"). */
  status?: string;
}

export interface EmailProvider {
  send(input: EmailProviderSendInput): Promise<EmailProviderSendResult>;
  readonly providerName: string;
}

/**
 * Error transitorio del provider (timeout, 5xx, rate limit). El dispatcher
 * deja la fila `Notification` en `PENDING` para retry — NO marca FAILED.
 */
export class TransientProviderError extends Error {
  readonly kind = "transient" as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "TransientProviderError";
  }
}

/**
 * Error permanente del provider (4xx no recuperable, email inválido,
 * destinatario bloqueado). El dispatcher marca la fila como `FAILED` con
 * `failureReason` — NO se reintenta.
 */
export class PermanentProviderError extends Error {
  readonly kind = "permanent" as const;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PermanentProviderError";
  }
}

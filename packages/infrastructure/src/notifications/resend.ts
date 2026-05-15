/**
 * Beta.15 — Adapter Resend del contrato `EmailProvider`.
 *
 * Usa `fetch` nativo (Node 20+) para evitar añadir el SDK `resend` como
 * dependencia (decisión §SRE blueprint Beta.15 — minimizar superficie de
 * supply chain). El SDK solo aporta tipados; el endpoint es trivial.
 *
 * Clasificación de errores (acorde a strategy del poller US.B15.1.3):
 *   - Network/DNS/TLS → TransientProviderError
 *   - HTTP 5xx       → TransientProviderError
 *   - HTTP 4xx       → PermanentProviderError
 *   - 200 sin id     → PermanentProviderError (payload inesperado, no recuperable)
 */
import {
  type EmailProvider,
  type EmailSendInput,
  type EmailSendResult,
  TransientProviderError,
  PermanentProviderError,
} from "@his/contracts";

export interface ResendProviderOptions {
  apiKey: string;
  /** Para testing — sobreescribe el endpoint Resend default. */
  baseUrl?: string;
  /** Inyectable para tests; defaults a globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export class ResendProvider implements EmailProvider {
  readonly providerName = "resend";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ResendProviderOptions) {
    if (!opts.apiKey) throw new Error("ResendProvider: apiKey requerida.");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.resend.com";
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          tags: input.tags
            ? Object.entries(input.tags).map(([name, value]) => ({ name, value }))
            : undefined,
        }),
      });
    } catch (cause) {
      // Network / DNS / TLS error → transient.
      const msg = cause instanceof Error ? cause.message : "unknown";
      throw new TransientProviderError(`Resend network error: ${msg}`, cause);
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { id?: string }
        | null;
      if (!body?.id) {
        throw new PermanentProviderError(
          "Resend 200 sin id en respuesta — formato inesperado.",
        );
      }
      return { providerMessageId: body.id, status: "SENT" };
    }

    const errBody = await response.text().catch(() => "");
    if (response.status >= 500) {
      throw new TransientProviderError(
        `Resend ${response.status}: ${errBody.slice(0, 200)}`,
      );
    }
    // 4xx — permanent (invalid email, auth, etc).
    throw new PermanentProviderError(
      `Resend ${response.status}: ${errBody.slice(0, 200)}`,
    );
  }
}

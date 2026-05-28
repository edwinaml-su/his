/**
 * Tests del SmtpProvider — mock de nodemailer.Transporter.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SmtpProvider,
  classifySmtpError,
  createEmailProviderFromEnv,
  sendMail,
  EmailNotConfiguredError,
  __resetEmailProviderCache,
} from "../smtp";
import {
  TransientProviderError,
  PermanentProviderError,
} from "@his/contracts";

function makeMockTransporter(impl: {
  sendMail?: (m: unknown) => Promise<unknown>;
}) {
  return {
    sendMail: impl.sendMail ?? vi.fn().mockResolvedValue({ messageId: "<m1@test>" }),
    // Métodos no usados — stubs vacíos para satisfacer el tipo Transporter.
    close: () => undefined,
    verify: () => Promise.resolve(true),
    use: () => undefined,
    isIdle: () => true,
    options: {},
  } as never;
}

describe("SmtpProvider", () => {
  beforeEach(() => {
    __resetEmailProviderCache();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.RESEND_API_KEY;
  });

  it("envía correctamente y devuelve providerMessageId", async () => {
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "<abc@host>" });
    const provider = new SmtpProvider({
      host: "smtp.office365.com",
      port: 587,
      user: "his@x.com",
      password: "secret",
      transporter: makeMockTransporter({ sendMail: sendMailMock }),
    });

    const result = await provider.send({
      to: "user@example.com",
      from: "his@x.com",
      subject: "Hola",
      html: "<p>hola</p>",
      text: "hola",
    });

    expect(result.providerMessageId).toBe("<abc@host>");
    expect(sendMailMock).toHaveBeenCalled();
    const call = sendMailMock.mock.calls[0]![0] as { to: string; subject: string };
    expect(call.to).toBe("user@example.com");
    expect(call.subject).toBe("Hola");
  });

  it("clasifica auth 535 como Permanent", () => {
    const err = classifySmtpError({
      code: "EAUTH",
      responseCode: 535,
      response: "535 5.7.3 Authentication unsuccessful",
      message: "auth failed",
    });
    expect(err).toBeInstanceOf(PermanentProviderError);
  });

  it("clasifica error de red ETIMEDOUT como Transient", () => {
    const err = classifySmtpError({
      code: "ETIMEDOUT",
      message: "connection timeout",
    });
    expect(err).toBeInstanceOf(TransientProviderError);
  });

  it("clasifica 421 SMTP temporal como Transient", () => {
    const err = classifySmtpError({
      responseCode: 421,
      response: "421 4.3.2 Service not available",
      message: "temporal",
    });
    expect(err).toBeInstanceOf(TransientProviderError);
  });

  it("lanza EmailNotConfiguredError si no hay env vars", async () => {
    await expect(
      sendMail({ to: "x@y.com", subject: "s", html: "<p>x</p>" }),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it("createEmailProviderFromEnv devuelve null sin config", () => {
    expect(createEmailProviderFromEnv()).toBeNull();
  });

  it("createEmailProviderFromEnv devuelve SmtpProvider con env vars SMTP", () => {
    process.env.SMTP_HOST = "smtp.office365.com";
    process.env.SMTP_USER = "his@x.com";
    process.env.SMTP_PASS = "secret";
    const provider = createEmailProviderFromEnv();
    expect(provider).toBeInstanceOf(SmtpProvider);
    expect(provider?.providerName).toBe("smtp");
  });

  it("constructor exige host/user/password", () => {
    expect(
      () => new SmtpProvider({ host: "", port: 587, user: "x", password: "y" }),
    ).toThrow(/host/);
    expect(
      () => new SmtpProvider({ host: "h", port: 587, user: "", password: "y" }),
    ).toThrow(/user/);
    expect(
      () => new SmtpProvider({ host: "h", port: 587, user: "x", password: "" }),
    ).toThrow(/password/);
  });
});

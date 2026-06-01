// @ts-nocheck - portal router tests (Beta.20 E.B20.1)
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { portalRouter } from "../portal.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const PA = "00000000-0000-0000-0000-000000000pa1";
const PT = "00000000-0000-0000-0000-000000000pt1";
const WD = "00000000-0000-0000-0000-000000000pt2";
const EM = "p@test.com";
const DUI = "000000018"; // body 00000001, check=8

const pc = (prisma) => makeCtx({ prisma, user: null, tenant: null, portalAccount: { id: PA, patientId: PT, email: EM } });
const pub = (prisma) => makeCtx({ prisma, user: null, tenant: null });

describe("portal.account.register", () => {
  let prisma;
  beforeEach(() => { prisma = mockDeep(); vi.spyOn(console, "log").mockImplementation(() => undefined); });

  it("crea cuenta y magic link con DUI valido", async () => {
    prisma.patientIdentifier.findFirst.mockResolvedValue({ id: "i", patientId: PT });
    prisma.portalAccount.findUnique.mockResolvedValue(null);
    prisma.portalAccount.create.mockResolvedValue({ id: PA });
    prisma.portalMagicLink.create.mockResolvedValue({});
    const r = await portalRouter.createCaller(pub(prisma)).account.register({ email: EM, patientId: PT, dui: DUI });
    expect(r).toEqual({ sent: true });
    expect(prisma.portalMagicLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ purpose: "REGISTER" }) }));
  });

  it("anti-enumeracion: DUI no coincide", async () => {
    prisma.patientIdentifier.findFirst.mockResolvedValue(null);
    expect(await portalRouter.createCaller(pub(prisma)).account.register({ email: EM, patientId: PT, dui: DUI })).toEqual({ sent: true });
    expect(prisma.portalAccount.create).not.toHaveBeenCalled();
  });

  it("no duplica cuenta ACTIVE", async () => {
    prisma.patientIdentifier.findFirst.mockResolvedValue({ id: "i", patientId: PT });
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, email: "x@x.com", status: "ACTIVE" });
    expect(await portalRouter.createCaller(pub(prisma)).account.register({ email: EM, patientId: PT, dui: DUI })).toEqual({ sent: true });
    expect(prisma.portalAccount.create).not.toHaveBeenCalled();
  });

  it("rechaza DUI invalido", async () => {
    // "000000019": body 00000001 con check digit 9 (el correcto es 8) → validateDUI=false.
    // NOTA: "000000000" es un DUI VÁLIDO (todo ceros → check 0); el test previo
    // pasaba solo por fuga de estado del rate-limiter in-memory global entre archivos.
    await expect(portalRouter.createCaller(pub(prisma)).account.register({ email: EM, patientId: PT, dui: "000000019" })).rejects.toThrow();
  });
});

describe("portal.account.verifyEmail", () => {
  let prisma;
  beforeEach(() => { prisma = mockDeep(); });

  it("activa cuenta con link valido", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({ id: "l", accountId: PA, purpose: "REGISTER", expiresAt: new Date(Date.now()+60000), consumedAt: null });
    prisma.$transaction.mockImplementation(async (ops) => { if (Array.isArray(ops)) for (const o of ops) await o; return []; });
    expect(await portalRouter.createCaller(pub(prisma)).account.verifyEmail({ token: "t" })).toEqual({ verified: true });
  });

  it("rechaza consumedAt set", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({ id: "l", accountId: PA, purpose: "REGISTER", expiresAt: new Date(Date.now()+60000), consumedAt: new Date(Date.now()-1000) });
    await expect(portalRouter.createCaller(pub(prisma)).account.verifyEmail({ token: "u" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rechaza expirado", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({ id: "l", accountId: PA, purpose: "REGISTER", expiresAt: new Date(Date.now()-1000), consumedAt: null });
    await expect(portalRouter.createCaller(pub(prisma)).account.verifyEmail({ token: "e" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rechaza token inexistente", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue(null);
    await expect(portalRouter.createCaller(pub(prisma)).account.verifyEmail({ token: "n" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("portal.auth.requestLogin", () => {
  let prisma;
  beforeEach(() => { prisma = mockDeep(); vi.spyOn(console, "log").mockImplementation(() => undefined); });

  it("crea magic link LOGIN para ACTIVE", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, status: "ACTIVE", lockedUntil: null });
    prisma.portalMagicLink.create.mockResolvedValue({});
    expect(await portalRouter.createCaller(pub(prisma)).auth.requestLogin({ email: EM })).toEqual({ sent: true });
    expect(prisma.portalMagicLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ purpose: "LOGIN" }) }));
  });

  it("anti-enumeracion email inexistente", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue(null);
    expect(await portalRouter.createCaller(pub(prisma)).auth.requestLogin({ email: "x@x.com" })).toEqual({ sent: true });
    expect(prisma.portalMagicLink.create).not.toHaveBeenCalled();
  });

  it("no envia si bloqueada", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, status: "ACTIVE", lockedUntil: new Date(Date.now()+600000) });
    expect(await portalRouter.createCaller(pub(prisma)).auth.requestLogin({ email: EM })).toEqual({ sent: true });
    expect(prisma.portalMagicLink.create).not.toHaveBeenCalled();
  });
});

describe("portal.auth.verifyLogin", () => {
  let prisma;
  const vl = { id: "l", accountId: PA, purpose: "LOGIN", expiresAt: new Date(Date.now()+60000), consumedAt: null, account: { id: PA, status: "ACTIVE", mfaEnabled: false, mfaSecret: null, failedLoginAttempts: 0, lockedUntil: null } };
  beforeEach(() => {
    prisma = mockDeep();
    // Vault retorna null → activa fallback app-layer para tests legados con mfaSecret.
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: null }]);
  });

  it("happy-path sin MFA retorna token", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue(vl);
    prisma.$transaction.mockImplementation(async (ops) => { if (Array.isArray(ops)) for (const o of ops) await o; return []; });
    const r = await portalRouter.createCaller(pub(prisma)).auth.verifyLogin({ token: "t" });
    expect(r).toHaveProperty("token");
    expect(r).toHaveProperty("expiresAt");
    expect(r.token.length).toBeGreaterThan(10);
  });

  it("rechaza link expirado", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({ ...vl, expiresAt: new Date(Date.now()-1000) });
    await expect(portalRouter.createCaller(pub(prisma)).auth.verifyLogin({ token: "e" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rechaza link consumido", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({ ...vl, consumedAt: new Date(Date.now()-5000) });
    await expect(portalRouter.createCaller(pub(prisma)).auth.verifyLogin({ token: "u" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("requiere totpCode si mfaEnabled", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({ ...vl, account: { ...vl.account, mfaEnabled: true, mfaSecret: "enc" } });
    await expect(portalRouter.createCaller(pub(prisma)).auth.verifyLogin({ token: "t" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("INTERNAL_SERVER_ERROR si mfaEnabled sin mfaSecret", async () => {
    prisma.portalMagicLink.findUnique.mockResolvedValue({ ...vl, account: { ...vl.account, mfaEnabled: true, mfaSecret: null } });
    await expect(portalRouter.createCaller(pub(prisma)).auth.verifyLogin({ token: "t", totpCode: "123456" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("portal.auth.logout", () => {
  let prisma;
  beforeEach(() => { prisma = mockDeep(); });

  it("revoca sesiones activas", async () => {
    prisma.portalSession.updateMany.mockResolvedValue({ count: 1 });
    expect(await portalRouter.createCaller(pc(prisma)).auth.logout()).toEqual({ ok: true });
    expect(prisma.portalSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: PA }) }));
  });

  it("UNAUTHORIZED sin portalAccount", async () => {
    await expect(portalRouter.createCaller(pub(prisma)).auth.logout()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("portal.account.enableMfa", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    process.env.AUTH_SECRET = "test-secret-minimum-32-chars-xxxx";
    // Vault write mock (retorna bigint, valor ignorado por el router).
    prisma.$executeRaw.mockResolvedValue(1n);
  });

  it("genera QR server-side y secretForManualEntry (K-07)", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, email: EM, mfaEnabled: false });
    prisma.portalAccount.update.mockResolvedValue({});
    const r = await portalRouter.createCaller(pc(prisma)).account.enableMfa({});
    // K-07: el campo top-level `secret` fue eliminado; en su lugar tenemos:
    //   - qrDataUrl: PNG en base64 generado server-side
    //   - secretForManualEntry: base32 para ingreso manual en autenticadores
    expect(r.otpauthUri).toContain("otpauth://totp/");
    expect(r.secretForManualEntry).toHaveLength(32);
    expect(r.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    // secret plano NO debe existir como campo top-level
    expect((r as Record<string, unknown>).secret).toBeUndefined();
  });

  it("UNAUTHORIZED sin portalAccount", async () => {
    await expect(portalRouter.createCaller(pub(prisma)).account.enableMfa({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("NOT_FOUND si cuenta no existe", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue(null);
    await expect(portalRouter.createCaller(pc(prisma)).account.enableMfa({})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("portal.account.verifyMfa", () => {
  let prisma;
  beforeEach(() => {
    prisma = mockDeep();
    process.env.AUTH_SECRET = "test-secret-minimum-32-chars-xxxx";
    // Vault retorna null → activa fallback app-layer para tests legados.
    prisma.$queryRaw.mockResolvedValue([{ get_portal_mfa_secret: null }]);
  });

  it("PRECONDITION_FAILED sin mfaSecret", async () => {
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, mfaSecret: null });
    await expect(portalRouter.createCaller(pc(prisma)).account.verifyMfa({ code: "123456" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("activa mfaEnabled con codigo TOTP correcto", async () => {
    const { createHash, createCipheriv, createHmac, randomBytes: rb } = require("node:crypto");
    const key = createHash("sha256").update("portal-mfa:" + process.env.AUTH_SECRET, "utf8").digest();
    const ts = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PX";
    const iv = rb(12); const ci = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([ci.update(ts, "utf8"), ci.final()]); const tag = ci.getAuthTag();
    const enc = JSON.stringify({ v: 1, iv: iv.toString("hex"), tag: tag.toString("hex"), ct: ct.toString("hex") });
    const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const b32d = (s) => { const c = s.toUpperCase(); let b=0,v=0; const o=[]; for (const ch of c) { const i=B32.indexOf(ch); v=(v<<5)|i; b+=5; if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;} } return Buffer.from(o); };
    const ctr = Math.floor(Date.now()/1000/30); const kb = b32d(ts); const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(ctr/0x1_0000_0000),0); buf.writeUInt32BE(ctr&0xffffffff,4);
    const h = createHmac("sha1",kb).update(buf).digest(); const off = h[h.length-1]&0x0f;
    const bin = ((h[off]&0x7f)<<24)|((h[off+1]&0xff)<<16)|((h[off+2]&0xff)<<8)|(h[off+3]&0xff);
    const code = (bin%1000000).toString().padStart(6,"0");
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, mfaSecret: enc });
    prisma.portalAccount.update.mockResolvedValue({});
    expect(await portalRouter.createCaller(pc(prisma)).account.verifyMfa({ code })).toEqual({ enabled: true });
    expect(prisma.portalAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: { mfaEnabled: true } }));
  });

  it("UNAUTHORIZED con codigo incorrecto", async () => {
    const { createHash, createCipheriv, randomBytes: rb } = require("node:crypto");
    const key = createHash("sha256").update("portal-mfa:" + process.env.AUTH_SECRET, "utf8").digest();
    const ts = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PX"; const iv = rb(12);
    const ci = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([ci.update(ts, "utf8"), ci.final()]);
    const enc = JSON.stringify({ v: 1, iv: iv.toString("hex"), tag: ci.getAuthTag().toString("hex"), ct: ct.toString("hex") });
    prisma.portalAccount.findUnique.mockResolvedValue({ id: PA, mfaSecret: enc });
    await expect(portalRouter.createCaller(pc(prisma)).account.verifyMfa({ code: "000000" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("portal.guardian.list", () => {
  let prisma;
  beforeEach(() => { prisma = mockDeep(); });

  it("retorna wards activos del guardian", async () => {
    prisma.guardianRelationship.findMany.mockResolvedValue([{ id: "r1", guardianAccountId: PA, wardPatientId: WD, relationship: "PARENT", validUntil: null, status: "ACTIVE", createdAt: new Date(), wardPatient: { id: WD, firstName: "N", lastName: "P", birthDate: null } }]);
    const r = await portalRouter.createCaller(pc(prisma)).guardian.list();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ relationship: "PARENT", ward: expect.objectContaining({ id: WD }) });
  });

  it("filtra por guardianAccountId", async () => {
    prisma.guardianRelationship.findMany.mockResolvedValue([]);
    await portalRouter.createCaller(pc(prisma)).guardian.list();
    expect(prisma.guardianRelationship.findMany.mock.calls[0][0]?.where).toMatchObject({ guardianAccountId: PA, status: "ACTIVE" });
  });

  it("UNAUTHORIZED sin portalAccount", async () => {
    await expect(portalRouter.createCaller(pub(prisma)).guardian.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

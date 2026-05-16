/**
 * Tests del ledgerRouter (US-1.4 — multi-libro contable).
 *
 * Cubre:
 *   - list: filtra por org, kind, activeOnly; FORBIDDEN si no es ADMIN.
 *   - get: NOT_FOUND, happy-path con accountsCount=0.
 *   - create: happy-path, moneda inactiva, duplicado activo (CONFLICT),
 *     duplicado inactivo (BAD_REQUEST), FORBIDDEN sin ADMIN.
 *   - update: NOT_FOUND, moneda inactiva, happy-path.
 *   - activate / deactivate: idempotencia, NOT_FOUND.
 *   - listKinds: retorna 6 tipos con etiquetas es-SV.
 *   - roundingPolicy: stub MVP, NOT_FOUND, FORBIDDEN.
 *
 * Patrón: protectedProcedure → makeCtx con MOCK_USER_ADMIN.
 * assertAdminMembership mockeado vía prisma.userOrganizationRole.findFirst.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { ledgerRouter } from "../ledger.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN, MOCK_TENANT } from "@his/test-utils";

const orgId = MOCK_TENANT.organizationId;
const ledgerId = "00000000-0000-0000-0000-000000000001";
const currencyId = "00000000-0000-0000-0000-000000000002";

/** Membership ADMIN válida para assertAdminMembership. */
const adminMembership = {
  id: "00000000-0000-0000-0000-000000000010",
  userId: MOCK_USER_ADMIN.id,
  organizationId: orgId,
  roleId: "00000000-0000-0000-0000-000000000020",
  validFrom: new Date(Date.now() - 1000),
  validTo: null,
};

/** Currency activa para tests de create/update. */
const activeCurrency = { id: currencyId, isoCode: "USD", name: "Dólar", symbol: "$", active: true };

/** Ledger base de prueba. */
const baseLedger = {
  id: ledgerId,
  organizationId: orgId,
  kind: "FISCAL_LOCAL",
  code: "FISCAL_LOCAL",
  name: "Libro Fiscal",
  currencyId,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  currency: activeCurrency,
};

describe("ledgerRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  describe("list", () => {
    it("happy-path: devuelve libros de la org del tenant", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.ledger.findMany.mockResolvedValue([baseLedger] as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.list({});

      expect(result).toHaveLength(1);
      expect(result[0]!.organizationId).toBe(orgId);
    });

    it("FORBIDDEN si el usuario no es ADMIN en la org", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.ledger.findMany).not.toHaveBeenCalled();
    });

    it("BAD_REQUEST si no hay organizationId ni tenant", async () => {
      const caller = ledgerRouter.createCaller(makeCtx({ prisma, tenant: null }));
      await expect(caller.list({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("aplica filtro kind cuando se provee", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.ledger.findMany.mockResolvedValue([] as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ kind: "IFRS" });

      const args = prisma.ledger.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({ kind: "IFRS" });
    });

    it("aplica filtro activeOnly cuando es true", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.ledger.findMany.mockResolvedValue([] as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await caller.list({ activeOnly: true });

      const args = prisma.ledger.findMany.mock.calls[0]![0];
      expect(args.where).toMatchObject({ active: true });
    });
  });

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------

  describe("get", () => {
    it("NOT_FOUND si el libro no existe", async () => {
      prisma.ledger.findUnique.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: ledgerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("FORBIDDEN si el user no es ADMIN de la org del libro", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        ...baseLedger,
        organization: { id: orgId, legalName: "Org", tradeName: "Org" },
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.get({ id: ledgerId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("happy-path: retorna ledger con accountsCount=0", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        ...baseLedger,
        organization: { id: orgId, legalName: "Org", tradeName: "Org" },
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.get({ id: ledgerId });

      expect(result.id).toBe(ledgerId);
      expect(result.accountsCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe("create", () => {
    const createInput = {
      organizationId: orgId,
      kind: "IFRS" as const,
      name: "Libro NIIF",
      functionalCurrencyId: currencyId,
    };

    it("happy-path: crea libro nuevo con code=kind", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.currency.findUnique.mockResolvedValue(activeCurrency as never);
      prisma.ledger.findFirst.mockResolvedValue(null as never);
      prisma.ledger.create.mockResolvedValue({
        ...baseLedger,
        kind: "IFRS",
        code: "IFRS",
        name: "Libro NIIF",
      } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.create(createInput);

      expect(result.kind).toBe("IFRS");
      const createArgs = prisma.ledger.create.mock.calls[0]![0];
      expect(createArgs.data.code).toBe("IFRS");
    });

    it("FORBIDDEN si el user no es ADMIN", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(createInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("BAD_REQUEST si la moneda no existe", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.currency.findUnique.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(createInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("BAD_REQUEST si la moneda está inactiva", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.currency.findUnique.mockResolvedValue({ ...activeCurrency, active: false } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(createInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("CONFLICT si ya existe libro ACTIVO de ese tipo", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.currency.findUnique.mockResolvedValue(activeCurrency as never);
      prisma.ledger.findFirst.mockResolvedValue({ id: ledgerId, active: true } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(createInput)).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("BAD_REQUEST si existe libro INACTIVO de ese tipo (guía a reactivar)", async () => {
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.currency.findUnique.mockResolvedValue(activeCurrency as never);
      prisma.ledger.findFirst.mockResolvedValue({ id: ledgerId, active: false } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.create(createInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe("update", () => {
    it("NOT_FOUND si el libro no existe", async () => {
      prisma.ledger.findUnique.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: ledgerId, name: "Nuevo" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("FORBIDDEN si el user no es ADMIN", async () => {
      prisma.ledger.findUnique.mockResolvedValue({ id: ledgerId, organizationId: orgId } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.update({ id: ledgerId, name: "Nuevo nombre" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("BAD_REQUEST si nueva moneda está inactiva", async () => {
      prisma.ledger.findUnique.mockResolvedValue({ id: ledgerId, organizationId: orgId } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.currency.findUnique.mockResolvedValue({ active: false } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(
        caller.update({ id: ledgerId, functionalCurrencyId: currencyId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("happy-path: actualiza nombre sin cambiar moneda", async () => {
      prisma.ledger.findUnique.mockResolvedValue({ id: ledgerId, organizationId: orgId } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.ledger.update.mockResolvedValue({
        ...baseLedger,
        name: "Libro Actualizado",
      } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.update({ id: ledgerId, name: "Libro Actualizado" });

      expect(result.name).toBe("Libro Actualizado");
      // No debe haber buscado moneda (no se cambió)
      expect(prisma.currency.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // activate / deactivate
  // ---------------------------------------------------------------------------

  describe("activate", () => {
    it("NOT_FOUND si el libro no existe", async () => {
      prisma.ledger.findUnique.mockResolvedValue(null as never);
      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.activate({ id: ledgerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("idempotente: si ya está activo devuelve el libro sin update", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        id: ledgerId,
        organizationId: orgId,
        active: true,
        kind: "FISCAL_LOCAL",
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.activate({ id: ledgerId });

      expect(result.active).toBe(true);
      expect(prisma.ledger.update).not.toHaveBeenCalled();
    });

    it("activa un libro inactivo", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        id: ledgerId,
        organizationId: orgId,
        active: false,
        kind: "IFRS",
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.ledger.update.mockResolvedValue({ ...baseLedger, active: true } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.activate({ id: ledgerId });

      expect(prisma.ledger.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: true } }),
      );
      expect(result.active).toBe(true);
    });
  });

  describe("deactivate", () => {
    it("NOT_FOUND si el libro no existe", async () => {
      prisma.ledger.findUnique.mockResolvedValue(null as never);
      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.deactivate({ id: ledgerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("idempotente: si ya está inactivo devuelve el libro sin update", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        id: ledgerId,
        organizationId: orgId,
        active: false,
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await caller.deactivate({ id: ledgerId });

      expect(prisma.ledger.update).not.toHaveBeenCalled();
    });

    it("desactiva un libro activo", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        id: ledgerId,
        organizationId: orgId,
        active: true,
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);
      prisma.ledger.update.mockResolvedValue({ ...baseLedger, active: false } as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.deactivate({ id: ledgerId });

      expect(prisma.ledger.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: false } }),
      );
      expect(result.active).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // listKinds
  // ---------------------------------------------------------------------------

  describe("listKinds", () => {
    it("retorna los 6 tipos de libro con etiquetas es-SV", async () => {
      prisma.ledger.findMany.mockResolvedValue([] as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listKinds({});

      expect(result).toHaveLength(6);
      const kinds = result.map((k) => k.kind);
      expect(kinds).toContain("FISCAL_LOCAL");
      expect(kinds).toContain("IFRS");
      expect(kinds).toContain("US_GAAP");
      expect(kinds).toContain("MANAGEMENT");
      expect(kinds).toContain("BUDGET");
      expect(kinds).toContain("STATISTICAL");

      // Todos tienen label y description
      for (const k of result) {
        expect(k.label.length).toBeGreaterThan(0);
        expect(k.description.length).toBeGreaterThan(0);
      }
    });

    it("marca alreadyActive=true para kind que ya existe activo en la org", async () => {
      prisma.ledger.findMany.mockResolvedValue([
        { kind: "FISCAL_LOCAL", active: true },
        { kind: "IFRS", active: false },
      ] as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.listKinds({ organizationId: orgId });

      const fiscal = result.find((k) => k.kind === "FISCAL_LOCAL")!;
      const ifrs = result.find((k) => k.kind === "IFRS")!;

      expect(fiscal.alreadyActive).toBe(true);
      expect(ifrs.alreadyActive).toBe(false);
      expect(ifrs.existsInactive).toBe(true);
    });

    it("sin organizationId no busca libros existentes", async () => {
      const caller = ledgerRouter.createCaller(makeCtx({ prisma, tenant: null }));
      const result = await caller.listKinds({});

      expect(prisma.ledger.findMany).not.toHaveBeenCalled();
      expect(result).toHaveLength(6);
    });
  });

  // ---------------------------------------------------------------------------
  // roundingPolicy
  // ---------------------------------------------------------------------------

  describe("roundingPolicy", () => {
    it("NOT_FOUND si el libro no existe", async () => {
      prisma.ledger.findUnique.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.roundingPolicy({ ledgerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("FORBIDDEN si el user no es ADMIN", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        id: ledgerId,
        organizationId: orgId,
        currencyId,
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(null as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      await expect(caller.roundingPolicy({ ledgerId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("stub MVP: retorna decimals=2, mode=HALF_EVEN, isStub=true", async () => {
      prisma.ledger.findUnique.mockResolvedValue({
        id: ledgerId,
        organizationId: orgId,
        currencyId,
      } as never);
      prisma.userOrganizationRole.findFirst.mockResolvedValue(adminMembership as never);

      const caller = ledgerRouter.createCaller(makeCtx({ prisma }));
      const result = await caller.roundingPolicy({ ledgerId });

      expect(result.decimals).toBe(2);
      expect(result.mode).toBe("HALF_EVEN");
      expect(result.isStub).toBe(true);
      expect(result.ledgerId).toBe(ledgerId);
    });
  });
});

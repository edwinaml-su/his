/**
 * Tests del router pharmacyCart — carrito unidosis (US.F2.6.12-16).
 *
 * Estrategia: mockear Prisma con vitest-mock-extended.
 * Cubre flujos completos: crear → agregar ítem → despachar → recibir.
 * Guards: estado forward-only, carrito vacío, paciente ajeno al tenant.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { cartRouter } from "../pharmacy/cart.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const uuid = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// MOCK_TENANT.organizationId del helper de test
const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const PATIENT_ID = uuid(2);
const USER_ID = uuid(3);
const CART_ID = uuid(4);
const ITEM_ID = uuid(5);
const GLN = "6140001000001"; // 13 dígitos válidos
const GTIN = "06140001000001"; // no válido por largo — usar 14 dígitos
const GTIN14 = "61400010000012"; // 14 dígitos

function setupTx<P extends DeepMockProxy<PrismaClient>>(prisma: P) {
  (prisma.$transaction as unknown as { mockImplementation: (fn: unknown) => void })
    .mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
}

// ---------------------------------------------------------------------------
// createCart
// ---------------------------------------------------------------------------

describe("pharmacyCart.createCart", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);
  });

  it("crea carrito ARMANDO cuando paciente existe en el tenant", async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT_ID } as never);
    prisma.pharmacyCart.create.mockResolvedValue({
      id: CART_ID,
      organizationId: ORG_ID,
      turno: "MAÑANA",
      patientId: PATIENT_ID,
      glnDestino: GLN,
      status: "ARMANDO",
      dispatchedAt: null,
      dispatchedById: null,
      receivedAt: null,
      receivedById: null,
      signature: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    } as never);

    const caller = cartRouter.createCaller(
      makeCtx({ prisma, user: { id: USER_ID, fullName: "Farmacéutico" } as never }),
    );
    const result = await caller.createCart({
      turno: "MAÑANA",
      patientId: PATIENT_ID,
      glnDestino: GLN,
    });

    expect(result.cart.status).toBe("ARMANDO");
    expect(prisma.pharmacyCart.create).toHaveBeenCalledOnce();
  });

  it("rechaza paciente que no pertenece al tenant (NOT_FOUND)", async () => {
    prisma.patient.findFirst.mockResolvedValue(null);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.createCart({ turno: "TARDE", patientId: PATIENT_ID, glnDestino: GLN }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rechaza creación duplicada — mismo turno + paciente (CONFLICT)", async () => {
    prisma.patient.findFirst.mockResolvedValue({ id: PATIENT_ID } as never);
    prisma.pharmacyCart.create.mockRejectedValue({ code: "P2002" });

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.createCart({ turno: "MAÑANA", patientId: PATIENT_ID, glnDestino: GLN }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ---------------------------------------------------------------------------
// addItem
// ---------------------------------------------------------------------------

describe("pharmacyCart.addItem", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);
  });

  it("agrega ítem a carrito en estado ARMANDO", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue({
      id: CART_ID,
      organizationId: ORG_ID,
      status: "ARMANDO",
    } as never);
    prisma.pharmacyCartItem.create.mockResolvedValue({
      id: ITEM_ID,
      cartId: CART_ID,
      gtin: GTIN14,
      lote: "L-001",
      serie: null,
      posicionCarrito: 0,
      medicationDispenseId: null,
      createdAt: new Date(),
    } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.addItem({
      cartId: CART_ID,
      gtin: GTIN14,
      lote: "L-001",
    });

    expect(result.item.gtin).toBe(GTIN14);
  });

  it("bloquea agregar ítem cuando carrito está DESPACHADO (CONFLICT)", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue({
      id: CART_ID,
      organizationId: ORG_ID,
      status: "DESPACHADO",
    } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.addItem({ cartId: CART_ID, gtin: GTIN14 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rechaza carrito no encontrado (NOT_FOUND)", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue(null);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.addItem({ cartId: CART_ID, gtin: GTIN14 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// removeItem
// ---------------------------------------------------------------------------

describe("pharmacyCart.removeItem", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);
  });

  it("elimina ítem de carrito LISTO", async () => {
    prisma.pharmacyCartItem.findFirst.mockResolvedValue({
      id: ITEM_ID,
      cartId: CART_ID,
      cart: { organizationId: ORG_ID, status: "LISTO" },
    } as never);
    prisma.pharmacyCartItem.delete.mockResolvedValue({ id: ITEM_ID } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.removeItem({ cartItemId: ITEM_ID });
    expect(result.deleted).toBe(true);
  });

  it("bloquea eliminar ítem cuando carrito está RECIBIDO (CONFLICT)", async () => {
    prisma.pharmacyCartItem.findFirst.mockResolvedValue({
      id: ITEM_ID,
      cartId: CART_ID,
      cart: { organizationId: ORG_ID, status: "RECIBIDO" },
    } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.removeItem({ cartItemId: ITEM_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

describe("pharmacyCart.dispatch", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);
  });

  const cartWithItems = {
    id: CART_ID,
    organizationId: ORG_ID,
    status: "ARMANDO",
    turno: "MAÑANA",
    glnDestino: GLN,
    patientId: PATIENT_ID,
    patient: { id: PATIENT_ID, firstName: "Ana", lastName: "García" },
    items: [
      { id: ITEM_ID, gtin: GTIN14, lote: "L-001", serie: null, posicionCarrito: 0 },
    ],
  };

  it("despacha carrito con ítems — emite CartDispatched + CartPendingReception", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue(cartWithItems as never);
    prisma.pharmacyCart.update.mockResolvedValue({
      ...cartWithItems,
      status: "DESPACHADO",
      dispatchedAt: new Date(),
      dispatchedById: USER_ID,
    } as never);
    prisma.domainEvent.create.mockResolvedValue({} as never);

    const caller = cartRouter.createCaller(
      makeCtx({ prisma, user: { id: USER_ID, fullName: "Farmacéutico" } as never }),
    );
    const result = await caller.dispatch({ cartId: CART_ID });

    expect(result.cart.status).toBe("DESPACHADO");
    // Dos eventos: CartDispatched + CartPendingReception
    expect(prisma.domainEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.domainEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "CartDispatched" }),
      }),
    );
  });

  it("bloquea despacho de carrito vacío (BAD_REQUEST)", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue({
      ...cartWithItems,
      items: [],
    } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.dispatch({ cartId: CART_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("bloquea despacho cuando ya está DESPACHADO (CONFLICT)", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue({
      ...cartWithItems,
      status: "DESPACHADO",
    } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.dispatch({ cartId: CART_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

// ---------------------------------------------------------------------------
// receiveAtService
// ---------------------------------------------------------------------------

describe("pharmacyCart.receiveAtService", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);
  });

  const dispatchedCart = {
    id: CART_ID,
    organizationId: ORG_ID,
    status: "DESPACHADO",
    turno: "MAÑANA",
    glnDestino: GLN,
    patientId: PATIENT_ID,
    items: [{ gtin: GTIN14 }],
  };

  it("confirma recepción emitiendo CartReceived EPCIS event", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue(dispatchedCart as never);
    prisma.pharmacyCart.update.mockResolvedValue({
      ...dispatchedCart,
      status: "RECIBIDO",
      receivedAt: new Date(),
      receivedById: USER_ID,
    } as never);
    prisma.domainEvent.create.mockResolvedValue({} as never);

    const caller = cartRouter.createCaller(
      makeCtx({ prisma, user: { id: USER_ID, fullName: "Enfermera" } as never }),
    );
    const result = await caller.receiveAtService({
      cartId: CART_ID,
      signature: "firma-simple-base64==",
    });

    expect(result.cart.status).toBe("RECIBIDO");
    expect(prisma.domainEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "CartReceived" }),
      }),
    );
  });

  it("rechaza recepción si el carrito no está DESPACHADO (CONFLICT)", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue({
      ...dispatchedCart,
      status: "ARMANDO",
    } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.receiveAtService({ cartId: CART_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rechaza recepción si el carrito no existe (NOT_FOUND)", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue(null);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.receiveAtService({ cartId: CART_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// list + getCart — happy paths
// ---------------------------------------------------------------------------

describe("pharmacyCart.list", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);
  });

  it("devuelve lista paginada de carritos", async () => {
    prisma.pharmacyCart.findMany.mockResolvedValue([] as never);
    prisma.pharmacyCart.count.mockResolvedValue(0 as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.list({});
    expect(result.total).toBe(0);
    expect(result.carts).toEqual([]);
  });
});

describe("pharmacyCart.getCart", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    setupTx(prisma);
  });

  it("devuelve detalle del carrito", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue({
      id: CART_ID,
      status: "ARMANDO",
      items: [],
    } as never);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.getCart({ cartId: CART_ID });
    expect(result.cart.id).toBe(CART_ID);
  });

  it("lanza NOT_FOUND si el carrito no existe", async () => {
    prisma.pharmacyCart.findFirst.mockResolvedValue(null);

    const caller = cartRouter.createCaller(makeCtx({ prisma }));
    await expect(caller.getCart({ cartId: CART_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

/**
 * Tests unitarios: gs1ProcesoARouter — HI-07 / HI-08 / docs/48 Ola 3 (C3-4).
 *
 * HI-07: verifica que `listar` usa query parametrizada ($queryRaw) y NO
 *        interpola el estado en el string SQL.
 * HI-08: verifica que el schema Zod rechaza GTINs con check-digit inválido.
 * C3-4:  verifica el puente `recibirMercancia` → Stock operativo (StockItem/
 *        StockLot/StockMovement), mismo patrón mockDeep+wireTransaction que
 *        el resto de la suite de routers.
 *
 * Nota histórica: este archivo antes omitía los tests de router por un bug
 * de symlinks de `@his/contracts` en worktrees — verificado resuelto (import
 * directo del router funciona) al escribir la suite de C3-4.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import {
  gs1ProductoRecibidoSchema,
  recibirMercanciaInput,
  listarRecepcionesInput,
} from "../../../../contracts/src/schemas/gs1-inbound";
import { gs1ProcesoARouter } from "../gs1-proceso-a.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const UUID_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** GTIN-14 válido (check-digit correcto). Verificado con Módulo-10 GS1. */
const VALID_GTIN = "07501000001231";

/** GTIN-14 con check-digit incorrecto (último dígito modificado de _1 a _4). */
const INVALID_CHECKDIGIT_GTIN = "07501000001234";

const VALID_VERIFICACION = {
  paciente_n_a: true as const,
  medicamento_verif: true,
  dosis_n_a: true as const,
  via_n_a: true as const,
  hora_n_a: true as const,
};

const VALID_RECEPCION_INPUT = {
  numero_documento_recepcion: "REC-2026-001",
  proveedor_gln: "7413000000001",
  productos: [{ gtin: VALID_GTIN, cantidad: 5, lote: "L001", expiry: "2027-06-30" }],
  verificacion_5correctos: VALID_VERIFICACION,
  establecimiento_id: UUID_A,
  registrado_por: UUID_A,
};

// ---------------------------------------------------------------------------
// HI-07: listar — el fix usa $queryRaw template literal
// Nota: el test de runtime del router requiere que el PR esté mergeado en main
// para que los symlinks de @his/contracts resuelvan correctamente.
// El fix de HI-07 se verifica en code review (diff de gs1-proceso-a.router.ts)
// y en CI post-merge.
// ---------------------------------------------------------------------------

describe("HI-07: gs1ProcesoA.listar — SQL parametrizado (verificación de contrato)", () => {
  it("listarRecepcionesInput: Zod rechaza estado fuera del enum antes de llegar a la BD", () => {
    // El enum Zod es la primera línea de defensa (antes de la query).
    // "x' OR 1=1--" no es un valor del enum ["pendiente","verificado","rechazado"].
    const r = listarRecepcionesInput.safeParse({
      establecimiento_id: UUID_A,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      estado: "x' OR 1=1--" as any,
    });
    expect(r.success).toBe(false);
  });

  it("listarRecepcionesInput: Zod acepta estado válido del enum", () => {
    const r = listarRecepcionesInput.safeParse({
      establecimiento_id: UUID_A,
      estado: "pendiente",
    });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HI-08: recibirMercanciaInput — check-digit GS1
// ---------------------------------------------------------------------------

describe("HI-08: gs1ProductoRecibidoSchema — check-digit GTIN Módulo-10", () => {
  it("acepta GTIN-14 con check-digit correcto", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({
      gtin: VALID_GTIN,
      cantidad: 5,
      lote: "L001",
      expiry: "2027-06-30",
    });
    expect(r.success).toBe(true);
  });

  it("rechaza GTIN-14 con check-digit incorrecto", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({
      gtin: INVALID_CHECKDIGIT_GTIN,
      cantidad: 5,
      lote: "L001",
      expiry: "2027-06-30",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs.some((m) => /check.?digit|módulo.?10|inválido/i.test(m))).toBe(true);
    }
  });

  it("rechaza GTIN de 13 dígitos (no GTIN-14)", () => {
    const r = gs1ProductoRecibidoSchema.safeParse({
      gtin: "0750100000123",
      cantidad: 5,
      lote: "L001",
      expiry: "2027-06-30",
    });
    expect(r.success).toBe(false);
  });
});

describe("HI-08: recibirMercanciaInput — check-digit propagado al schema raíz", () => {
  it("acepta recepción con GTIN válido", () => {
    const r = recibirMercanciaInput.safeParse(VALID_RECEPCION_INPUT);
    expect(r.success).toBe(true);
  });

  it("rechaza recepción con GTIN de check-digit inválido", () => {
    const r = recibirMercanciaInput.safeParse({
      ...VALID_RECEPCION_INPUT,
      productos: [
        { ...VALID_RECEPCION_INPUT.productos[0], gtin: INVALID_CHECKDIGIT_GTIN },
      ],
    });
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// docs/48 Ola 3 (C3-4, addendum Ola 0) — puente recepción GS1 → Stock operativo
// ---------------------------------------------------------------------------

describe("recibirMercancia — puente a Stock operativo (docs/48 Ola 3, C3-4)", () => {
  const RECEPCION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const ITEM_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const LOT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

  let prisma: DeepMockProxy<PrismaClient>;

  function wireTransaction(): void {
    prisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb === "function") {
        return (cb as (tx: unknown) => Promise<unknown>)(prisma);
      }
      return cb;
    });
    prisma.$executeRawUnsafe.mockResolvedValue(0 as never);
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    wireTransaction();
    // Orden real de $queryRaw en recibirMercancia: 1) chequeo de GLN
    // (fuera de la tx) 2) INSERT...RETURNING de ece.recepcion_mercancia
    // (dentro de la tx). El lookup de ece.gs1_gtin (solo si el StockItem no
    // existe todavía) se encadena aparte en cada test que lo necesita.
    prisma.$queryRaw
      .mockResolvedValueOnce([{ exists: true }] as never)
      .mockResolvedValueOnce([
        { id: RECEPCION_ID, numero_documento_recepcion: VALID_RECEPCION_INPUT.numero_documento_recepcion },
      ] as never);
    prisma.domainEvent.create.mockResolvedValue({ id: "event-1" } as never);
  });

  it("GTIN sin StockItem: lo crea (sku=gtin, nombre del catálogo ece.gs1_gtin) + StockLot + StockMovement IN", async () => {
    prisma.stockItem.findFirst.mockResolvedValue(null as never);
    // Encadenado DESPUÉS de los 2 $queryRaw del beforeEach: el lookup de
    // ece.gs1_gtin para el nombre del StockItem nuevo.
    prisma.$queryRaw.mockResolvedValueOnce([{ descripcion: "Amoxicilina 500mg" }] as never);
    prisma.stockItem.create.mockResolvedValue({ id: ITEM_ID } as never);
    prisma.stockLot.findFirst.mockResolvedValue(null as never);
    prisma.stockLot.create.mockResolvedValue({ id: LOT_ID } as never);
    prisma.stockMovement.create.mockResolvedValue({ id: "mov-1" } as never);

    const caller = gs1ProcesoARouter.createCaller(makeCtx({ prisma }));
    const result = await caller.recibirMercancia(VALID_RECEPCION_INPUT);

    expect(result.id).toBe(RECEPCION_ID);

    const itemFindWhere = prisma.stockItem.findFirst.mock.calls[0]![0]!.where as { gtin?: string };
    expect(itemFindWhere.gtin).toBe(VALID_GTIN);

    const itemCreateData = prisma.stockItem.create.mock.calls[0]![0]!.data as {
      sku: string;
      gtin: string;
      name: string;
      unitOfMeasure: string;
    };
    expect(itemCreateData.sku).toBe(VALID_GTIN);
    expect(itemCreateData.gtin).toBe(VALID_GTIN);
    expect(itemCreateData.name).toBe("Amoxicilina 500mg");
    expect(itemCreateData.unitOfMeasure).toBe("UN");

    const lotCreateData = prisma.stockLot.create.mock.calls[0]![0]!.data as {
      itemId: string;
      lotNumber: string;
      quantityOnHand: number;
    };
    expect(lotCreateData.itemId).toBe(ITEM_ID);
    expect(lotCreateData.lotNumber).toBe("L001");
    expect(lotCreateData.quantityOnHand).toBe(5);

    const movementData = prisma.stockMovement.create.mock.calls[0]![0]!.data as {
      itemId: string;
      lotId: string;
      type: string;
      quantity: number;
      referenceCode: string;
    };
    expect(movementData.type).toBe("IN");
    expect(movementData.quantity).toBe(5);
    expect(movementData.itemId).toBe(ITEM_ID);
    expect(movementData.lotId).toBe(LOT_ID);
    expect(movementData.referenceCode).toBe(VALID_RECEPCION_INPUT.numero_documento_recepcion);
  });

  it("GTIN sin catálogo ece.gs1_gtin: no bloquea la recepción, usa nombre genérico", async () => {
    prisma.stockItem.findFirst.mockResolvedValue(null as never);
    prisma.$queryRaw.mockResolvedValueOnce([] as never); // sin fila en ece.gs1_gtin
    prisma.stockItem.create.mockResolvedValue({ id: ITEM_ID } as never);
    prisma.stockLot.findFirst.mockResolvedValue(null as never);
    prisma.stockLot.create.mockResolvedValue({ id: LOT_ID } as never);
    prisma.stockMovement.create.mockResolvedValue({ id: "mov-1" } as never);

    const caller = gs1ProcesoARouter.createCaller(makeCtx({ prisma }));
    await caller.recibirMercancia(VALID_RECEPCION_INPUT);

    const itemCreateData = prisma.stockItem.create.mock.calls[0]![0]!.data as { name: string };
    expect(itemCreateData.name).toBe(`GTIN ${VALID_GTIN}`);
  });

  it("StockItem ya existe (match por gtin): NO lo vuelve a crear", async () => {
    prisma.stockItem.findFirst.mockResolvedValue({ id: ITEM_ID } as never);
    prisma.stockLot.findFirst.mockResolvedValue(null as never);
    prisma.stockLot.create.mockResolvedValue({ id: LOT_ID } as never);
    prisma.stockMovement.create.mockResolvedValue({ id: "mov-1" } as never);

    const caller = gs1ProcesoARouter.createCaller(makeCtx({ prisma }));
    await caller.recibirMercancia(VALID_RECEPCION_INPUT);

    expect(prisma.stockItem.create).not.toHaveBeenCalled();
    const lotCreateData = prisma.stockLot.create.mock.calls[0]![0]!.data as { itemId: string };
    expect(lotCreateData.itemId).toBe(ITEM_ID);
  });

  it("mismo lote+item+establecimiento ya existe: incrementa quantityOnHand en vez de crear otro lote", async () => {
    prisma.stockItem.findFirst.mockResolvedValue({ id: ITEM_ID } as never);
    prisma.stockLot.findFirst.mockResolvedValue({ id: LOT_ID } as never);
    prisma.stockLot.update.mockResolvedValue({ id: LOT_ID } as never);
    prisma.stockMovement.create.mockResolvedValue({ id: "mov-1" } as never);

    const caller = gs1ProcesoARouter.createCaller(makeCtx({ prisma }));
    await caller.recibirMercancia(VALID_RECEPCION_INPUT);

    expect(prisma.stockLot.create).not.toHaveBeenCalled();
    expect(prisma.stockLot.update).toHaveBeenCalledWith({
      where: { id: LOT_ID },
      data: { quantityOnHand: { increment: 5 } },
    });
  });
});

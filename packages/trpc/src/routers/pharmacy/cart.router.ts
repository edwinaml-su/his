/**
 * Router tRPC: Carrito Unidosis — US.F2.6.12-16
 *
 * Farmacéutico arma un carrito virtual por turno+paciente, lo despacha al
 * GLN destino (servicio hospitalización) y enfermería confirma recepción.
 *
 * Flujo de estados (solo avance): ARMANDO → LISTO → DESPACHADO → RECIBIDO.
 * Cualquier intento de retroceder el estado lanza CONFLICT (409).
 *
 * Eventos EPCIS emitidos via outbox (DomainEvent):
 *   CartDispatched  — ObjectEvent DELETED del GLN origen + ADDED al GLN destino
 *   CartReceived    — ObjectEvent READ en el GLN destino
 *
 * Notificación outbox a enfermería del servicio destino al despachar.
 *
 * Seguridad:
 *   Lectura:            tenantProcedure
 *   Escritura farmacia: requireRole(["PHARM","ADMIN"])
 *   Recepción enf.:     requireRole(["NURSE","ADMIN"])
 *
 * withTenantContext obligatorio en todas las mutaciones.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../../trpc";
import { withTenantContext } from "../../rls-context";

// ---------------------------------------------------------------------------
// Schemas de entrada
// ---------------------------------------------------------------------------

const VALID_TURNOS = ["MAÑANA", "TARDE", "NOCHE"] as const;

const createCartInput = z.object({
  turno: z.enum(VALID_TURNOS),
  patientId: z.string().uuid(),
  glnDestino: z
    .string()
    .length(13)
    .regex(/^\d{13}$/, "GLN debe ser 13 dígitos numéricos"),
});

const addItemInput = z.object({
  cartId: z.string().uuid(),
  medicationDispenseId: z.string().uuid().optional(),
  gtin: z.string().length(14).regex(/^\d{14}$/, "GTIN-14 inválido"),
  lote: z.string().max(80).optional(),
  serie: z.string().max(80).optional(),
  posicionCarrito: z.number().int().min(0).default(0),
});

const removeItemInput = z.object({
  cartItemId: z.string().uuid(),
});

const dispatchInput = z.object({
  cartId: z.string().uuid(),
});

const receiveInput = z.object({
  cartId: z.string().uuid(),
  signature: z.string().max(2000).optional(),
});

const listCartsInput = z.object({
  turno: z.enum(VALID_TURNOS).optional(),
  status: z
    .enum(["ARMANDO", "LISTO", "DESPACHADO", "RECIBIDO"])
    .optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

// ---------------------------------------------------------------------------
// Estado permitido para modificar ítems
// ---------------------------------------------------------------------------

type CartOperation = "addItem" | "removeItem" | "dispatch";

function assertCartEditable(status: string, operation: CartOperation): void {
  if (operation === "addItem" || operation === "removeItem") {
    if (status !== "ARMANDO" && status !== "LISTO") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `No se pueden modificar ítems: el carrito está en estado ${status}`,
      });
    }
  }
  if (operation === "dispatch") {
    if (status !== "ARMANDO" && status !== "LISTO") {
      throw new TRPCError({
        code: "CONFLICT",
        message: `No se puede despachar: el carrito está en estado ${status}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const cartRouter = router({
  /** Crea un carrito ARMANDO para el turno+paciente. Un único carrito por combinación. */
  createCart: requireRole(["PHARM", "ADMIN"])
    .input(createCartInput)
    .mutation(async ({ ctx, input }) => {
      const { turno, patientId, glnDestino } = input;
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const patient = await tx.patient.findFirst({
          where: { id: patientId, organizationId: orgId },
          select: { id: true },
        });
        if (!patient) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Paciente no encontrado en la organización",
          });
        }

        try {
          const cart = await tx.pharmacyCart.create({
            data: {
              organizationId: orgId,
              turno,
              patientId,
              glnDestino,
              status: "ARMANDO",
            },
            include: { items: true },
          });
          return { cart };
        } catch (err: unknown) {
          const e = err as { code?: string };
          if (e.code === "P2002") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Ya existe un carrito para el turno ${turno} y este paciente`,
            });
          }
          throw err;
        }
      });
    }),

  /** Agrega un ítem al carrito (solo en estado ARMANDO o LISTO). */
  addItem: requireRole(["PHARM", "ADMIN"])
    .input(addItemInput)
    .mutation(async ({ ctx, input }) => {
      const { cartId, medicationDispenseId, gtin, lote, serie, posicionCarrito } = input;
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const cart = await tx.pharmacyCart.findFirst({
          where: { id: cartId, organizationId: orgId },
          select: { id: true, status: true },
        });
        if (!cart) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Carrito no encontrado" });
        }
        assertCartEditable(cart.status, "addItem");

        const item = await tx.pharmacyCartItem.create({
          data: {
            cartId,
            medicationDispenseId: medicationDispenseId ?? null,
            gtin,
            lote: lote ?? null,
            serie: serie ?? null,
            posicionCarrito,
          },
        });
        return { item };
      });
    }),

  /** Quita un ítem del carrito (solo en estado ARMANDO o LISTO). */
  removeItem: requireRole(["PHARM", "ADMIN"])
    .input(removeItemInput)
    .mutation(async ({ ctx, input }) => {
      const { cartItemId } = input;
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const item = await tx.pharmacyCartItem.findFirst({
          where: { id: cartItemId },
          include: {
            cart: { select: { organizationId: true, status: true } },
          },
        });
        if (!item || item.cart.organizationId !== orgId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Ítem no encontrado" });
        }
        assertCartEditable(item.cart.status, "removeItem");

        await tx.pharmacyCartItem.delete({ where: { id: cartItemId } });
        return { deleted: true };
      });
    }),

  /**
   * Despacha el carrito al GLN destino.
   *   - Status → DESPACHADO
   *   - EpcisEvent ObjectEvent (OBSERVE/shipping) via outbox — INMUTABLE
   *   - Notificación CartPendingReception para enfermería via outbox
   */
  dispatch: requireRole(["PHARM", "ADMIN"])
    .input(dispatchInput)
    .mutation(async ({ ctx, input }) => {
      const { cartId } = input;
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const cart = await tx.pharmacyCart.findFirst({
          where: { id: cartId, organizationId: orgId },
          include: {
            items: true,
            patient: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        if (!cart) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Carrito no encontrado" });
        }
        assertCartEditable(cart.status, "dispatch");
        if (cart.items.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El carrito no tiene ítems. Agrega al menos un ítem antes de despachar.",
          });
        }

        const now = new Date();
        const updated = await tx.pharmacyCart.update({
          where: { id: cartId },
          data: { status: "DESPACHADO", dispatchedAt: now, dispatchedById: userId },
          include: { items: true },
        });

        // EpcisEvent via outbox — inmutable por diseño (DomainEvent.CREATE only)
        await tx.domainEvent.create({
          data: {
            organizationId: orgId,
            eventType: "CartDispatched",
            aggregateType: "PharmacyCart",
            aggregateId: cartId,
            emittedById: userId,
            payload: {
              epcisEventType: "ObjectEvent",
              action: "OBSERVE",
              bizStep: "urn:epcglobal:cbv:bizstep:shipping",
              disposition: "urn:epcglobal:cbv:disp:in_transit",
              eventTime: now.toISOString(),
              glnDestino: cart.glnDestino,
              cartId,
              turno: cart.turno,
              patientId: cart.patientId,
              patientName: `${cart.patient.firstName} ${cart.patient.lastName}`,
              itemCount: cart.items.length,
              gtins: cart.items.map((i) => i.gtin),
            },
          },
        });

        // Notificación a enfermería del servicio destino
        await tx.domainEvent.create({
          data: {
            organizationId: orgId,
            eventType: "CartPendingReception",
            aggregateType: "PharmacyCart",
            aggregateId: cartId,
            emittedById: userId,
            payload: {
              cartId,
              turno: cart.turno,
              patientId: cart.patientId,
              glnDestino: cart.glnDestino,
              dispatchedAt: now.toISOString(),
            },
          },
        });

        return { cart: updated };
      });
    }),

  /**
   * Enfermería confirma recepción del carrito (solo desde DESPACHADO → RECIBIDO).
   *   - EpcisEvent ObjectEvent (OBSERVE/receiving) via outbox — INMUTABLE
   */
  receiveAtService: requireRole(["NURSE", "ADMIN"])
    .input(receiveInput)
    .mutation(async ({ ctx, input }) => {
      const { cartId, signature } = input;
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const cart = await tx.pharmacyCart.findFirst({
          where: { id: cartId, organizationId: orgId },
          select: {
            id: true,
            status: true,
            glnDestino: true,
            turno: true,
            patientId: true,
            items: { select: { gtin: true } },
          },
        });
        if (!cart) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Carrito no encontrado" });
        }
        if (cart.status !== "DESPACHADO") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se puede recibir un carrito en estado DESPACHADO. Estado actual: ${cart.status}`,
          });
        }

        const now = new Date();
        const updated = await tx.pharmacyCart.update({
          where: { id: cartId },
          data: {
            status: "RECIBIDO",
            receivedAt: now,
            receivedById: userId,
            signature: signature ?? null,
          },
        });

        // EPCIS READ event — inmutable
        await tx.domainEvent.create({
          data: {
            organizationId: orgId,
            eventType: "CartReceived",
            aggregateType: "PharmacyCart",
            aggregateId: cartId,
            emittedById: userId,
            payload: {
              epcisEventType: "ObjectEvent",
              action: "OBSERVE",
              bizStep: "urn:epcglobal:cbv:bizstep:receiving",
              disposition: "urn:epcglobal:cbv:disp:in_progress",
              eventTime: now.toISOString(),
              glnDestino: cart.glnDestino,
              cartId,
              turno: cart.turno,
              patientId: cart.patientId,
              signed: !!signature,
              gtins: cart.items.map((i) => i.gtin),
            },
          },
        });

        return { cart: updated };
      });
    }),

  /** Lista carritos del tenant con filtros opcionales. */
  list: tenantProcedure.input(listCartsInput).query(async ({ ctx, input }) => {
    const orgId = ctx.tenant.organizationId;
    const { turno, status, limit, offset } = input;

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const where = {
        organizationId: orgId,
        ...(turno !== undefined ? { turno } : {}),
        ...(status !== undefined
          ? { status: status as "ARMANDO" | "LISTO" | "DESPACHADO" | "RECIBIDO" }
          : {}),
      };

      const [carts, total] = await Promise.all([
        tx.pharmacyCart.findMany({
          where,
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            items: { orderBy: { posicionCarrito: "asc" } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        tx.pharmacyCart.count({ where }),
      ]);

      return { carts, total };
    });
  }),

  /** Detalle completo de un carrito. */
  getCart: tenantProcedure
    .input(z.object({ cartId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const cart = await tx.pharmacyCart.findFirst({
          where: { id: input.cartId, organizationId: orgId },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, mrn: true },
            },
            items: { orderBy: { posicionCarrito: "asc" } },
            dispatchedBy: { select: { id: true, fullName: true } },
            receivedBy: { select: { id: true, fullName: true } },
          },
        });
        if (!cart) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Carrito no encontrado" });
        }
        return { cart };
      });
    }),
});

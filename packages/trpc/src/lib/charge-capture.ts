/**
 * docs/48 Ola 2 (C2-1) — Servicio único de captura de cargo (RN-HIS-BOT-001 H-01).
 *
 * `capturarCargo` es una función de LIBRERÍA (no un procedure tRPC): se llama
 * DENTRO de la transacción del acto clínico que la origina (dispensación,
 * orden de laboratorio, imagen, etc.), usando el mismo `tx` — así el cargo y
 * el efecto clínico (descuento de inventario, creación de la orden...) viven
 * en una sola transacción atómica (RN R5).
 *
 * Contrato:
 *   1. Resuelve la cuenta ACTIVA del paciente (ABIERTA | PENDIENTE_REGULARIZAR).
 *      Sin cuenta activa → PRECONDITION_FAILED (nunca crea una cuenta implícita:
 *      la excepción de emergencia se resuelve al ABRIR la cuenta con
 *      `emergenciaSinPagador`, ya existente desde Ola 1).
 *   2. Llama a `resolverPrecio` (price-resolver.ts) server-side — el precio
 *      SIEMPRE se resuelve en el servidor, nunca se confía al caller.
 *   3. Precio resuelto → crea la línea `VIGENTE` con el precio congelado
 *      (priceListId/priceRuleId/resolvedAt/priceSource).
 *   4. Precio NO resoluble → crea la línea igual, con `unitPrice = NULL` y
 *      `status = PENDIENTE_TARIFA` + emite el evento `cargo.pendiente_tarifa`.
 *      NUNCA se factura a 0 (RN R3).
 *
 * `revertirCargo` marca el cargo original `REVERTIDO` (nunca se borra) y crea
 * una línea `REVERSION` enlazada por `reversalOfId` — ver la nota de signo en
 * la función.
 */
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { emitDomainEvent, type EmitDomainEventTx } from "@his/database";
import { resolverPrecio, mapFuenteAPriceSource } from "./price-resolver";

/** Estados de `PatientAccount` que aceptan cargos nuevos (docs/48 Ola 1, C1-5). */
const ESTADOS_CUENTA_ACTIVA = ["ABIERTA", "PENDIENTE_REGULARIZAR"] as const;

/** Redondea a centavos (moneda de todas las listas reales es USD). */
function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Convierte Prisma Decimal-or-number-or-null a number-or-null. Mismo patrón
 * que `decimalToNumber` en `ece/prescription-safety-check.ts` — Prisma
 * serializa columnas Decimal como objetos `{toNumber()}`; los mocks de test
 * suelen pasar el number crudo directamente.
 */
function decimalToNumber(v: { toNumber: () => number } | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

export interface CapturarCargoParams {
  organizationId: string;
  patientId: string;
  /** Si viene, se prefiere la cuenta activa de ESTE encuentro sobre cualquier otra. */
  encounterId?: string | null;
  /** Código de catálogo (tarifario/LabTest/etc.) — insumo de `resolverPrecio`. */
  code: string;
  descripcion: string;
  quantity: number;
  /** Acto clínico que originó el cargo: dispensacion | lab_order | imaging | etc. */
  origen: string;
  referenciaId?: string | null;
  actorId: string;
}

export interface CapturarCargoResult {
  cargoId: string;
  status: "VIGENTE" | "PENDIENTE_TARIFA";
  unitPrice: number | null;
}

/**
 * Resuelve la cuenta activa del paciente para anclar el cargo.
 * Si `encounterId` viene, se prefiere la cuenta activa de ese encuentro; si
 * ninguna cuenta de ese encuentro está activa, cae a la cuenta activa más
 * reciente del paciente (con o sin encuentro).
 */
async function resolverCuentaActiva(
  tx: PrismaClient,
  organizationId: string,
  patientId: string,
  encounterId: string | null | undefined,
): Promise<{ id: string } | null> {
  if (encounterId) {
    const porEncuentro = await tx.patientAccount.findFirst({
      where: {
        organizationId,
        patientId,
        encounterId,
        status: { in: [...ESTADOS_CUENTA_ACTIVA] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (porEncuentro) return porEncuentro;
  }

  return tx.patientAccount.findFirst({
    where: {
      organizationId,
      patientId,
      status: { in: [...ESTADOS_CUENTA_ACTIVA] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/**
 * Captura un cargo a la cuenta activa del paciente, con precio resuelto y
 * congelado server-side. Debe llamarse DENTRO de la transacción del acto
 * clínico que lo origina (mismo `tx` que el resto de la operación).
 */
export async function capturarCargo(
  tx: PrismaClient,
  params: CapturarCargoParams,
): Promise<CapturarCargoResult> {
  const cuenta = await resolverCuentaActiva(
    tx,
    params.organizationId,
    params.patientId,
    params.encounterId,
  );

  if (!cuenta) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "El paciente no tiene una cuenta activa (ABIERTA o PENDIENTE_REGULARIZAR). " +
        "Abra la cuenta del episodio antes de registrar cargos.",
    });
  }

  const resuelto = await resolverPrecio(tx, {
    organizationId: params.organizationId,
    cuentaId: cuenta.id,
    code: params.code,
    cantidad: params.quantity,
  });

  const tipo = params.encounterId ? "HOSPITALARIO" : "NO_HOSPITALARIO";

  if (resuelto.precio == null) {
    // R3 — nunca se factura a 0: la línea queda pendiente de tarifa, visible
    // y bloqueante de cierre (el bloqueo real de cierre llega en Ola 4, C4-1).
    const cargo = await tx.patientAccountService.create({
      data: {
        accountId: cuenta.id,
        tipo,
        descripcion: params.descripcion,
        encounterId: params.encounterId ?? null,
        code: params.code,
        quantity: params.quantity,
        unitPrice: null,
        totalPrice: null,
        priceListId: null,
        priceRuleId: null,
        resolvedAt: null,
        priceSource: null,
        status: "PENDIENTE_TARIFA",
        origen: params.origen,
        referenciaId: params.referenciaId ?? null,
        createdBy: params.actorId,
      },
    });

    await emitDomainEvent(tx as unknown as EmitDomainEventTx, {
      eventType: "cargo.pendiente_tarifa",
      aggregateType: "PatientAccountService",
      aggregateId: cargo.id,
      emittedById: params.actorId,
      organizationId: params.organizationId,
      payload: {
        cargoId: cargo.id,
        accountId: cuenta.id,
        patientId: params.patientId,
        code: params.code,
        quantity: params.quantity,
        origen: params.origen,
        referenciaId: params.referenciaId ?? null,
      },
    });

    return { cargoId: cargo.id, status: "PENDIENTE_TARIFA", unitPrice: null };
  }

  const unitPrice = resuelto.precio;
  const totalPrice = aCentavos(params.quantity * unitPrice);

  const cargo = await tx.patientAccountService.create({
    data: {
      accountId: cuenta.id,
      tipo,
      descripcion: params.descripcion,
      encounterId: params.encounterId ?? null,
      code: params.code,
      quantity: params.quantity,
      unitPrice,
      totalPrice,
      priceListId: resuelto.priceListId,
      priceRuleId: resuelto.reglaId,
      resolvedAt: new Date(),
      priceSource: mapFuenteAPriceSource(resuelto.fuente),
      status: "VIGENTE",
      origen: params.origen,
      referenciaId: params.referenciaId ?? null,
      createdBy: params.actorId,
    },
  });

  return { cargoId: cargo.id, status: "VIGENTE", unitPrice };
}

export interface RevertirCargoParams {
  cargoId: string;
  motivo: string;
  actorId: string;
}

export interface RevertirCargoResult {
  reversionId: string;
}

/**
 * Revierte un cargo VIGENTE: lo marca `REVERTIDO` (nunca se borra) y crea una
 * línea `REVERSION` enlazada por `reversalOfId`.
 *
 * Decisión de signo (docs/48 C2-1): la línea REVERSION conserva el mismo
 * `unitPrice` del original y usa `quantity`/`totalPrice` NEGATIVOS — así un
 * `SUM(totalPrice)` sobre las líneas de la cuenta da el efecto neto correcto
 * sin que el lector tenga que ramificar por `status`.
 */
export async function revertirCargo(
  tx: PrismaClient,
  params: RevertirCargoParams,
): Promise<RevertirCargoResult> {
  const original = await tx.patientAccountService.findUnique({
    where: { id: params.cargoId },
  });

  if (!original) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Cargo no encontrado." });
  }

  if (original.status !== "VIGENTE") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Solo se puede revertir un cargo VIGENTE (estado actual: ${original.status}).`,
    });
  }

  await tx.patientAccountService.update({
    where: { id: original.id },
    data: { status: "REVERTIDO" },
  });

  const quantity = decimalToNumber(original.quantity) ?? 0;
  const totalPrice = decimalToNumber(original.totalPrice);

  const reversion = await tx.patientAccountService.create({
    data: {
      accountId: original.accountId,
      tipo: original.tipo,
      descripcion: `Reversión: ${params.motivo}`,
      encounterId: original.encounterId,
      code: original.code,
      quantity: -quantity,
      unitPrice: original.unitPrice,
      totalPrice: totalPrice != null ? -totalPrice : null,
      priceListId: original.priceListId,
      priceRuleId: original.priceRuleId,
      resolvedAt: original.resolvedAt,
      priceSource: original.priceSource,
      status: "REVERSION",
      reversalOfId: original.id,
      origen: original.origen,
      referenciaId: original.referenciaId,
      createdBy: params.actorId,
    },
  });

  return { reversionId: reversion.id };
}

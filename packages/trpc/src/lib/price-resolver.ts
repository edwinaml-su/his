/**
 * CC-0015 — Resolver de precio server-side por cuenta de paciente.
 *
 * Cadena de resolución (Edwin, regla de negocio confirmada):
 *   1. Item activo de la ServicePriceList asignada al TipoCuenta de la cuenta
 *      (match por `code`).
 *   2. Fallback: LabTest.standardPrice (CC-0013) por `code`.
 *   3. null — el llamador debe pedir precio manual con aviso.
 *
 * Debe llamarse DENTRO de una transacción con contexto de tenant aplicado
 * (withTenantContext) — igual que el resto de helpers en packages/trpc/src/lib.
 */

export type PrecioFuente = "lista" | "estandar" | null;

export interface PrecioResuelto {
  precio: number | null;
  fuente: PrecioFuente;
  /** id de la ServicePriceList usada, si la fuente fue "lista". */
  priceListId: string | null;
}

/** Tipo mínimo del cliente de transacción que necesita este helper. */
type TxForPriceResolver = {
  $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T>;
  tipoCuenta: {
    findFirst: (args: {
      where: { id: string; organizationId: string };
    }) => Promise<{ priceListId: string | null } | null>;
  };
  patientAccount: {
    findFirst: (args: {
      where: { id: string; organizationId: string };
    }) => Promise<{ tipoCuentaId: string | null } | null>;
  };
  labTest: {
    findFirst: (args: {
      where: { code: string; standardPrice: { not: null }; organizationId: string | null };
    }) => Promise<{ standardPrice: unknown } | null>;
  };
};

/**
 * Resuelve el `priceListId` efectivo de una cuenta (vía su TipoCuenta).
 * Devuelve null si la cuenta no tiene tipoCuentaId o el tipo no tiene lista asignada.
 */
export async function resolverPriceListIdDeCuenta(
  tx: TxForPriceResolver,
  organizationId: string,
  cuentaId: string,
): Promise<string | null> {
  const cuenta = await tx.patientAccount.findFirst({
    where: { id: cuentaId, organizationId },
  });
  if (!cuenta?.tipoCuentaId) return null;

  const tipo = await tx.tipoCuenta.findFirst({
    where: { id: cuenta.tipoCuentaId, organizationId },
  });
  return tipo?.priceListId ?? null;
}

/**
 * Resuelve el precio de un `code` para una cuenta dada, siguiendo la cadena
 * lista de precios del tipo de cuenta → LabTest.standardPrice → null.
 */
export async function resolverPrecio(
  tx: TxForPriceResolver,
  params: { organizationId: string; cuentaId: string; code: string },
): Promise<PrecioResuelto> {
  const { organizationId, cuentaId, code } = params;

  const priceListId = await resolverPriceListIdDeCuenta(tx, organizationId, cuentaId);

  if (priceListId) {
    const rows = await tx.$queryRawUnsafe<Array<{ unitPrice: string }>>(
      `SELECT i."unitPrice"
         FROM "ServicePriceListItem" i
        WHERE i."priceListId" = $1 AND i.code = $2 AND i.active = true
        LIMIT 1`,
      priceListId,
      code,
    );
    if (rows[0]) {
      return { precio: Number(rows[0].unitPrice), fuente: "lista", priceListId };
    }
  }

  // LabTest.organizationId es nullable (catálogo global vs tenant-scoped).
  // Se prueba primero el override del tenant y, si no existe, el catálogo global.
  const labTestTenant = await tx.labTest.findFirst({
    where: { code, standardPrice: { not: null }, organizationId },
  });
  const labTest =
    labTestTenant ?? (await tx.labTest.findFirst({ where: { code, standardPrice: { not: null }, organizationId: null } }));

  if (labTest?.standardPrice != null) {
    return { precio: Number(labTest.standardPrice), fuente: "estandar", priceListId: null };
  }

  return { precio: null, fuente: null, priceListId: null };
}

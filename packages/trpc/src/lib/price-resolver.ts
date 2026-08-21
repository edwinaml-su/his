/**
 * CC-0015 / CC-0021 — Resolver de precio server-side por cuenta de paciente.
 *
 * CC-0021 convierte la resolución plana (code → unitPrice) en un motor de
 * reglas equivalente al de `product.pricelist` de Odoo 18, verificado contra
 * odoo.complejoavante.com (ver docs/CC/0021).
 *
 * Cadena de resolución:
 *   1. Lista de precios asignada al TipoCuenta de la cuenta. Dentro de ella
 *      gana la PRIMERA regla que matchea, ordenada como en Odoo:
 *        especificidad (item → categoría → global)
 *        → cantidad mínima desc
 *        → categoría más específica (menor distancia en el árbol)
 *        → sequence desc → creación desc.
 *      El ítem plano del tarifario ("ServicePriceListItem", los 10,602
 *      precios importados en CC-0015) participa del mismo ranking como la
 *      regla implícita `item / fixed / minQuantity 0 / sin vigencia` — que es
 *      la forma del 99.9% de las reglas reales de Odoo. Una regla explícita
 *      de nivel `item` para el mismo código le gana; una de categoría o
 *      global, no.
 *   2. Fallback: LabTest.standardPrice (CC-0013), primero override del tenant
 *      y luego catálogo global.
 *   3. null — el llamador debe pedir precio manual con aviso.
 *
 * Cuando se pasa `labTestId`, se prueba antes `ImagingTestAttrs.codigoTarifario`
 * como ALIAS del código de tarifario (CC-0016) — sin `labTestId` el
 * comportamiento es idéntico al de antes.
 *
 * Debe llamarse DENTRO de una transacción con contexto de tenant aplicado
 * (withTenantContext) — igual que el resto de helpers en packages/trpc/src/lib.
 */

export type PrecioFuente = "regla" | "lista" | "estandar" | null;

export interface PrecioResuelto {
  precio: number | null;
  /** "regla" = regla explícita · "lista" = ítem del tarifario · "estandar" = catálogo. */
  fuente: PrecioFuente;
  /** id de la ServicePriceList usada, si la fuente fue "regla" o "lista". */
  priceListId: string | null;
  /** id de la ServicePriceRule aplicada, si la fuente fue "regla". */
  reglaId: string | null;
}

/** Profundidad máxima de la cascada `base = 'pricelist'` (igual que la guarda del trigger, sql/204). */
const MAX_PROFUNDIDAD_CASCADA = 5;

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
  /** CC-0016 — opcional: solo lo requieren callers que resuelven precio de imágenes. */
  imagingTestAttrs?: {
    findUnique: (args: {
      where: { labTestId: string };
    }) => Promise<{ codigoTarifario: string | null } | null>;
  };
};

interface ReglaRow {
  id: string;
  appliedOn: "item" | "category" | "global";
  computePrice: "fixed" | "percentage" | "formula";
  fixedPrice: string | null;
  percentPrice: string;
  base: "list_price" | "standard_cost" | "pricelist";
  basePriceListId: string | null;
  priceDiscount: string;
  priceSurcharge: string;
  priceRound: string;
  priceMinMargin: string;
  priceMaxMargin: string;
}

interface ItemRow {
  unitPrice: string;
  estimatedCost: string | null;
}

/**
 * Regla candidata de una lista para un código, cantidad y fecha dados.
 * `categoria_base` resuelve la categoría del código (la del ítem del tarifario
 * y, si no la tiene, la del LabTest); `ancestro` sube por el árbol para que una
 * regla de categoría aplique también a las subcategorías, como el `child_of`
 * de Odoo. `distancia` = 0 es la categoría exacta (la más específica gana).
 */
const SQL_REGLA_CANDIDATA = `
WITH RECURSIVE categoria_base AS (
  SELECT COALESCE(
    (SELECT i."categoryId" FROM "ServicePriceListItem" i
      WHERE i."priceListId" = $1::uuid AND i.code = $2::text
        AND i.active = true AND i."categoryId" IS NOT NULL
      LIMIT 1),
    (SELECT lt."categoryId" FROM "LabTest" lt
      WHERE lt.code = $2::text AND lt."categoryId" IS NOT NULL
        AND (lt."organizationId" = $3::uuid OR lt."organizationId" IS NULL)
      ORDER BY (lt."organizationId" IS NULL)
      LIMIT 1)
  ) AS id
),
ancestro AS (
  SELECT sc.id, sc."parentId", 0 AS distancia
    FROM "ServiceCategory" sc
    JOIN categoria_base cb ON cb.id = sc.id
  UNION ALL
  SELECT p.id, p."parentId", a.distancia + 1
    FROM "ServiceCategory" p
    JOIN ancestro a ON a."parentId" = p.id
   WHERE a.distancia < 10
)
SELECT r.id, r."appliedOn", r."computePrice", r."fixedPrice", r."percentPrice",
       r.base, r."basePriceListId", r."priceDiscount", r."priceSurcharge",
       r."priceRound", r."priceMinMargin", r."priceMaxMargin"
  FROM "ServicePriceRule" r
  LEFT JOIN ancestro a ON a.id = r."categoryId"
 WHERE r."priceListId" = $1::uuid
   AND r.active = true
   AND r."minQuantity" <= $4::numeric
   AND (r."dateStart" IS NULL OR r."dateStart" <= $5::timestamptz)
   AND (r."dateEnd" IS NULL OR r."dateEnd" >= $5::timestamptz)
   AND (
     (r."appliedOn" = 'item' AND r."itemCode" = $2::text)
     OR (r."appliedOn" = 'category' AND a.id IS NOT NULL)
     OR (r."appliedOn" = 'global')
   )
 ORDER BY CASE r."appliedOn" WHEN 'item' THEN 0 WHEN 'category' THEN 1 ELSE 2 END,
          r."minQuantity" DESC,
          COALESCE(a.distancia, 0),
          r.sequence DESC,
          r."createdAt" DESC
 LIMIT 1`;

const SQL_ITEM_PLANO = `
SELECT i."unitPrice", i."estimatedCost"
  FROM "ServicePriceListItem" i
 WHERE i."priceListId" = $1::uuid AND i.code = $2::text AND i.active = true
 LIMIT 1`;

/** Redondea a centavos (la moneda de todas las listas reales es USD). */
function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Equivalente a `float_round(valor, precision_rounding=multiplo)` de Odoo. */
function redondearAMultiplo(valor: number, multiplo: number): number {
  if (multiplo <= 0) return valor;
  return Math.round(valor / multiplo) * multiplo;
}

/**
 * Aplica la fórmula de precio de Odoo sobre un precio base.
 * El orden (descuento → redondeo → recargo → márgenes) está documentado por el
 * propio Odoo en la ayuda de `price_round`: «Rounding is applied after the
 * discount and before the surcharge».
 *
 * `price_markup` de Odoo NO es un término aparte: es el espejo del descuento
 * (la única regla real trae discount = -6.38 y markup = +6.38). Un markup se
 * expresa aquí como "priceDiscount" negativo.
 */
export function calcularPrecioRegla(regla: ReglaRow, base: number): number {
  if (regla.computePrice === "fixed") {
    return aCentavos(Number(regla.fixedPrice ?? 0));
  }

  if (regla.computePrice === "percentage") {
    return aCentavos(base - (base * Number(regla.percentPrice)) / 100);
  }

  const limite = base;
  let precio = base - (base * Number(regla.priceDiscount)) / 100;

  const round = Number(regla.priceRound);
  if (round > 0) precio = redondearAMultiplo(precio, round);

  precio += Number(regla.priceSurcharge);

  const minMargin = Number(regla.priceMinMargin);
  if (minMargin) precio = Math.max(precio, limite + minMargin);

  const maxMargin = Number(regla.priceMaxMargin);
  if (maxMargin) precio = Math.min(precio, limite + maxMargin);

  return aCentavos(precio);
}

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
 * Precio de catálogo del código (equivalente al `list_price` del producto en
 * Odoo): override del tenant primero, catálogo global después.
 */
async function precioCatalogo(
  tx: TxForPriceResolver,
  organizationId: string,
  code: string,
): Promise<number | null> {
  const tenant = await tx.labTest.findFirst({
    where: { code, standardPrice: { not: null }, organizationId },
  });
  const labTest =
    tenant ?? (await tx.labTest.findFirst({ where: { code, standardPrice: { not: null }, organizationId: null } }));

  return labTest?.standardPrice != null ? Number(labTest.standardPrice) : null;
}

interface ContextoResolucion {
  organizationId: string;
  cantidad: number;
  fecha: Date;
}

interface PrecioDeLista {
  precio: number;
  fuente: "regla" | "lista";
  reglaId: string | null;
}

/**
 * Precio base sobre el que calcula una regla `percentage` / `formula`.
 * Devuelve null cuando el base no es determinable: en ese caso la regla se
 * ignora (Odoo asumiría 0 — cobrar 0 por no poder calcular sería peor que
 * caer al siguiente eslabón de la cadena o pedir precio manual).
 */
async function precioBase(
  tx: TxForPriceResolver,
  regla: ReglaRow,
  item: ItemRow | undefined,
  code: string,
  ctx: ContextoResolucion,
  profundidad: number,
): Promise<number | null> {
  if (regla.base === "standard_cost") {
    return item?.estimatedCost != null ? Number(item.estimatedCost) : null;
  }

  if (regla.base === "pricelist") {
    if (!regla.basePriceListId || profundidad >= MAX_PROFUNDIDAD_CASCADA) return null;
    const enBase = await resolverEnLista(tx, regla.basePriceListId, code, ctx, profundidad + 1);
    return enBase?.precio ?? (await precioCatalogo(tx, ctx.organizationId, code));
  }

  // base = 'list_price': precio de catálogo del código. El ítem del tarifario
  // de esta misma lista es el precio de catálogo más cercano que tiene el HIS;
  // si el código no está en la lista, se usa el estándar del catálogo.
  if (item) return Number(item.unitPrice);
  return precioCatalogo(tx, ctx.organizationId, code);
}

/**
 * Evalúa el motor de reglas de UNA lista para UN código.
 * Devuelve null si la lista no produce precio para ese código.
 */
async function resolverEnLista(
  tx: TxForPriceResolver,
  priceListId: string,
  code: string,
  ctx: ContextoResolucion,
  profundidad = 0,
): Promise<PrecioDeLista | null> {
  const [items, reglas] = await Promise.all([
    tx.$queryRawUnsafe<ItemRow[]>(SQL_ITEM_PLANO, priceListId, code),
    tx.$queryRawUnsafe<ReglaRow[]>(
      SQL_REGLA_CANDIDATA,
      priceListId,
      code,
      ctx.organizationId,
      ctx.cantidad,
      ctx.fecha,
    ),
  ]);

  const item = items[0];
  const regla = reglas[0];

  async function aplicar(r: ReglaRow): Promise<PrecioDeLista | null> {
    if (r.computePrice === "fixed") {
      return { precio: calcularPrecioRegla(r, 0), fuente: "regla", reglaId: r.id };
    }
    const base = await precioBase(tx, r, item, code, ctx, profundidad);
    if (base == null) return null;
    return { precio: calcularPrecioRegla(r, base), fuente: "regla", reglaId: r.id };
  }

  // Una regla explícita de nivel `item` gana al ítem plano del tarifario.
  if (regla?.appliedOn === "item") {
    const resultado = await aplicar(regla);
    if (resultado) return resultado;
  }

  // El ítem plano es más específico que cualquier regla de categoría o global.
  if (item) {
    return { precio: aCentavos(Number(item.unitPrice)), fuente: "lista", reglaId: null };
  }

  if (regla) return aplicar(regla);

  return null;
}

/**
 * Resuelve el precio de un `code` contra UNA lista concreta, sin pasar por la
 * cuenta. Lo usa el probador de reglas del admin de tarifarios: deja ver qué
 * regla ganaría antes de facturar con ella.
 *
 * El llamador es responsable de verificar que la lista pertenece al tenant.
 */
export async function resolverPrecioEnLista(
  tx: TxForPriceResolver,
  params: {
    organizationId: string;
    priceListId: string;
    code: string;
    cantidad?: number;
    fecha?: Date;
  },
): Promise<PrecioResuelto> {
  const ctx: ContextoResolucion = {
    organizationId: params.organizationId,
    cantidad: params.cantidad ?? 1,
    fecha: params.fecha ?? new Date(),
  };

  const resultado = await resolverEnLista(tx, params.priceListId, params.code, ctx);
  if (resultado) {
    return {
      precio: resultado.precio,
      fuente: resultado.fuente,
      priceListId: params.priceListId,
      reglaId: resultado.reglaId,
    };
  }

  const estandar = await precioCatalogo(tx, params.organizationId, params.code);
  if (estandar != null) {
    return { precio: estandar, fuente: "estandar", priceListId: null, reglaId: null };
  }

  return { precio: null, fuente: null, priceListId: null, reglaId: null };
}

/**
 * Resuelve el precio de un `code` para una cuenta dada.
 *
 * @param params.cantidad Cantidad facturada — activa los tramos por cantidad
 *   mínima de las reglas. Por defecto 1.
 * @param params.fecha Momento de valoración — activa la vigencia por regla.
 *   Por defecto, ahora.
 */
export async function resolverPrecio(
  tx: TxForPriceResolver,
  params: {
    organizationId: string;
    cuentaId: string;
    code: string;
    labTestId?: string;
    cantidad?: number;
    fecha?: Date;
  },
): Promise<PrecioResuelto> {
  const { organizationId, cuentaId, code, labTestId } = params;
  const ctx: ContextoResolucion = {
    organizationId,
    cantidad: params.cantidad ?? 1,
    fecha: params.fecha ?? new Date(),
  };

  const priceListId = await resolverPriceListIdDeCuenta(tx, organizationId, cuentaId);

  if (priceListId) {
    // CC-0016 — alias de facturación: se prueba ANTES que el `code` nativo.
    const codigos: string[] = [];
    if (labTestId && tx.imagingTestAttrs) {
      const attrs = await tx.imagingTestAttrs.findUnique({ where: { labTestId } });
      if (attrs?.codigoTarifario) codigos.push(attrs.codigoTarifario);
    }
    codigos.push(code);

    for (const candidato of codigos) {
      const resultado = await resolverEnLista(tx, priceListId, candidato, ctx);
      if (resultado) {
        return {
          precio: resultado.precio,
          fuente: resultado.fuente,
          priceListId,
          reglaId: resultado.reglaId,
        };
      }
    }
  }

  const estandar = await precioCatalogo(tx, organizationId, code);
  if (estandar != null) {
    return { precio: estandar, fuente: "estandar", priceListId: null, reglaId: null };
  }

  return { precio: null, fuente: null, priceListId: null, reglaId: null };
}

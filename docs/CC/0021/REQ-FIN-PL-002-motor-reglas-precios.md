# REQ-FIN-PL-002 — Motor de reglas de listas de precios (réplica de Odoo)

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0021** |
| Fecha | 2026-08-21 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Rama | `feat/cc-0021-motor-reglas-precios` |
| SQL | `packages/database/sql/204_cc0021_motor_reglas_precios.sql` — **APLICADO a prod 2026-08-21 (no re-aplicar)** |
| Datos | `docs/CC/0021/sql/*.sql` (idempotentes) — **APLICADOS a prod 2026-08-21**: 42 categorías, 10,847 ítems (9,810 clasificados), 999 reglas |
| Insumo | `docs/CC/0021/odoo-pricelists-dump.json` — extracción read-only de odoo.complejoavante.com (Odoo 18.0), 2026-08-21 |
| Antecedente | CC-0015 (tipo de cuenta → lista de precios) |

## 1. Qué se verificó en Odoo

Extracción read-only vía XML-RPC (UID 1546) el **2026-08-21**: 20 listas activas y **3,674 reglas** de `product.pricelist.item`.

| Mecanismo de Odoo | Uso real medido |
|---|---|
| `applied_on`: variante / producto / **categoría** / global | 149 / 3,523 / **2** / 0 |
| `compute_price`: fixed / percentage / **formula** | 3,672 / 0 / **2** |
| `base`: precio de venta / costo / **otra lista (cascada)** | 3,674 / 0 / **0** |
| `min_quantity` (tramos) | 331 reglas en 1 y 1 en 1.64 — sin tramos reales; las 7 «duplicadas» son ruido de datos |
| `date_start` / `date_end` **por regla** | 4 reglas |
| Orden de evaluación `applied_on, min_quantity desc, categ_id desc, id desc` | verificado por el orden natural que devuelve el modelo |
| Sin regla que matchee → `list_price` del producto | — |
| Asignación de lista: `res.partner.property_product_pricelist` | **32,109 de 32,117 partners apuntan a la lista por defecto**: en la práctica la lista del pagador se elige en el documento, no en el partner |
| Multi-compañía (5 compañías) | listas con `company_id` |

Las dos únicas reglas calculadas del sistema real:

| Lista | Categoría | Cálculo | Efecto |
|---|---|---|---|
| Precios Avante Complejo Hospitalario | INSUMOS | `formula`, `price_discount = -6.38` | +6.38% sobre el precio de catálogo |
| DrSV - IMAGENES | IMAGENES | `formula`, `price_min_margin = price_max_margin = 0.7`, vigente desde 2026-06-29 | precio de catálogo + $0.70 exacto |

El orden de la fórmula (**descuento → redondeo → recargo → márgenes mín/máx**) no se asumió: lo documenta el propio Odoo en la ayuda del campo `price_round` («Rounding is applied after the discount and before the surcharge»).

`price_markup` **no** es un término independiente: es el espejo de `price_discount` (la regla de INSUMOS trae `-6.38` y `+6.38` a la vez). Contarlo aparte duplicaría el margen; el HIS persiste solo el descuento, y un markup se guarda como descuento negativo.

## 2. Qué faltaba en el HIS

CC-0015 importó las listas reales como pares planos `code → unitPrice`. Eso cubre el 99.9% del uso de Odoo, pero descartaba todo lo que un ítem plano no sabe expresar. Consecuencias medibles:

- «DrSV - IMAGENES» quedó con **0 ítems**: su único precio es una regla de categoría.
- La regla de markup de INSUMOS se perdió.
- Los **331 tramos por cantidad** se colapsaron como «duplicados» (se conservaba el último).
- Las 4 reglas con vigencia propia perdieron su ventana.

## 3. Entregado

### Modelo de datos (`sql/204`, pendiente de aplicar)
- **`ServiceCategory`** — árbol de categorías por organización (equivalente a `product.category`), con RLS tenant y `odooCategId` para trazabilidad del importador.
- **`ServicePriceListItem."categoryId"`** — clasifica el ítem del tarifario.
- **`LabTest."categoryId"`** — clasifica el catálogo de exámenes/estudios. En Odoo la categoría vive en el producto (global), no en la línea de la lista; sin esto una regla de categoría no podría aplicar a un código que no está en la lista — justo el caso de DrSV-IMAGENES.
- **`ServicePriceRule`** — réplica de `product.pricelist.item`: `appliedOn` (item/category/global), `minQuantity`, vigencia, `computePrice` (fixed/percentage/formula), `base` (list_price/standard_cost/pricelist), descuento, recargo, redondeo, márgenes mín/máx, `sequence`, `odooItemId`. Ocho CHECK de coherencia y dos triggers: la categoría debe ser de la misma org que la lista, y la cascada de listas base no admite ciclos ni más de 5 niveles.

### Decisión de diseño: el ítem plano no se migra a regla
`ServicePriceListItem` (los 10,602 precios de CC-0015) se comporta como la regla implícita `item / fixed / minQuantity 0 / sin vigencia` — que es exactamente la forma del 99.9% de las reglas de Odoo. El resolver lo proyecta dentro del mismo ranking, con la prioridad más baja de su nivel: **una regla explícita de nivel ítem le gana; una de categoría o global, no.** Así no se duplican 10,602 filas ni se rompe ningún consumidor del tarifario.

### Motor de resolución (`packages/trpc/src/lib/price-resolver.ts`)
Gana la primera regla que matchea, ordenada como en Odoo: especificidad → cantidad mínima desc → categoría más específica → `sequence` desc → creación desc. Después:
1. Regla de la lista del tipo de cuenta (con su cálculo).
2. Ítem del tarifario.
3. `LabTest.standardPrice` (override del tenant y luego catálogo global).
4. Sin precio → captura manual con aviso.

`resolverPrecio` acepta ahora `cantidad` y `fecha`; `resolverPrecioEnLista` evalúa una lista concreta sin pasar por una cuenta (probador del admin).

### Backend
- `servicePriceList`: `listRules` / `addRule` / `updateRule` / `setRuleActive` / `deleteRule`, `listCategories` / `createCategory` / `updateCategory`, y `simularPrecio`. Escrituras con ADMIN o ACCOUNTANT; todas las lecturas dentro de `withTenantContext`.
- `resolverPorCuenta` acepta `cantidad` y devuelve además `reglaId`.
- Contratos en `packages/contracts/src/schemas/service-price-rule.ts` (mismas condiciones que los CHECK, para dar el error en el formulario y no en la BD).

### UI
`/finance/price-lists/[id]` suma la tarjeta **Reglas de precio**: tabla en el orden real de evaluación, alta de reglas con solo los campos que aplican al tipo de cálculo, toggle de activación, y un **probador** (código + cantidad) que muestra el precio resultante y de dónde vino.

### Importador (`packages/database/scripts/sync-tarifario-odoo.mjs`)
Sucesor de `seed-tarifario-odoo.mjs`. Dos modos, ninguno escribe en BD:
- `--extract` — extracción read-only con todos los campos de la regla.
- `--emit-sql` — SQL idempotente para aplicar vía MCP.

Resultado de la corrida del 2026-08-21: **14 categorías**, **3,270 ítems planos** (71 duplicados reales descartados) y **333 reglas explícitas** — las 2 de categoría, las 331 de tramo y las de vigencia que antes se perdían.

## 4. Desviaciones conscientes respecto de Odoo

| Punto | Odoo | HIS | Razón |
|---|---|---|---|
| Empate entre reglas de categoría | `categ_id desc` (id, arbitrario) | categoría más específica (menor distancia en el árbol) | El id de categoría no significa nada; «la más específica gana» es lo que espera el usuario. Hoy no hay empates posibles (solo 2 reglas, en listas y categorías distintas). |
| Variantes de producto | `0_product_variant` y `1_product` separados | ambos → `item` | El HIS no modela variantes de producto. |
| Base no calculable | asume 0 | la regla se ignora y se pasa al siguiente eslabón | Cobrar $0 por no poder calcular es peor que pedir precio manual. |
| `price_markup` | campo espejo almacenado | no se persiste | Es el negativo del descuento; persistirlo invita a contarlo dos veces. |

## 5. Estado en producción (2026-08-21)

Aplicado en este orden: `sql/204` (vía MCP) → `000_categorias` → `1NNN_items_*` → `900_reglas` (vía psql).

| Objeto | Resultado |
|---|---|
| `ServiceCategory` | 42 filas (14 categorías × 3 orgs) |
| `ServicePriceListItem` | 10,619 → **10,847** (+228 de la deriva), 9,810 clasificados |
| `ServicePriceRule` | **999** (333 × 3 orgs): 993 de ítem con precio fijo + 6 de categoría con fórmula |
| CHECK / triggers / policies | 9 CHECK, 2 triggers, 2 policies RLS |
| Advisor de seguridad | sin hallazgos nuevos |

Verificaciones funcionales corridas contra prod:
- El smoke de ordenamiento (`sql/__tests__/204_motor_precios_smoke.sql`, en transacción con ROLLBACK) devuelve lo esperado: con cantidad 1 gana la regla de ítem sin tramo, con cantidad 10 gana el tramo, y sin reglas de ítem gana la categoría más específica.
- La consulta real del resolver, ejecutada literal sobre prod para `10130101` (RESONANCIA MAGNETICA CABEZA, TARIFARIO DRSV 2026), elige la regla de tramo correcta: **$166.90**.

### Lo que todavía NO produce precio: «DrSV - IMAGENES»

La regla de esa lista **ya está almacenada** (1 por org, categoría IMAGENES, `base + $0.70`, vigente desde 2026-06-29) — es decir, el hueco de modelo quedó cerrado. Pero la regla aún no puede calcular, porque le falta el precio base sobre el que aplicar el margen:

1. La lista sigue teniendo **0 ítems** (así viene de Odoo).
2. `LabTest.categoryId` está sin poblar, así que ningún código resuelve a la categoría IMAGENES.
3. **Las 1,440 filas de `LabTest` tienen `standardPrice` NULL** — el catálogo de precios estándar de CC-0013 está vacío en prod.

En Odoo el base es `product.list_price`, que allá sí existe. Cerrar el caso requiere dos tareas de datos, no de código: clasificar los estudios de imagen en la categoría IMAGENES y cargarles precio de catálogo. Mientras tanto el motor hace lo correcto — la regla se ignora por no poder calcular y el precio cae al siguiente eslabón o se pide manual, en vez de cobrar $0.

## 6. Seguimiento

- Al re-sincronizar quedan en el tarifario los ítems planos que CC-0015 creó para las 331 reglas con `min_quantity = 1`; ahora esas reglas existen además como `ServicePriceRule` y ganan para cualquier cantidad ≥ 1, con el mismo precio. No hay cambio de comportamiento, pero conviene depurarlos en una pasada posterior.
- Clasificar el catálogo propio del HIS (`LabTest.categoryId`, ítems `PORT-*`/`AVT-*`) para que las reglas de categoría alcancen también a los servicios que no vienen de Odoo. Hoy solo quedan clasificados los códigos importados.
- Sincronización periódica: el importador sigue siendo a demanda. La deriva medida en 17 días fue de +64 reglas (MAPFRE 1→47, ISBM +11, ABANK +5, Farmacia Casa Matriz +2).
- `TipoCuenta.insurerId` y el flujo de claims siguen sin vincular (heredado de CC-0015).

# CC-0028 — Seguros operativos (espejo Odoo ACS)

| | |
|---|---|
| Solicitante | Edwin Martínez (Avante) |
| Fecha | 2026-09-14 |
| SQL | `packages/database/sql/235_cc0028_seguros_operativos.sql` — **APLICADO a prod 2026-09-14 vía MCP (proyecto `ejacvsgbewcerxtjtwto`) — NO re-aplicar.** |
| Estado | Implementado — backend + motor de cobertura + UI + tests. Importador Odoo listo, corrida real pendiente de @Orq/Edwin. |

## Directiva del solicitante (verbatim funcional)

Operar seguros en el HIS, espejo del modelo real de Odoo 18 (módulo ACS HMS,
verificado read-only por @Orq vía MCP): 29 aseguradoras (`hms.insurance.company`),
plan por aseguradora separado por ámbito cita/farmacia (`acs.insurance.plan`,
tipo de cobertura porcentaje/monto fijo/porcentaje con tope), ~1,915 pólizas de
paciente (`hms.patient.insurance`: aseguradora+plan+policy_number+carnet+
contratante+vigencia+pricelist override), "Patient Share Rules" por producto o
categoría (`acs.insurance.policy.rule`, a nivel de plan o de póliza). El ciclo
de claims (`hms.insurance.claim`, 0 registros en Odoo) NO se replica.

## Regla de oro del repo: adecuar legacy, no duplicar

El HIS ya tenía de Beta.14 (Wave 8, §25 Insurer Agreements): `Insurer`,
**`InsurancePlan`** (ya existente — el encargo original lo describía como
"nuevo", pero no lo era), `PatientCoverage`, `AuthorizationRequest` y el
router `insuranceRouter`. Este CC EXTIENDE ese modelo; no crea
`InsuranceCompany` paralelo a `Insurer` ni `PatientPolicy` paralelo a
`PatientCoverage`.

**Desviación documentada respecto al encargo**: `InsurancePlan` ya existía
con forma plana Beta.14 (`copayPct`, `coveredProcedures` JSONB, sin
`organizationId` propio — tenancy heredada de `Insurer` vía la policy RLS
`insurance_plan_inherit_insurer`, sql/38). Se decidió **NO** agregarle una
columna `organizationId` propia como pedía el encargo original: hacerlo
crearía una segunda fuente de verdad de tenancy que podría contradecir la
del `Insurer` (el mismo R02 audit ya documentó esa decisión de herencia). En
su lugar, `InsurancePlanCoverage` (la tabla nueva de config por ámbito)
hereda tenancy del plan exactamente igual que el plan la hereda del insurer
— cero columnas `organizationId` nuevas en esa cadena. `copayPct`/
`coveredProcedures` (Beta.14) se conservan intactos para `checkCoverage`/
`AuthorizationRequest` — coexisten con el modelo por-ámbito nuevo, no lo
reemplazan.

## Estado previo (verificado antes de construir)

- `Insurer`, `InsurancePlan`, `PatientCoverage`, `AuthorizationRequest` +
  `insuranceRouter` (Beta.14, sql/17 + sql/38) con RLS completo
  (`insurer_tenant_select/_modify`, `insurance_plan_inherit_insurer`,
  `patient_coverage_tenant_select/_modify`, `authorization_request_tenant_select/_modify`)
  y grants a `authenticated` — verificado en prod 2026-08-22 (comentario R02
  en `insurance.router.ts`).
- CC-0021 (`ServiceCategory`, `ServicePriceRule`, sql/204): motor de reglas
  de precio con `appliedOn`/`categoryId` — patrón de "regla por ítem >
  categoría > global" que este CC reutiliza conceptualmente (no por código)
  para la precedencia código > categoría de `CoverageRule`.
  `ServiceCategory.odooCategId` (columna sembrada en CC-0021) es la llave
  que el importador usa para mapear `product_category_id` de Odoo.
- CC-0027 (`AccountReceivable`, `CoverageLetter`, `patientAccount.liquidacion`,
  sql/234): la liquidación de cuenta ya restaba `coberturaAprobada`
  (`CoverageLetter.montoAprobado`) del saldo — ese descuento REAL no cambia.
  Este CC agrega un desglose ESTIMADO adicional, informativo.
- NO existía: cobertura por ámbito (cita/farmacia), reglas de reparto por
  producto/categoría, carnet/contratante/vigencia-override de póliza, ni
  ningún cruce con Odoo para seguros (sí existía para tarifario, CC-0015/
  CC-0021, y para catálogo de productos vía `sync-tarifario-odoo.mjs`).

## Diseño

### Modelo de datos (SQL 235)

- **`InsurancePlan`** — columnas nuevas: `priceListId` (FK lógica a
  `ServicePriceList`, mismo patrón que `TipoCuenta.priceListId`) + `sequence`.
- **`InsurancePlanCoverage`** (nueva) — cobertura por ámbito del plan:
  `ambito` (`CONSULTA`/`FARMACIA`/`GENERAL`, CHECK) + `coverageType`
  (`PORCENTAJE`/`MONTO_FIJO`/`PORCENTAJE_CON_TOPE`, CHECK) +
  `insuredPercentage`/`copayAmount`/`coverageLimit` (CHECK cruzado según
  `coverageType`). `GENERAL` es el fallback para ámbitos no configurados —
  **extensión del HIS sobre Odoo**, que solo modela cita/farmacia. Tenancy
  heredada del plan → insurer, sin columna `organizationId` propia (RLS
  `insurance_plan_coverage_inherit_plan`, mismo patrón que sql/38).
  `ambito`/`coverageType` son `varchar` + CHECK (no enum de Postgres) a
  propósito — evita el gotcha de `ALTER TYPE` documentado en CLAUDE.md si el
  catálogo de ámbitos crece.
- **`PatientCoverage`** — columnas nuevas: `carnet`, `contratante`,
  `priceListId` (override). `policyNumber`/`validFrom`/`validTo`/`planId`/
  `active` ya existían de Beta.14 y no se tocan.
- **`PatientCoverageOverride`** (nueva) — espejo exacto de
  `InsurancePlanCoverage` a nivel de póliza. Tenancy heredada de
  `PatientCoverage.organizationId` (siempre tenant, la tabla padre nunca es
  global).
- **`CoverageRule`** (nueva) — "Patient Share Rules": `planId` XOR
  `coverageId` (CHECK), `ruleOn` (`CATEGORIA`/`CODIGO`, CHECK) +
  `serviceCategoryId` (FK lógica a `ServiceCategory`, requerida si
  CATEGORIA) / `code` (requerido si CODIGO), `ruleType`
  (`PORCENTAJE`/`MONTO`) + `percentage`/`amount` (CHECK, salvo
  `fullCover=true`), `sequence`. **`organizationId` es columna propia y NO
  se hereda** (a diferencia de `InsurancePlanCoverage`) — trigger de guardia
  `fn_coverage_rule_org_guard` (mismo patrón que el guard de
  `ServicePriceRule.categoryId` en sql/204) valida que el `organizationId`
  declarado sea compatible con el del plan/póliza referenciado. Es una
  decisión de diseño intencional, no un descuido: las reglas granulares
  por producto/categoría son configuración financiera que cada
  organización adopta o no, aunque el catálogo de aseguradoras/planes sea
  compartido — ver la nota del importador más abajo.
- RLS tenant estándar + índices + triggers de auditoría hash-chain
  (`audit.fn_audit_row()`, patrón sql/224/234) en las 3 tablas nuevas.

### Motor de cobertura (`packages/trpc/src/lib/coverage-resolver.ts`)

`resolverCobertura(tx, {organizationId, patientId, fecha, lineas})` →
`{porLinea, totalAsegurado, totalPaciente, polizaId}`.

- **Póliza activa**: entre las `PatientCoverage` del paciente vigentes a
  `fecha` (`validFrom <= fecha <= validTo` o `validTo` null), se elige la de
  `validFrom` más reciente (empate → `createdAt` más reciente). El TDR no
  especifica un criterio de multiplicidad de pólizas simultáneas — este es
  el adoptado, documentado en el docstring del módulo.
- **Precedencia** (código > categoría > override de póliza > config del
  plan > GENERAL, tal como pidió el encargo): dentro de cada nivel de regla
  (código/categoría), lo específico de la póliza gana sobre lo genérico del
  plan — mismo criterio de especificidad que `price-resolver.ts`
  (ítem > categoría > global). El encargo no desambiguaba esa sub-precedencia.
- **Aritmética**: `PORCENTAJE` = `total × %`; `MONTO_FIJO` = copago fijo del
  paciente (tope: el total de la línea), el resto lo cubre la aseguradora;
  `PORCENTAJE_CON_TOPE` = `min(total × %, presupuesto restante)`, donde el
  presupuesto es `coverageLimit` **acumulado a través de todas las líneas de
  la misma liquidación** (no histórico — v1, decisión explícita del encargo).
  `copayAmount` en `PORCENTAJE`/`PORCENTAJE_CON_TOPE` es un modificador
  adicional que siempre resta del lado asegurado hacia el paciente. Una
  `CoverageRule` con `fullCover=true` cubre el 100% sin mirar `ruleType`.
- Puro/testeable — recibe un `tx` con la forma mínima de Prisma (mismo
  estilo que `price-resolver.ts`). 16 tests en
  `packages/trpc/src/lib/__tests__/coverage-resolver.test.ts` (precedencia
  código>categoría>póliza>plan, cada `coverageType`, `fullCover`, copago,
  tope acumulado, sin póliza).

### Integración con la liquidación (CC-0027)

`patientAccount.liquidacion` ahora devuelve `coberturaEstimada`
(`ResultadoCobertura | null`) además de `totalCargos`/`totalPagos`/
`coberturaAprobada`/`saldo` — **sin cambiar la semántica de `saldo`**: la
cobertura estimada NO descuenta sola, el único descuento real sigue siendo
la `CoverageLetter` de la Ruta A (igual que en Odoo, donde la cobertura es
aritmética de facturación/liquidación, no de captura del cargo).
`computeCoberturaEstimada` (nueva, en `patient-account.router.ts`) arma las
`LineaEntrada` desde `PatientAccountService` (status `VIGENTE`), mapea
`origen` → ámbito (`DISPENSACION_FARMACIA` → `FARMACIA`, todo lo demás →
`CONSULTA` — heurística v1, único origen de farmacia hoy en el código) y
resuelve la categoría del código vía el mismo criterio de
`price-resolver.ts` (`ServicePriceListItem.categoryId` de la lista
congelada en el cargo, luego `LabTest.categoryId`). `capturarCargo` y el
precio de las líneas NO se tocan.

### tRPC (`insurance.router.ts`, extendido — no nuevo router)

- `plan.create` — acepta `priceListId`/`sequence` nuevos.
- `coverage.create` — acepta `carnet`/`contratante`/`priceListId` nuevos.
- `planCoverage.list`/`.upsert` — config de ámbito del plan.
- `coverageOverride.list`/`.upsert` — override de ámbito de una póliza.
- `rule.list`/`.create`/`.deactivate` — `CoverageRule` a nivel de plan o
  póliza.

Escrituras de config de plan/reglas (`plan.create`, `planCoverage.upsert`,
`coverageOverride.upsert`, `rule.create`/`.deactivate`) requieren rol
`ADMIN`/`ACCOUNTANT` (`writerProc`, mismo par de roles que
`patient-account.router.altaAdministrativa`/`registrarCartaCobertura`).
`coverage.create` (alta de póliza de paciente) usa `coverageWriterProc`
(`ADMIN`/`ACCOUNTANT`/`BILLING`, mismo set que `invoice.router`) — es
trabajo de facturación del día a día en admisión, no configuración
financiera de catálogo, por eso el set de roles es más amplio que el de
config de plan/reglas. Ambos endpoints **ya existían** desde Beta.14
gateados solo con `tenantProcedure`; el pre-pr-review de este CC (ver
abajo) marcó que agregarles `priceListId`/`carnet`/`contratante` sin subir
el gate era inconsistente con el resto del PR — se corrigió antes de
commitear.

### UI

- `apps/web/src/app/(admin)/insurance/plans/page.tsx` (nueva) — lista +
  alta de `InsurancePlan`. Enlazada desde `/insurance` (botón "Planes",
  junto a "Nueva aseguradora" — un solo sidebar item para todo el dominio
  de seguros, sin entrada nueva).
- `apps/web/src/app/(admin)/insurance/plans/[id]/page.tsx` (nueva) —
  detalle: tabla de cobertura por ámbito (editar/configurar por fila) +
  tabla de reglas de reparto (alta por código/categoría, fullCover).
- `apps/web/src/app/(clinical)/patients/[id]/insurance.tsx` (nuevo
  sub-componente) + tab "Seguros" agregado a
  `apps/web/src/app/(clinical)/patients/[id]/page.tsx` (mismo patrón que
  los tabs existentes "Cuentas"/"Consentimientos", que ya viven como
  sub-componentes de la vista 360° del paciente, no como rutas propias) —
  pólizas del paciente (alta + carnet/contratante/vigencia) con reglas por
  póliza expandibles inline.
- `apps/web/src/app/(clinical)/patients/[id]/cuentas.tsx` — agrega el
  desglose asegurado/paciente de `coberturaEstimada` bajo el resumen de
  liquidación existente, marcado explícitamente como estimado/no-descuenta.

## Importador desde Odoo (one-shot, idempotente, NO ejecutado)

`packages/database/scripts/import-odoo-seguros.mjs` — reutiliza el cliente
XML-RPC zero-dep de `packages/database/scripts/lib/odoo-xmlrpc.mjs` (el
mismo que usa `sync-tarifario-odoo.mjs`, extraído originalmente de
`packages/infrastructure/src/odoo/` — PR #255). Campos Odoo verificados
read-only vía `mcp__odoo__get_fields` el 2026-09-14 (`yolo_mode.level =
"read"`):

- `hms.insurance.company` → `Insurer` (GLOBAL, match por nombre normalizado
  — nunca por `code` de Odoo, que puede estar vacío/inconsistente).
- `acs.insurance.plan` → `InsurancePlan` (+ `code` = slug del nombre, Odoo
  no tiene un código corto) + `InsurancePlanCoverage` (`CONSULTA` si
  `allow_appointment_insurance`, `FARMACIA` si `allow_pharmacy_insurance`;
  `GENERAL` nunca se puebla desde Odoo) + `CoverageRule` de nivel-plan
  (`policy_rule_ids`) — **replicada una vez por cada organización real**,
  por la decisión de diseño de `CoverageRule.organizationId` explicada
  arriba.
- `hms.patient.insurance` → `PatientCoverage` **solo para pacientes que
  matcheen** (por `dui` normalizado contra `Patient.documentNumber` con
  `documentType=DUI`; si no hay DUI, por nombre normalizado exacto — 0 o
  >1 candidatos se reporta como AMBIGUO/SIN_MATCH y se omite, nunca se
  importa a ciegas). `validity` de Odoo es una fecha única (no rango) →
  se mapea a `validFrom`; `validTo` queda `NULL` (decisión v1, documentada
  en el script).
- `acs.insurance.policy.rule` → `CoverageRule` (a nivel de plan o de
  póliza según `insurance_plan_id`/`insurance_policy_id`); `rule_on=product`
  resuelve el código vía `product.template.default_code` (fallback:
  bracket `[COD]` del nombre, igual que `resolverCode()` de
  `odoo-tarifario-parser.mjs`); `rule_on=product_category` resuelve
  `ServiceCategory` vía `odooCategId` (columna sembrada en CC-0021).

Uso: `node --env-file=apps/web/.env.local packages/database/scripts/import-odoo-seguros.mjs`
(dry-run, default) / `--apply` (escribe). **Igual que
`seed-tarifario-odoo.mjs`: el agente que generó este script solo está
autorizado a correr `--dry-run`.** La corrida real la decide @Orq/Edwin con
el reporte en mano — no se ejecutó en esta sesión (no hay `apps/web/.env.local`
ni `DATABASE_URL` en el worktree de este agente).

## Pre-pr-review

Revisor independiente (agente `general-purpose`, contexto limpio, solo el
diff + checklist de `.claude/skills/pre-pr-review/SKILL.md`) sobre el diff
completo antes de commitear. Hallazgos y resolución:

- **[importante] SQL 235 sin la marca "APLICADO a prod — NO re-aplicar" en
  su propio header** (solo estaba en este doc) — el hook local
  `guard-sql-reapply` busca ese texto literal en el archivo SQL, no en la
  documentación. **Corregido**: se agregó la línea al header de
  `235_cc0028_seguros_operativos.sql`.
- **[importante] Importador no idempotente en `CoverageRule`/`PatientCoverage`**
  — `CoverageRule` no tiene `UNIQUE`, así que una segunda corrida de
  `--apply` duplicaría filas; `PatientCoverage` sí tiene `UNIQUE` pero el
  `create` sin buscar antes habría abortado el script a mitad de camino
  (P2002) en una re-corrida. **Corregido**: `crearReglaSiNoExiste()` (busca
  por llave natural completa antes de crear) + `PatientCoverage` busca por
  `(organizationId, patientId, policyNumber)` antes de crear.
- **[importante] `plan.create`/`coverage.create` seguían en `tenantProcedure`**
  mientras el resto de escrituras nuevas del CC subieron a `writerProc` —
  inconsistente, dado que este PR les agrega campos financieros
  (`priceListId`/`carnet`/`contratante`). **Corregido**: `plan.create` →
  `writerProc`; `coverage.create` → `coverageWriterProc` nuevo
  (`ADMIN`/`ACCOUNTANT`/`BILLING`, ver sección tRPC arriba).
- **[menor] contador `insurersActualizados` engañoso** en el importador —
  se incrementaba para aseguradoras YA existentes sin ningún `update()`.
  **Corregido**: renombrado a `insurersExistentes`.
- **[menor] `priceListId` sin validar tenancy** en `plan.create`/
  `coverage.create` (mismo gap preexistente que `TipoCuenta.priceListId`,
  extendido por este PR a 2 columnas más). **Corregido**: helper
  `assertPriceListVisible()` (raw SQL — `ServicePriceList` no tiene modelo
  Prisma) valida `organizationId` antes de guardar la FK lógica en ambos
  endpoints.

Sin hallazgos en: RLS (`withTenantContext` en todo lo nuevo), raw SQL
(columnas verificadas contra schema.prisma), `@updatedAt` con default
explícito en las 3 tablas nuevas, numeración SQL sin colisión, `schema.prisma`
sincronizado, enums Zod espejando los CHECK, tests ejercitando el código
nuevo (174 tests verdes tras los fixes), `SET search_path` en el trigger de
guardia, nombres de unique compuesto, adecuar-legacy-no-duplicar, y
`import-odoo-seguros.mjs` confirmado solo-lectura contra Odoo.

## Fuera de alcance

- Ciclo de `hms.insurance.claim` (0 registros en Odoo — confirmado por
  @Orq, no se replica).
- Cruce automático de `InsurancePlan.priceListId`/`PatientCoverage.priceListId`
  con `ServicePriceList` durante el importador — queda para asignación
  manual vía el admin de planes (`/insurance/plans/[id]`) o una iteración
  futura del importador.
- Matching de `CoverageRule` por categoría con jerarquía de ancestros
  (a diferencia del motor de precios, que sí sube por el árbol de
  `ServiceCategory`) — v1 solo matchea la categoría exacta del código.
- Reintentos/backfill automático de pólizas no matcheadas — el importador
  es re-corrible manualmente a medida que se registran más pacientes.

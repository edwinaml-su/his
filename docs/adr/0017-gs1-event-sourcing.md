# ADR 0017 — GS1: EPCIS Event Sourcing vs Queries sobre Tablas Operacionales

- **Estado:** Aceptado
- **Fecha:** 2026-05-17
- **Decisores:** @AS (proponente), @DBA, @Dev, @QA
- **Fase:** Fase 2 — Sprint F2-S6 (GS1 Trazabilidad Logística)
- **Dependencias:**
  - CLAUDE.md §"Audit hash chain" — patrón de inmutabilidad
  - ADR 0012 — Estrategia RLS ECE (patrón `withTenantContext`)
  - `packages/database/sql/73_epcis_event.sql` — implementación
  - `packages/trpc/src/routers/epcis.router.ts` — router de escritura/consulta

---

## Contexto

El estándar GS1 EPCIS (Electronic Product Code Information Services) define una estructura
de 5 campos para registrar eventos de trazabilidad: WHAT (identificadores de producto),
WHERE (locaciones GLN), WHEN (timestamp), WHY (bizStep + disposition) y WHO (actor).

HIS Avante necesita registrar eventos para cuatro tipos de movimiento:
- **ObjectEvent** — producto en un único GLN (recepción, cuarentena, merma).
- **AggregationEvent** — producto agrupado en pallet/SSCC.
- **TransactionEvent** — producto vinculado a una transacción de negocio (orden de compra, DESADV).
- **TransformationEvent** — producto que cambia de forma (fraccionamiento unidosis).

La pregunta es: ¿dónde y cómo se persiste esta información para que sea consultable,
inmutable y multi-tenant?

---

## Decision

**Tabla dedicada `EpcisEvent` inmutable con event sourcing: cada cambio de estado
logístico es un nuevo registro, nunca un UPDATE sobre registros anteriores.**

```prisma
model EpcisEvent {
  id             String         @id @default(cuid())
  eventType      EpcisEventType // ObjectEvent | AggregationEvent | TransactionEvent | TransformationEvent
  what           Json           // {gtins?, ssccs?, unitDoses?, inputs?, outputs?}
  where          Json           // {glnFrom?, glnTo?}
  when           DateTime       // ISO8601 con timezone America/El_Salvador
  why            Json           // {bizStep: String, disposition: String}
  who            Json           // {operatorId?, systemUser?, organizationId}
  organizationId String
  createdAt      DateTime       @default(now())
  // sin updatedAt — inmutable por diseño
  @@index([organizationId, when])
  @@index([organizationId])
}
```

El trigger de inmutabilidad en `73_epcis_event.sql` rechaza cualquier UPDATE o DELETE
a nivel de base de datos (`BEFORE UPDATE OR DELETE ON "EpcisEvent" RAISE EXCEPTION`),
equivalente al patrón del audit hash chain (CLAUDE.md §Audit).

Todos los routers GS1 (receiving, inventory, unitDose, returns) llaman a `epcis.create`
al final de cada operación exitosa. El evento EPCIS no es opcional — es parte del mismo
`prisma.$transaction` donde ocurre la mutación operacional.

---

## Alternativas consideradas

### A1. Queries directas sobre tablas operacionales para trazabilidad — descartada

**Idea:** para reconstruir la historia de un producto, hacer JOIN entre
`RecepcionMercancia`, `TransferenciaInventario`, `PreparacionUnidosis` y
`DevolucionInventario` filtrando por GTIN+lote.

**Razon de rechazo:**

- **Schema heterogéneo.** Cada tabla tiene columnas distintas para representar el
  mismo concepto (ubicacion, actor, timestamp). Un query de trazabilidad completo
  requeriría 4+ UNIONs con coerción de tipos, extremadamente frágil ante cambios de schema.
- **Sin modelo de eventos estándar.** El estándar EPCIS define bizStep y disposition
  como vocabulario controlado (GS1 CBV). Sin una tabla dedicada, cada tabla operacional
  implementaría el vocabulario de forma inconsistente.
- **Consultas MINSAL imposibles de satisfacer.** Si la autoridad sanitaria pide
  "todos los movimientos del lote X en las últimas 72h en formato EPCIS" se necesita
  una vista unificada. Construirla on-the-fly desde tablas operacionales a tiempo de
  consulta es O(n×tablas) y no escala ante auditorías de recall masivo.
- **Audit trail no garantizado.** Las tablas operacionales admiten UPDATE (cambio de
  estado de transferencia, por ejemplo). La historia de un producto podría ser alterada.

### A2. Cola de mensajes Kafka con EPCIS como eventos de dominio — descartada

**Idea:** cada operación publica un evento EPCIS a un topic Kafka; un consumidor
lo persiste en un store separado (Elasticsearch o ClickHouse).

**Razon de rechazo:**

- **Infraestructura injustificada para el volumen actual.** El hospital Avante procesa
  estimados de 500–2,000 eventos logísticos por día. Kafka es dimensionado para millones
  de eventos/segundo. La complejidad operacional (brokers, replication, consumer groups,
  schema registry) no se justifica.
- **Garantías de consistencia débiles.** En el modelo Kafka, si el producer falla después
  de confirmar la operación operacional pero antes de publicar el evento, el evento se
  pierde. La única forma de garantizar "operación + evento EPCIS" es una transacción
  Postgres (mismo enfoque que ADR 0008 para outbox Beta.15).
- **RLS no aplica.** El store externo (Elastic/ClickHouse) no tiene el mecanismo de RLS
  por `organizationId` del proyecto. Requeriría reimplementar multi-tenancy.
- **Fase 3 puede reconsiderar.** Si en Fase 3 se integra con el registro GS1 nacional
  de El Salvador o con sistemas de distribución de proveedores, el patrón outbox (ADR 0008)
  puede publicar eventos EPCIS hacia Kafka sin cambiar la tabla `EpcisEvent` local.

### A3. Schema EPCIS normalizado (tabla por tipo de evento) — descartada

**Idea:** `ObjectEventLog`, `AggregationEventLog`, `TransactionEventLog`,
`TransformationEventLog` como tablas separadas con columnas tipadas.

**Razon de rechazo:**

- **Consultas de trazabilidad cruzada complejas.** Una cadena de custodia típica de una
  unidosis incluye ObjectEvent (recepción) → TransactionEvent (DESADV) →
  TransformationEvent (fraccionamiento) → ObjectEvent (dispensación). Con tablas separadas,
  el query de trazabilidad requiere 4 tablas con UNION ALL — equivalente al problema de A1.
- **Over-engineering para vocabulario controlado.** Los campos `bizStep` y `disposition`
  son strings del vocabulario GS1 CBV. No hay beneficio de integridad referencial frente
  a normalizar en tablas separadas; una constraint CHECK sobre el enum `EpcisEventType`
  + validación en el router es suficiente.
- **Migración costosa.** Si el estándar EPCIS añade un nuevo tipo de evento (como lo hizo
  con AssociationEvent en EPCIS 2.0), con una tabla dedicada es un nuevo valor de enum;
  con tablas separadas es una migración de schema completa.

---

## Trade-offs

### Flexibilidad JSON vs. tipado fuerte

Los campos `what`, `where`, `why`, `who` son `Json` — no están tipados a nivel de BD.
Esto permite acomodar los 4 tipos de eventos sin columnas sparse (nullable para tipos
que no aplican).

Contrapartida: la validación del contenido Json ocurre en el router tRPC (Zod schema
por `eventType`), no en la BD. El router `epcis.create` rechaza payloads malformados
antes de persistir.

### Inmutabilidad vs. corrección de errores operacionales

Un operador que ingresa un lote incorrecto en recepción no puede borrar el evento EPCIS.
La corrección se modela como un nuevo evento con `bizStep:"void"` que referencia al
evento original via campo `why.voidEventId`. Este patrón es el estándar EPCIS para
correcciones — preserva el audit trail sin modificar registros anteriores.

### Storage vs. consistencia

La tabla `EpcisEvent` crece un registro por cada operación logística (no hay UPDATE).
Para el volumen estimado del hospital (500–2,000 eventos/día), 3 años de retención
son aproximadamente 2.2M registros — manejable con los índices definidos. Si el volumen
crece por integración con proveedores externos, se evalúa particionamiento por
`organizationId + when` en Fase 4.

---

## Consecuencias

### Positivas

- **Trazabilidad completa y consultable.** Un único `SELECT FROM "EpcisEvent"` con filtros
  por GTIN, lote, GLN o rango de fechas retorna la cadena de custodia completa sin JOINs.
- **Inmutabilidad garantizada por BD.** El trigger rechaza cualquier ALTER del registro
  incluso si el código de aplicación tiene un bug. Es la misma garantía que el audit
  hash chain del módulo HIS (CLAUDE.md §Audit).
- **Respuesta ante recall en < 30s.** El SLO de barrido GS1 se cumple porque el query
  de recall filtra solo `EpcisEvent` por GTIN+lote — no necesita cruzar múltiples tablas.
- **RLS multi-tenant nativo.** El campo `organizationId` en `EpcisEvent` + la política
  RLS generada en `73_epcis_event.sql` garantizan aislamiento sin lógica adicional
  en los routers de consulta.
- **Preparado para integración regulatoria.** Si MINSAL implementa una API EPCIS Query
  Interface (como el estándar define), HIS puede exponer los eventos sin transformación.

### Negativas / trade-offs

- **Sin queries SQL directos sobre `EpcisEvent` desde el ORM tipado.** Los campos Json
  requieren `prisma.$queryRaw` o post-procesamiento en TypeScript para filtros sobre
  el contenido interno (e.g., `where.glnTo = '74130000000018'`). Se añadieron índices
  GIN sobre los campos Json críticos para mitigar.
- **Duplicación de información con tablas operacionales.** El estado de una transferencia
  existe en `TransferenciaInventario.status` Y en los eventos EPCIS. La fuente de verdad
  para el estado actual es la tabla operacional; la fuente de verdad para el historial
  es `EpcisEvent`. Esta separación de responsabilidades debe documentarse en el runbook
  para evitar confusión en operaciones de soporte.
- **Sin UPDATE para correcciones de dato.** Los operadores deben entender el flujo de
  corrección via evento "void". Requiere documentación en manual de usuario y entrenamiento
  antes del UAT.

---

## Diseño de verificacion en CI

`packages/trpc/src/routers/__tests__/epcis.integration.test.ts` cubre:

1. Creación de ObjectEvent — persiste con los 5 campos y es inmutable (UPDATE rechazado).
2. Creación de TransformationEvent — campos `what.inputs` y `what.outputs` validados por Zod.
3. RLS — usuario de ORG-A no ve eventos de ORG-B.
4. Inmutabilidad — `prisma.$queryRaw('UPDATE "EpcisEvent" ...')` lanza error de BD.
5. Consulta por GTIN+rango de fechas — retorna eventos ordenados por WHEN ascendente.
6. Consulta por GLN — filtra correctamente `where->>'glnFrom'` OR `where->>'glnTo'`.

---

## Referencias

- CLAUDE.md §"Audit hash chain" — patrón de inmutabilidad en la BD
- ADR 0008 — Outbox pattern Beta.15 (modelo para event sourcing local)
- ADR 0012 — Estrategia RLS ECE (patrón `withTenantContext` reutilizado en EPCIS)
- GS1 EPCIS Standard 2.0 — `https://www.gs1.org/standards/epcis`
- GS1 Core Business Vocabulary (CBV) — vocabulario controlado para bizStep y disposition
- `packages/database/sql/73_epcis_event.sql` — tabla, trigger inmutabilidad, RLS, índices GIN
- `packages/trpc/src/routers/epcis.router.ts` — implementación tRPC
- `docs/backlog/fase2/07_epic_gs1_logistica.md` — US.F2.5.13, US.F2.5.39, US.F2.5.40, US.F2.5.41

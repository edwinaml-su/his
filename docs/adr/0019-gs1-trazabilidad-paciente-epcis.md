# ADR 0019 — GS1: Trazabilidad EPCIS del Movimiento Físico del Paciente

- **Estado:** Propuesto
- **Fecha:** 2026-08-18
- **Decisores:** @AS (proponente), @DBA, @Dev, @AE (dictamen normativo paralelo), @QA
- **Fase:** Fase 3+ — extensión GS1 sobre Fase 2 cerrada (F2-S6/S7)
- **Dependencias:**
  - ADR 0017 — GS1 EPCIS Event Sourcing (decisión base: tabla dedicada, inmutable, misma transacción)
  - ADR 0012 — Estrategia RLS ECE (`withTenantContext`)
  - CLAUDE.md §"Motor de workflow ECE" — JCI IPSG.1 wristband GSRN
  - `packages/database/sql/94_farmacovigilancia_epcis.sql` — tabla `ece.gs1_epcis_event`
  - `packages/database/sql/111_ipsg1_wristband_trigger.sql` — GSRN obligatorio antes de IND_MED
  - `packages/database/sql/168_gs1_gln_jerarquia.sql` — jerarquía GLN
  - `packages/database/sql/173_epcis_logistica_subtipos.sql` — patrón de extensión de subtipos
  - `packages/trpc/src/lib/epcis-builder.ts` — constructores de eventos existentes
  - **Dictamen normativo @AE (paralelo, pendiente)** — retención, base legal LPDP, DPIA. Este ADR deja placeholders explícitos donde ese dictamen es la autoridad.

---

## Contexto

HIS Avante tiene una implementación GS1 madura para **medicamentos** (Procesos D/E de la guía
GS1 Healthcare: dispensación y bedside) y para **equipos biomédicos**, pero el **paciente
aparece solo como atributo (`who.sourceList`/`destinationList`) de eventos ajenos** — nunca
como sujeto de su propio evento. El paciente tiene GSRN (AI 8018) asignado al confirmar
admisión (`Patient.gsrn`, `GsrnHistory`) y una pulsera física, pero su recorrido físico por el
hospital (admisión → traslados → alta) no genera ningún registro EPCIS.

Verificación de código (2026-08-18): `encounter-transfer.router.ts`, `encounter-discharge.router.ts`
y `encounter.router.ts` no tienen ninguna referencia a EPCIS. El único emisor clínico es
`bedside.router.ts` (administración de medicamento), que además **no usa** los builders de
`epcis-builder.ts` — inserta con SQL crudo inline (línea 968 de ese archivo). Este ADR no corrige
esa inconsistencia (fuera de alcance), pero el diseño nuevo **sí** usa los builders, estableciendo
el patrón correcto para que @Dev lo consolide después.

### Hallazgo colateral — tabla `ece.epcis_event` duplicada y router roto

Se verificó contra la base de producción (`ejacvsgbewcerxtjtwto`, vía MCP Supabase) que
**existen tres tablas** con "epcis_event" en el nombre, no dos:

| Tabla | Origen | Filas (prod) | Uso real en código |
|---|---|---|---|
| `ece.epcis_event` | Sin `CREATE TABLE` en ningún SQL numerado del repo (huérfana — probablemente una versión temprana de equipo, creada manualmente o vía script no versionado) | 0 | **Solo** `epcis-query.router.ts` (`queryByGln`, `queryByEquipment`, `queryByOrigin`, `queryRecent`, expuesto en `_app.ts` como `epcisQuery`) |
| `ece.epcis_event_equipment` | `82_equipment_gs1_extension.sql` | activa, con datos | `services-equipment.router.ts` (INSERT/SELECT reales) |
| `ece.gs1_epcis_event` | `94_farmacovigilancia_epcis.sql` | activa, con datos | `bedside.router.ts`, `farmacovigilancia.router.ts`, `gs1-lote-trace.router.ts` |

**Veredicto:** `ece.epcis_event` y `ece.epcis_event_equipment` son duplicado histórico —
mismas columnas (`equipment_id, gln_destino, gln_origen, registrado_por, registrado_en, notas`),
mismo propósito (movimiento de equipos), mismo comentario de tabla casi idéntico
(`"Eventos de movimiento/ubicación de equipos biomédicos (subconjunto EPCIS). Append-only."`
en `epcis_event` vs `"Bitácora de eventos EPCIS 2.0 para trazabilidad de equipos biomédicos..."`
en `epcis_event_equipment`). `epcis_event_equipment` es la que ganó la adopción real (`services-equipment.router.ts`
escribe ahí). `epcis_event` quedó huérfana con 0 filas — y el propio comentario de cabecera de
`94_farmacovigilancia_epcis.sql` ("Nota: ece.epcis_event ya existe como tabla legacy (equipment
tracker)") confirma que el autor de esa migración ya sabía de su existencia y decidió no tocarla.

**Consecuencia no anticipada:** `epcis-query.router.ts` apunta a la tabla huérfana `ece.epcis_event`,
no a `ece.epcis_event_equipment`. Es decir, **el router de consulta EPCIS de equipos wireado en
`_app.ts` y consumido por `/admin/gs1/trazabilidad` devuelve siempre 0 resultados en producción**
— un bug preexistente, no introducido por este ADR. Se documenta aquí porque es exactamente el
tipo de duplicado que este ADR debe evitar repetir, pero **su corrección queda fuera de alcance**
(no es una decisión de arquitectura, es un fix de una línea de router). Se reporta como hallazgo
independiente al cierre de esta tarea.

**Ninguna de las tres tablas es apta para trazabilidad de paciente sin modificación**, pero
`ece.gs1_epcis_event` es la única con la estructura completa EPCIS (WHAT/WHERE/WHEN/WHY/WHO,
`tipo_evento` con los 5 tipos EPCIS 2.0, hash de inmutabilidad, RLS activo) — es la que se
extiende en este ADR.

---

## Decisión

**Reutilizar `ece.gs1_epcis_event` emitiendo `ObjectEvent` con el GSRN del paciente como EPC en
`what.epcList`, en tres puntos del ciclo de encuentro (admisión, traslado, alta), con 4 subtipos
nuevos y builders dedicados en `epcis-builder.ts`.**

### D1. GSRN como EPC en `what`, no solo en `who`

El paciente pasa a aparecer como **EPC primario** (`what.epcList: ["urn:epc:id:gsrn:..."]`)
cuando el evento describe *su* movimiento, y se mantiene en `who` (como `possessing_party`) en
los eventos de medicación donde el sujeto real del evento es el medicamento. Ambos usos coexisten
sin conflicto — son eventos distintos con roles distintos para el mismo identificador.

**Formato URN verificado contra EPC Tag Data Standard** (no asumido de memoria):
`urn:epc:id:gsrn:CompanyPrefix.ServiceReference` — el dígito verificador **se omite** en la forma
URI pura (igual que el check digit de GTIN se omite en SGTIN URI). El GSRN persistido en
`Patient.gsrn` es de 18 dígitos (`CompanyPrefix + ServiceReference + CheckDigit`); para construir
la URN hay que conocer la longitud del `CompanyPrefix` (7–9 dígitos, variable por organización,
almacenado en `Organization.gs1CompanyPrefix`) para ubicar el punto de corte.

Nueva función pura en `epcis-builder.ts`:

```ts
/**
 * Convierte un GSRN-18 (con check digit) a su forma EPC pure-identity URI.
 * El check digit se descarta — no forma parte de la URI EPC (igual que SGTIN
 * descarta el check digit de GTIN). Ref: GS1 EPC Tag Data Standard.
 *
 * @param gsrn18 - 18 dígitos: CompanyPrefix + ServiceReference + CheckDigit
 * @param companyPrefixLength - longitud del CompanyPrefix de la organización (7-9)
 */
export function buildGsrnUrn(gsrn18: string, companyPrefixLength: number): string {
  if (!/^\d{18}$/.test(gsrn18)) {
    throw new Error(`GSRN debe ser 18 dígitos numéricos (recibido: ${gsrn18})`);
  }
  if (companyPrefixLength < 7 || companyPrefixLength > 9) {
    throw new Error(`companyPrefixLength fuera de rango 7-9 (recibido: ${companyPrefixLength})`);
  }
  const body = gsrn18.slice(0, 17); // descarta el check digit (posición 18)
  const companyPrefix = body.slice(0, companyPrefixLength);
  const serviceReference = body.slice(companyPrefixLength);
  return `urn:epc:id:gsrn:${companyPrefix}.${serviceReference}`;
}
```

**Impacto en `epcis-query.router.ts` / `gs1-lote-trace.router.ts`:** ninguno de los dos asume
hoy que `epcList` contiene solo SGTIN — `epcis-query.router.ts` ni siquiera lee `what` (usa el
schema legacy de equipos, ver hallazgo arriba); `gs1-lote-trace.router.ts` filtra por
`what->>'gtin'`, que simplemente no existirá en los eventos de movimiento de paciente y no rompe
sus queries. Un nuevo procedure de consulta (`gs1PatientTrace.router.ts`, fuera del router de
equipos) es responsabilidad de @Dev; este ADR solo fija el contrato de datos que ese router
deberá leer (ver D5).

### D2. Alcance del ciclo: admisión → traslado → alta

Se adopta la recomendación del encargo. Justificación adicional encontrada en el código: los
tres puntos ya son transacciones atómicas bien delimitadas (`encounter.router.ts` `admit`,
`encounter-transfer.router.ts` `transferEncounter`/`confirmReceipt`,
`encounter-discharge.router.ts` `dischargeEncounter`), lo cual hace que "media cadena" (ej. solo
admisión) no cueste menos implementar que el ciclo completo — el costo marginal de cubrir
traslado y alta es bajo porque la estructura transaccional ya existe. Cubrir menos dejaría un
grafo de custodia con huecos que JCI IPSG.1 (identificación correcta y trazabilidad del paciente)
no acepta como evidencia.

**No incluido en este alcance** (explícitamente fuera):
- Movimientos intra-servicio sin cambio de `Encounter.serviceUnitId`/`BedAssignment` (ej. salida
  a un procedimiento y regreso a la misma cama) — no hay hoy un modelo transaccional para esto,
  agregar tracking implicaría diseñar ese modelo primero (no es una extensión, es un feature nuevo).
- Defunción (`DeathCertificate`) — su discharge pasa por otro flujo (equipo Quito, US-5.6) no
  auditado en esta tarea; se recomienda un ADR de seguimiento si se requiere trazar ese caso.

### D3/D4. Tipo de evento, bizStep y disposition — verificados contra CBV, con desviación documentada

**Verificado contra fuentes GS1** (CBV 1.2/2.0, vía búsqueda — la especificación completa está
en PDF no legible por las herramientas disponibles en esta sesión, así que se corroboró contra
múltiples fuentes secundarias consistentes entre sí: GS1 US, Wholechain developer docs, OpenEPCIS):

- El vocabulario **`bizStep` es explícitamente de mercancías** ("goods or materials"), no tiene
  ningún valor para "admitir/dar de alta a una persona". Los valores estándar más cercanos
  semánticamente son `arriving` ("el momento en que la mercancía llega a un destino") y
  `departing` ("la mercancía sale de una ubicación"), además de `holding` ("mantener en
  almacenamiento temporal").
- El vocabulario **`disposition`** sí incluye estados sin connotación de mercancía:
  `active`, `in_progress`, `in_transit`, `inactive` (lista completa verificada:
  `active, container_closed, damaged, destroyed, dispensed, disposed, encoded, expired,
  in_progress, in_transit, inactive, no_pedigree_match, non_sellable_other,
  partially_dispensed, recalled, reserved, retail_sold, returned, sellable_accessible,
  sellable_not_accessible, stolen, unknown`).

**Decisión:** reutilizar `arriving`/`departing` para bizStep (es una adaptación documentada del
vocabulario de mercancías al paciente, no un uso "puro" del estándar — GS1 Healthcare no define
vocabulario específico de bizStep para movimiento de personas; esta es una práctica ya aceptada
en implementaciones de RTLS hospitalario que reutilizan CBV sobre GSRN, pero no es texto GS1
oficial y se documenta como tal, no como hecho verificado). Tabla de mapeo:

| Subtipo | tipo_evento | bizStep | disposition | Se emite en |
|---|---|---|---|---|
| `PATIENT_ADMISSION` | ObjectEvent | `arriving` | `active` | `encounter.router.ts admit` (hook GSRN, ver D7) |
| `PATIENT_TRANSFER_DEPARTURE` | ObjectEvent | `departing` | `in_transit` | `encounter-transfer.router.ts transferEncounter` |
| `PATIENT_TRANSFER_ARRIVAL` | ObjectEvent | `arriving` | `active` | `encounter-transfer.router.ts confirmReceipt` |
| `PATIENT_DISCHARGE` | ObjectEvent | `departing` | `inactive` | `encounter-discharge.router.ts dischargeEncounter` |

Los 4 usan **ObjectEvent** (no AggregationEvent/TransactionEvent/TransformationEvent/AssociationEvent):

- **No AggregationEvent/TransformationEvent** — el paciente no se agrupa ni se transforma
  físicamente; es el mismo EPC (GSRN) observado en ubicaciones distintas en el tiempo. Es la
  definición de libro de un ObjectEvent: WHAT+WHERE+WHEN+WHY+WHO de un objeto identificado.
- **No TransactionEvent** — no hay un documento de negocio (orden de compra, DESADV) al que
  vincular el movimiento; `SUBSTITUTION` en el código existente usa TransactionEvent porque
  referencia `bizTransactionList` con la indicación médica. Un traslado interno no tiene ese
  tipo de referencia — la referencia natural es al propio `EncounterTransfer.id`, que ya se
  modela mejor como `why.bizTransactionList` opcional dentro de un ObjectEvent (ver D5) que como
  motivo para cambiar de tipo de evento.
- **No AssociationEvent** — se evaluó explícitamente por ser la opción "obvia" para modelar
  paciente↔cama. Se descarta porque AssociationEvent está diseñado para vínculos padre-hijo
  **duraderos** (el ejemplo canónico verificado es equipar un cuarto frío con sensores de
  temperatura — bizStep `installing`), que requiere un evento explícito de desasociación
  (`action: DELETE`) para terminar el vínculo. Modelar cada traslado como
  disassociate(cama-origen) + associate(cama-destino) duplica la información que ya captura
  `where_data.readPoint`/`bizLocation` de un ObjectEvent, sin ganancia — es exactamente el tipo
  de over-engineering que ADR 0017 (alternativa A3) ya rechazó para el diseño de medicamentos.
  Si en el futuro se requiere modelar "qué equipos/dispositivos están asociados a este paciente
  durante su estancia" (ej. bomba de infusión, monitor), **ahí sí** AssociationEvent es el ajuste
  correcto — pero es un caso de uso distinto (equipo↔paciente, no paciente↔ubicación) y queda
  fuera de este ADR.

### D5. Tabla: `ece.gs1_epcis_event` (extender, no crear)

Se reutiliza `ece.gs1_epcis_event` por las razones ya cubiertas en ADR 0017 (inmutabilidad,
RLS, índices GIN, patrón de extensión de subtipo ya probado en SQL 173) y porque es la única de
las tres tablas EPCIS existentes con el shape completo. No se crea tabla nueva.

**DDL — nuevo archivo `packages/database/sql/199_epcis_patient_movement.sql`** (idempotente,
seguir el patrón exacto de `173_epcis_logistica_subtipos.sql`):

```sql
-- =====================================================================
-- 199_epcis_patient_movement.sql
-- EPCIS de movimiento de paciente — admisión, traslado, alta.
--
-- Amplía los subtipos de ece.gs1_epcis_event para cubrir el ciclo de
-- encuentro clínico donde el paciente (GSRN) es el EPC del evento, no
-- solo un actor en who. Ver ADR 0019.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

ALTER TABLE ece.gs1_epcis_event DROP CONSTRAINT IF EXISTS gs1_epcis_event_subtipo_check;
ALTER TABLE ece.gs1_epcis_event
  ADD CONSTRAINT gs1_epcis_event_subtipo_check
  CHECK (subtipo IN (
    -- Procesos D/E (farmacia + bedside)
    'BEDSIDE_ADMIN', 'PHARMACY_DISPENSE', 'RESERVATION', 'SUBSTITUTION', 'RETURN',
    -- Procesos logísticos A/B/C (Nivel 3 GS1 El Salvador)
    'RECEPTION', 'QUARANTINE', 'STORAGE', 'FRACTIONATION',
    -- Movimiento de paciente (ADR 0019)
    'PATIENT_ADMISSION', 'PATIENT_TRANSFER_DEPARTURE',
    'PATIENT_TRANSFER_ARRIVAL', 'PATIENT_DISCHARGE'
  ));

COMMENT ON COLUMN ece.gs1_epcis_event.subtipo IS
  'Subtipo operacional. Farmacia/bedside: BEDSIDE_ADMIN|PHARMACY_DISPENSE|RESERVATION|'
  'SUBSTITUTION|RETURN. Logística: RECEPTION|QUARANTINE|STORAGE|FRACTIONATION. '
  'Paciente: PATIENT_ADMISSION|PATIENT_TRANSFER_DEPARTURE|PATIENT_TRANSFER_ARRIVAL|'
  'PATIENT_DISCHARGE.';

-- Índice para trazabilidad "cadena de custodia de un paciente" — filtrar
-- eventos PATIENT_* por GSRN dentro de what.epcList (GIN ya existe sobre what,
-- pero se agrega un índice funcional para el patrón de consulta más frecuente).
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_event_patient_epc
  ON ece.gs1_epcis_event ((what->'epcList'))
  WHERE subtipo IN (
    'PATIENT_ADMISSION', 'PATIENT_TRANSFER_DEPARTURE',
    'PATIENT_TRANSFER_ARRIVAL', 'PATIENT_DISCHARGE'
  );
```

**Forma exacta de los jsonb** (contrato para el builder, ver D6):

```jsonc
// what
{
  "epcList": ["urn:epc:id:gsrn:7503000.0001234"],
  "gsrn": "750300000012349"        // el GSRN-18 completo, con check digit, para lectura humana
}

// where_data
{
  "readPoint": "urn:epc:id:sgln:7503000000018" ,  // GLN del punto donde se registró el evento; null si no resuelto (ver D8)
  "bizLocation": "urn:epc:id:sgln:7503000000032",  // GLN de destino lógico tras el evento; null si no resuelto
  "internalRef": {                                  // NO-GS1 — solo mientras el catálogo de GLN de camas/servicios no está sembrado (ver D8/riesgos)
    "bedId": "uuid-o-null",
    "serviceUnitId": "uuid-o-null",
    "establishmentId": "uuid"
  }
}

// why
{
  "businessStep": "arriving",       // arriving | departing (ver D3/D4)
  "disposition": "active",          // active | in_transit | inactive (ver D3/D4)
  "bizTransactionList": [
    { "type": "encounter", "id": "<Encounter.id>" },
    { "type": "transfer", "id": "<EncounterTransfer.id>" }  // solo en PATIENT_TRANSFER_*
  ]
}

// who
{
  "sourceList": [
    { "type": "urn:epcglobal:cbv:sdt:possessing_party", "gsrn": "<GSRN-18 paciente>" }
  ],
  "recordedById": "<User.id>"       // NO PHI — solo el actor que registró el evento (enfermera/admisión)
}
```

**Minimización deliberada:** no se incluye nombre, documento, ni ningún dato demográfico del
paciente en `what`/`who` — solo el GSRN (identificador indirecto, ya el estándar del proyecto
para pulsera) y IDs internos (`Encounter.id`, `EncounterTransfer.id`) que requieren una consulta
adicional autorizada para resolver a un paciente. Esto es consistente con el pedido explícito
del encargo.

### D6. Firmas nuevas en `packages/trpc/src/lib/epcis-builder.ts`

Se añade un input type y un builder, siguiendo exactamente el patrón de `buildLogisticsEvent`
(tabla de bizStep/disposition por subtipo + una función):

```ts
export type PatientMovementSubtipo =
  | "PATIENT_ADMISSION"
  | "PATIENT_TRANSFER_DEPARTURE"
  | "PATIENT_TRANSFER_ARRIVAL"
  | "PATIENT_DISCHARGE";

// Extender la unión existente:
// export type EpcisSubtipo = BedsideEventType | LogisticsSubtipo | PatientMovementSubtipo;

export interface EpcisPatientMovementInput {
  type: PatientMovementSubtipo;
  /** GSRN-18 completo (con check digit) del paciente. */
  gsrnPaciente: string;
  /** Longitud del CompanyPrefix de la organización (7-9) — para construir la URN EPC. */
  companyPrefixLength: number;
  /** GLN-13 del punto donde se registra el evento. Null si no resuelto (ver ADR 0019 D8). */
  glnReadPoint: string | null;
  /** GLN-13 de la ubicación lógica de destino tras el evento. Null si no resuelto. */
  glnBizLocation: string | null;
  /** Fallback no-GS1 mientras el catálogo GLN de cama/servicio no está sembrado. */
  internalRef: {
    bedId: string | null;
    serviceUnitId: string | null;
    establishmentId: string; // public.Establishment.id (NO ece.establecimiento.id)
  };
  encounterId: string;
  /** Solo para PATIENT_TRANSFER_DEPARTURE / PATIENT_TRANSFER_ARRIVAL. */
  transferId?: string;
  recordedById: string;
  timestamp: Date;
  /** ece.establecimiento.id (tenant EPCIS) — resolver con resolveEceEstablecimientoId antes de llamar. */
  establecimientoId: string;
}

const PATIENT_MOVEMENT_STEP: Record<
  PatientMovementSubtipo,
  { businessStep: string; disposition: string }
> = {
  PATIENT_ADMISSION:           { businessStep: "arriving",  disposition: "active" },
  PATIENT_TRANSFER_DEPARTURE:  { businessStep: "departing", disposition: "in_transit" },
  PATIENT_TRANSFER_ARRIVAL:    { businessStep: "arriving",  disposition: "active" },
  PATIENT_DISCHARGE:           { businessStep: "departing", disposition: "inactive" },
};

export function buildPatientMovementEvent(
  input: EpcisPatientMovementInput,
): EpcisEventRow {
  const gsrnUrn = buildGsrnUrn(input.gsrnPaciente, input.companyPrefixLength);

  const what = {
    epcList: [gsrnUrn],
    gsrn: input.gsrnPaciente,
  };

  const whereData = {
    readPoint: input.glnReadPoint ? glnUrn(input.glnReadPoint) : null,
    bizLocation: input.glnBizLocation ? glnUrn(input.glnBizLocation) : null,
    internalRef: input.internalRef,
  };

  const step = PATIENT_MOVEMENT_STEP[input.type];
  const bizTransactionList: { type: string; id: string }[] = [
    { type: "encounter", id: input.encounterId },
  ];
  if (input.transferId) {
    bizTransactionList.push({ type: "transfer", id: input.transferId });
  }

  const why = {
    businessStep: step.businessStep,
    disposition: step.disposition,
    bizTransactionList,
  };

  const who = {
    sourceList: [
      { type: "urn:epcglobal:cbv:sdt:possessing_party", gsrn: input.gsrnPaciente },
    ],
    recordedById: input.recordedById,
  };

  const fullPayload = { what, whereData, why, who };

  return {
    tipo_evento: "ObjectEvent",
    subtipo: input.type,
    what,
    where_data: whereData,
    event_time: input.timestamp,
    why,
    who,
    payload_hash: computeHash(fullPayload),
    indication_id: null,
    establecimiento_id: input.establecimientoId,
  };
}
```

Nota de tipos: `EpcisEventRow.subtipo` está tipado `EpcisSubtipo` — hay que extender esa unión
(`BedsideEventType | LogisticsSubtipo | PatientMovementSubtipo`) en el mismo archivo. Sin este
cambio el compilador rechaza el `subtipo: input.type` de arriba.

### D7. Puntos de integración exactos y transaccionalidad

| Evento | Archivo | Procedure | Línea de referencia (estado actual) | ¿Bloqueante? |
|---|---|---|---|---|
| `PATIENT_ADMISSION` | `packages/trpc/src/routers/encounter.router.ts` | `admit` | Dentro del hook `withTenantContext` de asignación de GSRN, después de `tx.patient.update({ data: { gsrn } })` (línea ~276-278) | **No** (best-effort, ver justificación abajo) |
| `PATIENT_TRANSFER_DEPARTURE` | `packages/trpc/src/routers/encounter-transfer.router.ts` | `transferEncounter` | Dentro de `ctx.prisma.$transaction`, después de crear `EncounterTransfer` (línea ~139) y antes/junto al `emitDomainEvent` de outbox (línea ~144) | **Sí**, misma tx |
| `PATIENT_TRANSFER_ARRIVAL` | `packages/trpc/src/routers/encounter-transfer.router.ts` | `confirmReceipt` | Dentro de `ctx.prisma.$transaction`, después de `tx.encounterTransfer.update({status:'RECEIVED'})` (línea ~350) | **Sí**, misma tx |
| `PATIENT_DISCHARGE` | `packages/trpc/src/routers/encounter-discharge.router.ts` | `dischargeEncounter` | Dentro de `ctx.prisma.$transaction`, después de `tx.encounter.update({dischargedAt,...})` (línea ~115) | **Sí**, misma tx |

**Por qué admisión es best-effort y traslado/alta no:**

La asignación de GSRN (`Patient.gsrn`) **ya es best-effort en el código actual** — corre en una
`withTenantContext` separada de la transacción principal de admisión, envuelta en
`.catch(() => {})` (encounter.router.ts, líneas 246-282), explícitamente para "no bloquear la
creación del encuentro". El comentario en línea 244 lo dice: *"TX separada — no bloquea la
admisión si el GSRN falla"*. Esto significa que en el momento en que `admit` corre, **el GSRN
puede no existir todavía** — es un requisito físico (imprimir/pegar pulsera) que ocurre después.
No se puede construir un ObjectEvent con EPC=GSRN sin GSRN. La opción de restructurar el flujo de
admisión para que el GSRN se asigne de forma síncrona y bloqueante está fuera de alcance de este
ADR (cambiaría una decisión de UX/operación ya tomada, no solo agregar trazabilidad) — se señala
como riesgo, no se decide aquí.

En cambio, para el momento en que un `transferEncounter`/`confirmReceipt`/`dischargeEncounter`
puede ejecutarse, el paciente **ya debe tener GSRN** por construcción del flujo clínico: el
trigger `fn_assert_wristband_gsrn` (SQL 111) bloquea cualquier indicación médica sin GSRN, y en
la práctica el traslado/alta ocurren después de que el paciente ya está bajo cuidado activo. Por
eso estos tres eventos sí van **dentro de la misma transacción** que la mutación clínica,
replicando el mandato de ADR 0017 ("el evento EPCIS no es opcional — es parte del mismo
`prisma.$transaction`"): si el traslado se registra, el evento EPCIS se registra; si el insert
EPCIS falla, la transacción completa revierte (el traslado no ocurrió). La alternativa
(insertar el evento en una tx separada tolerante a fallos) dejaría huecos en la cadena de
custodia — inaceptable para JCI IPSG.1 según el propio encargo.

**Excepción defensiva:** si en el momento de `transferEncounter`/`confirmReceipt`/
`dischargeEncounter` el paciente **no** tiene GSRN (porque la asignación best-effort de admisión
falló silenciosamente — ver riesgo en la sección final), la mutación clínica **no debe fallar**
por eso. Se registra el evento EPCIS igual, pero con `what.epcList: []` y `what.gsrn: null`
— o, más simple y consistente con el resto del sistema (que no modela "eventos sin EPC"), se
**omite la emisión del evento EPCIS para ese caso puntual** (log de advertencia, no excepción) y
se dejan las columnas de auditoría (`AuditLog`, outbox) como único rastro. Esta es una decisión
de compromiso: prioriza no bloquear la operación clínica por un gap del programa de pulseras.
Documentado como riesgo aceptado, no oculto.

### D8. Resolución de GLN de servicio/cama — gap real, sin datos de precedente

Se verificó que **ni `ServiceUnit` ni `Bed` tienen columna GLN** en el schema actual, y que
`ece.gs1_gln` está **vacía en producción (0 filas)** — no hay ninguna convención de nombres o
datos existentes de los que inferir un mapeo. El brief anticipaba este gap correctamente.

**Decisión:** agregar columnas `glnCodigo` nullable a `ServiceUnit` y `Bed`, FK a
`ece.gs1_gln(codigo)`, replicando el patrón ya usado en `BiomedicalEquipment.gln_ubicacion_actual`
(SQL 82):

```prisma
// ServiceUnit — agregar:
glnCodigo String? @db.VarChar(13)
// Bed — agregar:
glnCodigo String? @db.VarChar(13)
```

```sql
-- Parte de 199_epcis_patient_movement.sql
ALTER TABLE public."ServiceUnit"
  ADD COLUMN IF NOT EXISTS "glnCodigo" text
    CONSTRAINT fk_serviceunit_gln REFERENCES ece.gs1_gln(codigo) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public."Bed"
  ADD COLUMN IF NOT EXISTS "glnCodigo" text
    CONSTRAINT fk_bed_gln REFERENCES ece.gs1_gln(codigo) DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_serviceunit_gln ON public."ServiceUnit" ("glnCodigo") WHERE "glnCodigo" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bed_gln ON public."Bed" ("glnCodigo") WHERE "glnCodigo" IS NOT NULL;
```

Resolución en cascada (nueva función, sugerida en `packages/trpc/src/lib/epcis-builder.ts` o un
`gln-resolver.ts` adjunto — decisión de archivo la deja @Dev):

```ts
/**
 * Resuelve el GLN aplicable para un movimiento de paciente, en cascada:
 * cama → servicio → null (sin fallback de establecimiento: ece.establecimiento
 * no tiene columna GLN propia y no se agrega en este ADR — ver riesgos).
 */
export async function resolveLocationGln(
  tx: PrismaLike,
  input: { bedId?: string | null; serviceUnitId?: string | null },
): Promise<string | null> {
  if (input.bedId) {
    const bed = await tx.bed.findUnique({
      where: { id: input.bedId },
      select: { glnCodigo: true },
    });
    if (bed?.glnCodigo) return bed.glnCodigo;
  }
  if (input.serviceUnitId) {
    const su = await tx.serviceUnit.findUnique({
      where: { id: input.serviceUnitId },
      select: { glnCodigo: true },
    });
    if (su?.glnCodigo) return su.glnCodigo;
  }
  return null;
}
```

**Esto es deliberadamente no-bloqueante**: mientras el catálogo `ece.gs1_gln` no esté sembrado con
GLNs reales de servicios/camas (tarea operacional, no de este ADR), todos los eventos
`PATIENT_*` se emiten con `where_data.readPoint`/`bizLocation` en `null` y `internalRef` cargado
con los IDs internos. El evento sigue siendo válido y consultable (WHO/WHEN/WHY completos,
WHERE parcial) — no se sacrifica todo el trazado por falta de un catálogo que hoy no existe.
**Se marca como prerequisito operacional para conformidad GS1 completa**, no como bloqueante de
esta implementación.

---

## Consideraciones de privacidad (puntos de control que este diseño requiere — no resuelve)

Este ADR es de diseño técnico; la base legal, retención y DPIA son responsabilidad del dictamen
paralelo de @AE bajo la Ley de Protección de Datos Personales de El Salvador. Puntos de control
que el diseño **deja explícitos** para que ese dictamen los fije:

1. **RLS:** no requiere policy nueva — se hereda `gs1_epcis_event_select`/`_insert`
   (tenant-scoped por `establecimiento_id`, SQL 94). Suficiente para aislamiento entre
   organizaciones, **no** para restringir *quién dentro de la organización* puede reconstruir el
   recorrido físico de un paciente específico — eso requiere autorización a nivel de aplicación
   (ver punto 3).
2. **Retención:** `ece.gs1_epcis_event` no tiene política de retención/purga definida hoy (es
   inmutable indefinidamente, igual que el resto de eventos EPCIS). Trazar ubicación+tiempo de
   una persona identificable puede requerir una retención **distinta** (probablemente más corta)
   que la de trazabilidad de producto — **placeholder explícito**: este ADR no fija un número de
   días/años; lo fija el dictamen de @AE.
3. **Quién consulta:** se recomienda que el router de consulta nuevo (`gs1PatientTrace.router.ts`
   o similar, no construido en este ADR) use `requireRole` con un set de roles **más restrictivo**
   que el `["DIR","ARCH","ADMIN"]` de `epcisQueryRouter` (pensado para trazabilidad de *equipos*,
   no de personas) — candidato natural: agregar el propio equipo tratante del episodio activo, no
   solo roles administrativos. La lista exacta de roles la debe fijar @AE/@PO junto con Seguridad
   (ver `CC-0017` — el proyecto ya tiene un sistema RBAC/ABAC parametrizable donde esto encaja).
4. **Minimización:** ya aplicada en el shape de D5 — solo GSRN + IDs internos, cero PHI directa
   en los jsonb.

---

## Qué se verificó contra el estándar real vs. qué se asumió

**Verificado (con fuentes, no memoria):**
- Sintaxis EPC pure-identity de GSRN: `urn:epc:id:gsrn:CompanyPrefix.ServiceReference`, sin check
  digit — confirmado por múltiples fuentes (GS1 US EPC Encoder docs, EPC Tag Data Standard).
- Vocabulario `bizStep` completo de la CBV es de mercancías; `arriving`/`departing` existen con
  esa semántica textual ("goods or materials"/"goods leaving a location") — confirmado.
- Vocabulario `disposition` estándar (lista de 22 valores) — confirmado, incluye `active`,
  `in_transit`, `inactive`, `in_progress`.
- Definición y caso de uso canónico de `AssociationEvent` (vínculo padre-hijo durable, ejemplo de
  sensores en cuarto frío) — confirmado, vía JSON Schema oficial del repo `gs1/EPCIS` en GitHub.
- Estado real de las tablas `ece.epcis_event` / `ece.epcis_event_equipment` / `ece.gs1_epcis_event`
  y de `ece.gs1_gln`, `ServiceUnit`, `Bed` — verificado directamente contra la base de producción
  vía MCP Supabase (`information_schema`, conteos de filas), no inferido del código only.

**Asumido / no verificable con las herramientas de esta sesión (declarado explícitamente):**
- El texto completo y literal de la especificación CBV 1.2/2.0 está en PDFs que las herramientas
  de esta sesión no pudieron parsear (devuelven contenido binario). Los valores de vocabulario se
  corroboraron contra 3+ fuentes secundarias independientes y consistentes entre sí (GS1 US,
  Wholechain, búsquedas directas de las URNs `urn:epcglobal:cbv:bizstep:*`), pero no se citó
  directamente el PDF oficial. Si @QA/@AE tienen acceso a la especificación en texto plano, vale
  la pena una verificación adicional antes de construir, específicamente de la lista completa de
  `disposition` (se encontraron 22 valores, no se pudo confirmar que sea *exhaustiva* en la
  versión CBV vigente 2.0 vs. 1.2).
- Que reutilizar `arriving`/`departing` de mercancías para personas sea una práctica "aceptada" en
  RTLS hospitalario se afirma por conocimiento general de la industria GS1 Healthcare, **no** se
  encontró una guía GS1 Healthcare específica que lo prescriba para El Salvador o genérico. Se
  declara como adaptación, no como cumplimiento textual del estándar.

---

## Riesgos y fuera de alcance

- **Gap de cobertura por asignación de GSRN best-effort.** Si el hook de admisión falla
  silenciamente (ej. `Organization.gs1CompanyPrefix` mal configurado no bloquea, usa fallback; pero
  otros errores sí se tragan por el `.catch(() => {})`), un paciente puede llegar a traslado/alta
  sin GSRN y sin evento `PATIENT_ADMISSION`. Mitigación parcial ya existente en el sistema: el
  trigger IPSG.1 (SQL 111) fuerza GSRN antes de cualquier indicación médica — pero traslado/alta
  no pasan por ese trigger. Fuera de alcance: instrumentar alertas de "encuentro sin GSRN" es un
  US nuevo, no arquitectura.
- **GLN de servicios/camas sin sembrar (D8).** La trazabilidad WHERE queda degradada a IDs
  internos hasta que se ejecute la carga del catálogo `ece.gs1_gln` para las unidades del
  hospital. Es una tarea operacional (@DBA/@SRE/ops), no de este ADR.
- **`epcis-builder.ts` no está conectado a `bedside.router.ts` hoy** (usa SQL crudo inline en vez
  de `buildBedsideEvent`). Este ADR no lo corrige — lo señala para que @Dev decida si consolida
  al implementar los builders nuevos (sería el momento natural de alinear ambos).
- **Bug preexistente en `epcis-query.router.ts`** (apunta a la tabla huérfana `ece.epcis_event`,
  siempre vacía) — reportado como hallazgo independiente, no corregido aquí.
- **Consulta/UI de trazabilidad de paciente** (`gs1PatientTrace.router.ts`, pantalla admin) no se
  diseña en detalle en este ADR más allá del contrato de datos (D5) y la restricción de roles
  (privacidad, punto 3) — es responsabilidad de implementación de @Dev/@UIUX.
- **Retención y base legal** — explícitamente delegado al dictamen de @AE, no decidido aquí.

---

## Referencias

- ADR 0017 — GS1 EPCIS Event Sourcing
- ADR 0012 — Estrategia RLS ECE
- `packages/database/sql/94_farmacovigilancia_epcis.sql`
- `packages/database/sql/111_ipsg1_wristband_trigger.sql`
- `packages/database/sql/168_gs1_gln_jerarquia.sql`
- `packages/database/sql/173_epcis_logistica_subtipos.sql`
- `packages/database/sql/82_equipment_gs1_extension.sql`
- `packages/trpc/src/lib/epcis-builder.ts`
- `packages/trpc/src/routers/encounter.router.ts`
- `packages/trpc/src/routers/encounter-transfer.router.ts`
- `packages/trpc/src/routers/encounter-discharge.router.ts`
- `packages/trpc/src/routers/epcis-query.router.ts`
- `packages/trpc/src/lib/ece-hooks.ts` (`resolveEceEstablecimientoId`)
- GS1 EPC Tag Data Standard — sintaxis EPC pure-identity URI
- GS1 Core Business Vocabulary (CBV) — bizStep/disposition (verificación parcial, ver sección de fuentes)
- `gs1/EPCIS` (GitHub, JSON Schema oficial) — definición de `AssociationEvent`

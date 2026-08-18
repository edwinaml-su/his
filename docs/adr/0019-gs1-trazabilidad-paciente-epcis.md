# ADR 0019 — GS1: Trazabilidad EPCIS del Movimiento Físico del Paciente

- **Estado:** Aceptado (revisado post-dictamen @AE)
- **Fecha:** 2026-08-18 (revisión sobre versión inicial del mismo día)
- **Decisores:** @AS (proponente), @DBA, @Dev, @AE (dictamen normativo — condiciones incorporadas), @QA, @Orq (resolución del conflicto D5)
- **Fase:** Fase 3+ — extensión GS1 sobre Fase 2 cerrada (F2-S6/S7)
- **Dependencias:**
  - ADR 0017 — GS1 EPCIS Event Sourcing (decisión base para farmacia; **no aplicable sin más** al stream de paciente, ver D5)
  - ADR 0012 — Estrategia RLS ECE (`withTenantContext`)
  - CLAUDE.md §"Motor de workflow ECE" — JCI IPSG.1 wristband GSRN
  - `packages/database/sql/94_farmacovigilancia_epcis.sql` — tabla `ece.gs1_epcis_event` (farmacia — ya no target de este ADR, ver D5)
  - `packages/database/sql/111_ipsg1_wristband_trigger.sql` — GSRN obligatorio antes de IND_MED
  - `packages/database/sql/168_gs1_gln_jerarquia.sql` — jerarquía GLN
  - `packages/database/sql/173_epcis_logistica_subtipos.sql` — patrón de extensión de subtipos (usado como referencia de estilo, no de destino)
  - `packages/trpc/src/lib/epcis-builder.ts` — constructores de eventos existentes
  - **`docs/audit/2026-08-18_dictamen_ae_epcis_trazabilidad_paciente.md`** (commit `c8adfa6`) — dictamen de cumplimiento @AE, entrada de gate no negociable. Este ADR fue revisado para satisfacer sus 11 restricciones (§4 de ese documento); ver sección "Cumplimiento" al final.

**Nota de revisión:** la versión inicial de este ADR (misma fecha) proponía reutilizar
`ece.gs1_epcis_event` (D5 original) para el stream de paciente. El dictamen de @AE, producido en
paralelo, estableció como condición no negociable que el stream de ubicación de paciente **no**
puede heredar el trigger de inmutabilidad `BEFORE UPDATE OR DELETE` de ADR 0017 (incompatible con
ARCO/supresión bajo la LPDP). Como ese trigger es a nivel de tabla y no se puede exceptuar por
subtipo sin debilitarlo para farmacia, @Orq resolvió el conflicto ordenando tabla separada. D5 fue
reescrita en consecuencia; D6-D8 se ajustaron donde correspondía. D1-D4 (GSRN como EPC, alcance
admisión→traslado→alta, ObjectEvent, bizStep/disposition) no cambiaron — fueron aprobadas sin
observaciones.

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

**Para cuando @Orq empaquete el fix junto con la implementación de este ADR** (instrucción
explícita, no se corrige aquí): el fix correcto es repuntar las 4 queries de `epcis-query.router.ts`
de `ece.epcis_event` → `ece.epcis_event_equipment` (mismo shape de columnas, es el reemplazo
directo). **No** extender ese mismo router para cubrir el stream de paciente de este ADR — ver D5
para la razón (tabla y control de acceso distintos).

**Ninguna de las tres tablas es apta para trazabilidad de paciente sin modificación** — y, como
establece el dictamen @AE §1 (Application Architecture) y §3.5, **tampoco es correcto extender
`ece.gs1_epcis_event`** aunque sea la única con el shape EPCIS completo: mezclaría, bajo el mismo
trigger de inmutabilidad, un stream de producto (base de licitud RTCA, sin necesidad de erasure) con
un stream de personas (LPDP, con derecho de supresión). Ver D5 para la tabla nueva.

---

## Decisión

**Tabla nueva `ece.gs1_epcis_patient_event` (no `ece.gs1_epcis_event`), emitiendo `ObjectEvent` con
el GSRN del paciente como EPC en `what.epcList`, en tres puntos del ciclo de encuentro (admisión,
traslado, alta), con builders dedicados en `epcis-builder.ts`. Sin trigger de inmutabilidad ni
cadena hash — purgable/anonimizable bajo un proceso administrativo controlado (dictamen @AE §3.5).**

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

### D5. Tabla: `ece.gs1_epcis_patient_event` (nueva, separada de farmacia) — REVISADA por dictamen @AE

**Esta decisión cambió respecto a la versión inicial del ADR.** El razonamiento original
("reutilizar antes que crear", ADR 0017 ya resolvió cómo persistir eventos EPCIS inmutables) sigue
siendo válido *como principio general* — pero el dictamen @AE (§1 Data/Application Architecture,
§3.5) identificó una incompatibilidad de cumplimiento que ese principio no puede resolver por sí
solo: `ece.gs1_epcis_event` tiene un trigger `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION`
(`ece.fn_gs1_epcis_event_immutable`, SQL 94) que existe **correctamente** para farmacia — cadena de
custodia de medicamentos, recall regulatorio, base de licitud RTCA que no contempla erasure — pero
que convertiría el rastro de ubicación de una persona identificable en algo que **ni siquiera una
orden de la Agencia de Ciberseguridad del Estado (autoridad LPDP) podría hacer cumplir**: no hay
forma de purgar o anonimizar una fila protegida por ese trigger sin alterar la función del trigger
mismo, lo cual debilitaría la garantía para farmacia. Un `CASE WHEN subtipo NOT LIKE 'PATIENT_%'`
dentro del trigger fue considerado y descartado — condicionar la inmutabilidad de una tabla
regulatoria por el valor de una columna es frágil (un subtipo mal escrito en un INSERT futuro
degradaría silenciosamente la garantía de farmacia) y no es lo que @AE pidió: la condición es
"tabla propia", no "excepción dentro de la tabla existente" (dictamen §4, restricción 2).

**Decisión:** tabla nueva `ece.gs1_epcis_patient_event`. Mismo shape de 5 dimensiones
(`what`/`where_data`/`why`/`who`, `event_time`/`record_time`, `establecimiento_id`) que
`ece.gs1_epcis_event` — la estructura EPCIS de ADR 0017 sigue siendo correcta y se reutiliza — pero
**sin** el trigger de inmutabilidad y **sin** encadenamiento con `audit.audit_log`. Se agrega
`status` con un tercer valor (`SUPPRESSED`, además de `COMMITTED`/`VOIDED`) para representar el
resultado de una solicitud ARCO de supresión aprobada.

`payload_hash` se conserva — pero con un propósito distinto y así se documenta explícitamente:
**detección de corrupción de una fila individual, no cadena de inmutabilidad.** No hay
`prev_hash`/`chain_hash` (eso es exclusivo de `audit.audit_log`, SQL 05, y nunca aplicó aquí ni en
`ece.gs1_epcis_event`); conservar el hash de contenido no crea ningún compromiso de inmutabilidad
y no impide `UPDATE`/purga.

**DDL — nuevo archivo `packages/database/sql/199_epcis_patient_movement.sql`** (idempotente;
reutiliza el shape de columnas de `94_farmacovigilancia_epcis.sql` pero **sin** el bloque de
trigger de inmutabilidad de ese archivo):

```sql
-- =====================================================================
-- 199_epcis_patient_movement.sql
-- EPCIS de movimiento de paciente — admisión, traslado, alta.
--
-- Tabla SEPARADA de ece.gs1_epcis_event (farmacia) por mandato del
-- dictamen @AE (docs/audit/2026-08-18_dictamen_ae_epcis_trazabilidad_paciente.md,
-- §3.5, restricción 2): el stream de ubicación de un paciente identificable
-- no puede heredar el trigger de inmutabilidad hash de ADR 0017 — debe ser
-- purgable/anonimizable ante una solicitud ARCO de supresión (SolicitudArco,
-- portal-arco.router.ts). Los registros fuente (Encounter, EncounterTransfer,
-- BedAssignment) NO se tocan — siguen protegidos por retención NTEC Art. 6.
-- Esta tabla es una PROYECCIÓN DERIVADA de esos registros, no la fuente legal.
--
-- Ver ADR 0019 (revisión post-dictamen) para el razonamiento completo.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ece.gs1_epcis_patient_event (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Todos los subtipos de este stream son ObjectEvent (ver D3/D4) — el CHECK
  -- no necesita la lista de 5 tipos EPCIS completa que sí requiere farmacia.
  tipo_evento        text        NOT NULL DEFAULT 'ObjectEvent'
                       CHECK (tipo_evento = 'ObjectEvent'),
  subtipo            text        NOT NULL
                       CHECK (subtipo IN (
                         'PATIENT_ADMISSION', 'PATIENT_TRANSFER_DEPARTURE',
                         'PATIENT_TRANSFER_ARRIVAL', 'PATIENT_DISCHARGE'
                       )),
  -- WHAT: EPC del paciente (GSRN). Ver D5 "forma exacta de los jsonb".
  what               jsonb       NOT NULL,
  -- WHERE: readPoint/bizLocation GLN (nullable, ver D8) + internalRef.
  where_data         jsonb       NOT NULL,
  event_time         timestamptz NOT NULL,
  record_time        timestamptz NOT NULL DEFAULT now(),
  -- WHY: businessStep + disposition + referencias a Encounter/EncounterTransfer (solo IDs).
  why                jsonb       NOT NULL,
  -- WHO: identificadores opacos únicamente (GSRN paciente, userId que registró). Cero PHI.
  who                jsonb       NOT NULL,
  -- Hash de integridad de una fila — NO cadena. Ver nota arriba.
  payload_hash       char(64)    NOT NULL,
  establecimiento_id uuid        NOT NULL REFERENCES ece.establecimiento(id) ON DELETE RESTRICT,
  -- COMMITTED (normal) | VOIDED (corrección operativa) | SUPPRESSED (ARCO aprobada — anonimizado).
  status             text        NOT NULL DEFAULT 'COMMITTED'
                       CHECK (status IN ('COMMITTED', 'VOIDED', 'SUPPRESSED')),
  -- Trazabilidad de la propia supresión (cuándo/por qué solicitud ARCO, si aplica).
  suppressed_at      timestamptz,
  suppressed_by_arco_request_id uuid,
  creado_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_what
  ON ece.gs1_epcis_patient_event USING GIN (what);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_establecimiento
  ON ece.gs1_epcis_patient_event (establecimiento_id);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_event_time
  ON ece.gs1_epcis_patient_event (event_time DESC);
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_subtipo
  ON ece.gs1_epcis_patient_event (subtipo);
-- Índice funcional para el patrón de consulta "cadena de custodia de un paciente" por GSRN.
CREATE INDEX IF NOT EXISTS idx_gs1_epcis_patient_event_epc
  ON ece.gs1_epcis_patient_event ((what->'epcList'));

COMMENT ON TABLE ece.gs1_epcis_patient_event IS
  'Proyección derivada, purgable/anonimizable, de eventos ObjectEvent de movimiento de paciente '
  '(admisión/traslado/alta). NO es fuente de verdad legal (esa es Encounter/EncounterTransfer/'
  'BedAssignment) y NO tiene trigger de inmutabilidad — a diferencia de ece.gs1_epcis_event '
  '(farmacia). Ver ADR 0019 y dictamen @AE 2026-08-18.';

-- ---------------------------------------------------------------------------
-- RLS — mismo patrón tenant-scoped que ece.gs1_epcis_event (SQL 94), pero
-- SIN grant de UPDATE/DELETE a `authenticated`: la única vía de mutación de
-- una fila ya insertada es la función SECURITY DEFINER de anonimización/
-- corrección de abajo, invocada desde un flujo administrativo controlado
-- (portal-arco.router.ts al resolver una SUPRESION APROBADA), nunca desde
-- un router de escritura de uso general. Esto evita crear un segundo camino
-- de escritura paralelo al ya aceptado para ARCO (dictamen §3.5 punto 3).
-- ---------------------------------------------------------------------------

ALTER TABLE ece.gs1_epcis_patient_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gs1_epcis_patient_event_select ON ece.gs1_epcis_patient_event;
CREATE POLICY gs1_epcis_patient_event_select ON ece.gs1_epcis_patient_event
  FOR SELECT
  TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

DROP POLICY IF EXISTS gs1_epcis_patient_event_insert ON ece.gs1_epcis_patient_event;
CREATE POLICY gs1_epcis_patient_event_insert ON ece.gs1_epcis_patient_event
  FOR INSERT
  TO authenticated
  WITH CHECK (establecimiento_id = ece.current_establecimiento_id_safe());

-- Sin policy de UPDATE/DELETE para `authenticated` — ver comentario arriba.
GRANT SELECT, INSERT ON ece.gs1_epcis_patient_event TO authenticated;
GRANT ALL ON ece.gs1_epcis_patient_event TO service_role;

-- ---------------------------------------------------------------------------
-- Anonimización ARCO — única vía de mutación post-insert. SECURITY DEFINER
-- con search_path fijo (patrón obligatorio del proyecto, CLAUDE.md §Patrones
-- de seguridad establecidos). Sustituye el GSRN por un token no reversible
-- dentro de what/who y marca status=SUPPRESSED. No borra la fila (se
-- conserva el conteo/estructura del evento para auditoría de que "algo
-- ocurrió aquí", solo se despersonaliza) — ruta equivalente al "bloqueo"
-- que los marcos tipo RGPD usan para datos con retención legal del registro
-- fuente pero sin obligación de retener la proyección derivada.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.fn_gs1_epcis_patient_event_anonymize(
  p_gsrn_paciente text,
  p_arco_request_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE ece.gs1_epcis_patient_event
     SET what = jsonb_set(jsonb_set(what, '{gsrn}', 'null'::jsonb), '{epcList}', '[]'::jsonb),
         who  = jsonb_set(who, '{sourceList}', '[]'::jsonb),
         status = 'SUPPRESSED',
         suppressed_at = now(),
         suppressed_by_arco_request_id = p_arco_request_id
   WHERE what->>'gsrn' = p_gsrn_paciente
     AND status <> 'SUPPRESSED';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

ALTER FUNCTION ece.fn_gs1_epcis_patient_event_anonymize(text, uuid) OWNER TO postgres;

COMMENT ON FUNCTION ece.fn_gs1_epcis_patient_event_anonymize IS
  'Ejecuta la porción "capa EPCIS derivada" de una SUPRESION ARCO aprobada '
  '(SolicitudArco, portal-arco.router.ts). Anonimiza, no borra. No toca '
  'Encounter/EncounterTransfer/BedAssignment (retención NTEC Art. 6 intacta). '
  'Ver dictamen @AE 2026-08-18 §3.5 punto 5 y ADR 0019.';
```

**Nota de integración pendiente para @Dev (fuera de este ADR, pero requerida por el dictamen §4
restricción 11):** `portal-arco.router.ts`, al resolver una `SUPRESION` como `APROBADA`, debe
invocar `SELECT ece.fn_gs1_epcis_patient_event_anonymize($gsrn, $solicitudId)` como parte del mismo
flujo de ejecución manual que ya describe el comentario de línea 161 de ese archivo
(*"la ejecución real es manual vía flujo US.F2.7.8/US.F2.7.10"*). Este ADR fija la función; cablearla
en el flujo ARCO es implementación.

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

### D6. Firmas nuevas en `packages/trpc/src/lib/epcis-builder.ts` — REVISADA (tipo de salida propio)

Se añade un input type y un builder, siguiendo el patrón de `buildLogisticsEvent` (tabla de
bizStep/disposition por subtipo + una función) — **con un ajuste respecto a la versión inicial**:
el builder ya **no** devuelve `EpcisEventRow` ni extiende `EpcisSubtipo`. Esa unión (`BedsideEventType
| LogisticsSubtipo`) describe filas destinadas a `ece.gs1_epcis_event` (farmacia); mezclar
`PatientMovementSubtipo` ahí sería type-level una mentira ahora que van a una tabla distinta con su
propio CHECK — exactamente la clase de deriva que ya se encontró en este mismo archivo (el
docstring de cabecera dice "listo para INSERT en `ece.gs1_epcis_event`", el comentario de
`EpcisEventRow` dice "listo para INSERT en `ece.epcis_event`" — dos nombres de tabla distintos para
el mismo tipo, ninguno señalando la tabla real `ece.gs1_epcis_event`). Se define un tipo de salida
independiente para no repetir ese patrón:

```ts
export type PatientMovementSubtipo =
  | "PATIENT_ADMISSION"
  | "PATIENT_TRANSFER_DEPARTURE"
  | "PATIENT_TRANSFER_ARRIVAL"
  | "PATIENT_DISCHARGE";

/** Shape de salida — listo para INSERT en ece.gs1_epcis_patient_event (NO ece.gs1_epcis_event). */
export interface EpcisPatientEventRow {
  tipo_evento: "ObjectEvent";
  subtipo: PatientMovementSubtipo;
  what: object;
  where_data: object;
  event_time: Date;
  why: object;
  who: object;
  payload_hash: string;
  establecimiento_id: string;
  status: "COMMITTED";
}

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
): EpcisPatientEventRow {
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
    establecimiento_id: input.establecimientoId,
    status: "COMMITTED",
  };
}
```

Nota de tipos: al no reutilizar `EpcisEventRow`/`EpcisSubtipo`, no hace falta tocar los tipos de
`buildBedsideEvent`/`buildDispensationEvent`/`buildLogisticsEvent` existentes — `buildPatientMovementEvent`
es aditivo y aislado. `computeHash`/`glnUrn` sí se reutilizan (son funciones puras sin acoplamiento
a un tipo de fila).

**Router de INSERT — nota para @Dev:** el resultado de `buildPatientMovementEvent` se inserta con
`INSERT INTO ece.gs1_epcis_patient_event (...)`, **no** `ece.gs1_epcis_event`. La columna
`indication_id` de la tabla de farmacia no existe en la tabla nueva — no debe copiarse por
costumbre del patrón de `bedside.router.ts`.

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

**Sin cambios por la revisión de tabla (D5):** el razonamiento de bloqueante/no-bloqueante de esta
sección es sobre disponibilidad del GSRN, no sobre qué tabla recibe el INSERT — se mantiene igual,
solo cambia el destino (`ece.gs1_epcis_patient_event` en vez de `ece.gs1_epcis_event`). Una
consecuencia favorable de D5 que sí vale anotar: al no tener trigger de inmutabilidad, una
corrección operativa (ej. traslado registrado con la cama equivocada) ya no necesita el patrón
"evento void que referencia al original" que ADR 0017 exige para farmacia — puede corregirse con
un `UPDATE status='VOIDED'` directo. Por consistencia con la restricción de acceso de D5 (ninguna
mutación post-insert vía `authenticated`), esa corrección debe pasar por una función `SECURITY
DEFINER` equivalente a `fn_gs1_epcis_patient_event_anonymize` (mismo mecanismo, motivo distinto) —
no se especifica su firma aquí porque no fue pedida por el encargo; se deja como nota de diseño
para @Dev si surge la necesidad operativa.

**Pendiente de implementación fuera de este ADR (dictamen §4, restricción 9):** consultar el
recorrido histórico completo de un paciente por GSRN (todos sus eventos `PATIENT_*`) es una
operación de sensibilidad equivalente a exportar el expediente — el router de consulta que @Dev
construya sobre esta tabla debe registrar un `AuditLog` propio (`action: "READ"`,
`entity: "PatientLocationTrace"`, patrón ya usado en `encounter-discharge.router.ts` línea 137 para
`entity: "Encounter.epicrisis"`) cada vez que se ejecute, distinguible de una consulta operativa de
"ubicación actual" (menor sensibilidad, no reconstruye patrón histórico). No se diseña el router
completo aquí — se fija el requisito.

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

**Cumple restricción 8 del dictamen @AE por construcción, sin cambio adicional:** `internalRef`
lleva únicamente `bedId`/`serviceUnitId`/`establishmentId` (UUIDs opacos) — nunca el nombre de la
unidad. El nombre human-readable ("Unidad de Aislamiento TB", "Psiquiatría") se resuelve en la
capa de presentación (UI), para la misma audiencia con RBAC sobre el episodio — nunca se persiste
enriquecido dentro del jsonb. Esto ya estaba así en la versión inicial de este ADR; se confirma
explícitamente aquí porque es exactamente el tipo de condición que el dictamen pidió declarar
satisfecha, no asumida.

---

## Consideraciones de privacidad — resueltas por el dictamen @AE, ya no placeholders

La versión inicial de este ADR dejaba estos puntos como preguntas abiertas para el dictamen
paralelo. El dictamen (commit `c8adfa6`) ya los resolvió; se transcriben aquí como decisiones
fijas, no como sugerencias:

1. **Base de licitud:** el evento encaja en el consentimiento `data-processing` ya existente
   (`CONSENT_TEMPLATES.SLV`), ampliado — **no** requiere un propósito nuevo en
   `consentPurposeEnum`. La base primaria es ejecución de la prestación asistencial + obligación
   legal (Código de Salud/NTEC), no consentimiento revocable independiente. Lo que sí cambia es el
   **deber de información**: el texto de la plantilla debe mencionar explícitamente la trazabilidad
   de ubicación intramuros vía GSRN. **Condición de implementación** (dictamen §4 restricción 7,
   no ejecutada en este ADR — es diseño, no código): el PR que implemente este stream debe tocar
   `packages/trpc/src/routers/consent.router.ts` en el mismo commit que el código, no como follow-up.
2. **RLS:** sin policy nueva más allá de la ya especificada en D5 (`gs1_epcis_patient_event_select`/
   `_insert`, tenant-scoped por `establecimiento_id`). Es suficiente para aislamiento entre
   organizaciones, tal como en `ece.gs1_epcis_event`.
3. **Retención:** 10 años — **mismo plazo** que `Encounter` (su padre lógico), pero con
   **fundamento distinto**: NTEC Art. 6 (retención de expediente clínico), no el fundamento RTCA
   que justifica la retención de `ece.gs1_epcis_event` (farmacia). **Condición de implementación**
   (restricción 6, no ejecutada aquí): documentar como categoría propia — "Trazabilidad de
   ubicación de paciente — GS1 EPCIS" — en `docs/39_sla_retencion_datos.md`, distinta de la fila
   "Trazabilidad GS1 EPCIS" actual (que es de medicamentos).
4. **Quién consulta:** **no** un rol nuevo tipo "logística/GS1" ni el `requireRole(["DIR","ARCH","ADMIN"])`
   de `epcisQueryRouter` (pensado para equipos). El criterio fijado es: la misma población que hoy
   accede al episodio/expediente bajo RLS `organizationId` + `withTenantContext` — es decir, el
   router de consulta nuevo debe usar **`tenantProcedure`** (verificado: es exactamente lo que usan
   hoy `admit`/`transfer`/`discharge`/`list`/`getCensus` en `encounter.router.ts`, sin `requireRole`
   adicional), no una lista de roles administrativos separada. Break-glass reutiliza el mecanismo
   ya funcional de CC-0017 Fase 3 — no se diseña uno paralelo aquí.
5. **Consultar el historial completo de ubicación de un paciente** es sensibilidad equivalente a
   exportar el expediente — requiere su propio evento de auditoría (ver D7, nota de restricción 9),
   distinguible de una consulta de "ubicación actual" en un dashboard operativo de camas.
6. **Minimización:** ya aplicada en el shape de D5/D6 — solo GSRN + IDs internos opacos, cero PHI,
   cero texto libre (`EncounterTransfer.reason` no se duplica dentro del evento — el `why` solo
   referencia el `id` de la fila fuente, nunca su contenido). Confirmado explícitamente contra la
   restricción 4 del dictamen.

---

## Cumplimiento — mapeo a las 11 restricciones del dictamen @AE (§4)

El dictamen exige (restricción 11) que el diseño técnico declare, restricción por restricción,
cómo se satisface. Tabla de cierre:

| # | Restricción (resumen) | Estado en este ADR |
|---|---|---|
| 1 | Solo eventos discretos ADT (admisión/traslado/alta); nada de RTLS/geolocalización continua | **Cumple** — D2, alcance sin cambios respecto a la versión aprobada; no hay tracking continuo en ningún punto del diseño |
| 2 | Tabla propia, no mezclar con `ece.gs1_epcis_event` ni `audit.audit_log` | **Cumple** — D5 revisada: `ece.gs1_epcis_patient_event`, tabla nueva |
| 3 | Sin trigger de inmutabilidad hash-chain; si se insiste en inmutabilidad, requiere anonimización | **Cumple** — D5: sin trigger; se optó directamente por la ruta de anonimización (`fn_gs1_epcis_patient_event_anonymize`), no se insistió en inmutabilidad fuerte |
| 4 | Payload limitado a identificadores opacos, cero texto libre, Zod-enforced | **Cumple el shape** (D5/D6) — el enforcement Zod en `@his/contracts` es responsabilidad de implementación, no de este ADR; recomendado revisión de @AE/@DevSec antes de merge del PR de código, como pide el dictamen |
| 5 | Mismo RBAC/ABAC/RLS que `Encounter`, sin rol nuevo; break-glass reutiliza CC-0017 | **Cumple** — privacidad punto 4: `tenantProcedure`, sin `requireRole` nuevo |
| 6 | Retención 10 años, fundamento NTEC Art. 6, categoría propia en `docs/39` | **Cumple la decisión**; la actualización del documento queda como tarea de implementación (privacidad punto 3) |
| 7 | Actualizar plantilla de consentimiento, mismo PR que el código | **Cumple la decisión**; ejecución queda para el PR de implementación (privacidad punto 1) |
| 8 | Nombre human-readable de unidad no se persiste enriquecido en el jsonb | **Cumple por construcción** — D8, `internalRef` solo UUIDs |
| 9 | Consulta de historial completo = evento de auditoría propio | **Cumple la decisión** — D7, requisito fijado para el router de consulta que construya @Dev |
| 10 | Corregir cita "Decreto 594" → Decreto Legislativo N.° 144 en `docs/39_sla_retencion_datos.md` | **Fuera de alcance de este ADR** — hallazgo secundario del propio dictamen, housekeeping documental no arquitectónico; se señala aquí para que no se pierda |
| 11 | El PR de implementación debe referenciar el dictamen y marcar cada restricción cumplida/no-aplica | **N/A a este ADR** (es de diseño) — condición que hereda el PR de código que construya @Dev, referenciando tanto el dictamen (`c8adfa6`) como este ADR |

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
  siempre vacía) — reportado como hallazgo independiente, no corregido aquí. Nota agregada en esta
  revisión: el fix correcto es repuntar a `ece.epcis_event_equipment` (no a la tabla de paciente
  nueva — ver Contexto).
- **Consulta/UI de trazabilidad de paciente** (router nuevo, pantalla admin) no se diseña en
  detalle en este ADR más allá del contrato de datos (D5), el requisito de auditoría de consulta
  histórica (D7) y el criterio de acceso `tenantProcedure` sin rol nuevo (privacidad punto 4) — es
  responsabilidad de implementación de @Dev/@UIUX.
- **Anonimización parcial vs. supresión total.** `fn_gs1_epcis_patient_event_anonymize` (D5)
  despersonaliza `what`/`who` pero conserva la fila (con `status='SUPPRESSED'`) para preservar
  metadatos de auditoría no personales (cuándo ocurrió algo, en qué establecimiento). Si un futuro
  dictamen legal exige borrado físico en vez de anonimización, la función cambia de `UPDATE` a
  `DELETE` — cambio de una función, no de la tabla ni del RLS. Se documenta como decisión reversible.
- **Tareas de implementación condicionadas por el dictamen, no ejecutadas en este ADR de diseño:**
  actualizar `docs/39_sla_retencion_datos.md` (categoría de retención propia + corrección de la
  cita "Decreto 594"→144), actualizar `CONSENT_TEMPLATES.SLV["data-processing"]` en
  `consent.router.ts`, y cablear `fn_gs1_epcis_patient_event_anonymize` en el flujo de resolución
  de `portal-arco.router.ts`. Las tres son condiciones explícitas del dictamen (§4, restricciones
  6/7/3) que el PR de implementación debe cerrar en el mismo commit que el código, no como
  follow-up — ver sección "Cumplimiento" arriba.

---

## Referencias

- ADR 0017 — GS1 EPCIS Event Sourcing
- ADR 0012 — Estrategia RLS ECE
- `docs/audit/2026-08-18_dictamen_ae_epcis_trazabilidad_paciente.md` (commit `c8adfa6`) — dictamen de cumplimiento @AE que motivó la revisión de D5
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
- `packages/trpc/src/routers/portal-arco.router.ts`
- `packages/trpc/src/routers/consent.router.ts`
- `docs/39_sla_retencion_datos.md`
- `packages/trpc/src/lib/ece-hooks.ts` (`resolveEceEstablecimientoId`)
- GS1 EPC Tag Data Standard — sintaxis EPC pure-identity URI
- GS1 Core Business Vocabulary (CBV) — bizStep/disposition (verificación parcial, ver sección de fuentes)
- `gs1/EPCIS` (GitHub, JSON Schema oficial) — definición de `AssociationEvent`

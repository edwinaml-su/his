# Bridge ECE↔HIS — Ficha NTEC Art. 15 ↔ MPI

**Estado:** implementado (Fase 2 — sprint feat/fase2-s1-gate)
**Autores:** @Dev, @AS

---

## 1. Contexto y decisión de diseño

El HIS mantiene `public.Patient` como MPI (Master Patient Index). La norma MINSAL
Acuerdo n.° 1616 Art. 15 obliga a registrar la Ficha Clínica Electrónica en el schema
`ece.paciente` con campos demográficos propios.

**Opción B — ACL (adopted):** `ece.paciente.public_patient_id UUID NULLABLE`.

- El vínculo es _opcional_ (escenario legacy: ECE puede existir sin Patient HIS).
- Un Patient HIS puede vincularse a exactamente un ece.paciente (restricción del dominio ECE).
- El bridge no impone FK en BD para evitar acoplamiento de schema entre schemas de
  Postgres; la integridad se enforza a nivel aplicación en el router.

Alternativa rechazada — Opción A (FK dura): impediría crear Ficha ECE antes de tener
el paciente en el MPI, bloqueando flujos de admisión de urgencia.

---

## 2. Componentes

| Archivo | Responsabilidad |
|---|---|
| `packages/contracts/src/schemas/ece-bridge-patient.ts` | Zod input schemas |
| `packages/contracts/src/events/catalog.ts` | Event types `ece.paciente.linked`, `.synced` |
| `packages/contracts/src/events/payloads.ts` | Payload schemas + discriminated union |
| `packages/trpc/src/routers/ece-bridge-patient.router.ts` | Router tRPC (5 procedures) |
| `packages/trpc/src/routers/__tests__/ece-bridge-patient.router.test.ts` | 10 tests unitarios |

---

## 3. Procedures

### `ece.bridge.linkPatient`

Vincula `ece.paciente` a `public.Patient`.

**Guards:**
- Patient HIS debe existir y pertenecer al `organizationId` del tenant.
- Si `ece.paciente.public_patient_id` ya apunta a un Patient _diferente_ → `CONFLICT`.
- Idempotente si ya está vinculado al mismo Patient.

**Outbox:** emite `ece.paciente.linked`.

---

### `ece.bridge.unlinkPatient`

SET NULL sobre `public_patient_id`. No lanza error si ya estaba desvinculado.

---

### `ece.bridge.syncFromHis`

Dirección: `public.Patient → ece.paciente`.

**Flujo:**
1. Lee Patient HIS + identificadores (DUI/NIE).
2. Si se pasa `ecePacienteId`: valida consistencia de identificadores y actualiza
   los campos NTEC Art. 15.
3. Si no: crea nueva fila en `ece.paciente` y establece el vínculo.

**Validación de consistencia:** si HIS y ECE tienen el mismo tipo de identificador
(DUI/NIE) con valores distintos → `BAD_REQUEST` con mensaje explícito del conflicto.

**Campos sincronizados (NTEC Art. 15 demográficos):**
`firstName`, `lastName`, `secondLastName`, `birthDate`, `biologicalSexId`.

**Outbox:** emite `ece.paciente.synced` con `direction: "fromHis"`.

---

### `ece.bridge.syncToHis`

Dirección: `ece.paciente → public.Patient`.

**Guards:**
- `ece.paciente` debe existir y tener `public_patient_id` no nulo.
- Validación de consistencia de identificadores igual que `syncFromHis`.

Solo actualiza los campos demográficos NTEC Art. 15 — no toca identifiers ni
relaciones clínicas del Patient HIS.

**Outbox:** emite `ece.paciente.synced` con `direction: "toHis"`.

---

### `ece.bridge.listLinkedPatients`

Lista paginada (cursor por `ece.paciente.id`) de filas con `public_patient_id IS NOT NULL`.
`limit` 1–100, default 20.

---

## 4. Autorización

`requireRole(["ARCH","ADM","DIR"])` — solo administradores y directivos.
El bridge no es una operación clínica cotidiana; requiere rol elevado para evitar
vínculos accidentales.

---

## 5. Outbox — Event Types

| Evento | Payload clave |
|---|---|
| `ece.paciente.linked` | `ecePacienteId`, `publicPatientId`, `linkedById`, `organizationId` |
| `ece.paciente.synced` | + `direction` (`fromHis`/`toHis`), `fieldsUpdated[]` |

Los eventos siguen el patrón Beta.15: INSERT en `DomainEvent` dentro de la misma
transacción (outbox atómico).

---

## 6. Tests E2E a cubrir por @QA

- [ ] `linkPatient` — flujo completo: crear Patient HIS + crear ece.paciente + vincular.
- [ ] `linkPatient` — intentar doble-vínculo a distinto Patient → verificar 409.
- [ ] `syncFromHis` — crear Ficha ECE desde Patient HIS con DUI, verificar campos.
- [ ] `syncToHis` — modificar ECE y verificar que Patient HIS refleja cambios.
- [ ] `syncToHis` — conflicto DUI → verificar mensaje de error descriptivo.
- [ ] RBAC: usuario sin rol ARCH/ADM/DIR → 403 en todos los procedures.

---

## 7. Consideraciones futuras

- Si en el futuro se añade FK de BD, la migración requiere que todos los
  `ece.paciente` con `public_patient_id` no nulo apunten a `Patient` existentes.
  Añadir índice `ece.paciente(public_patient_id)` antes de la FK.
- `syncFromHis` actualmente no sincroniza `PatientIdentifier` al crear la fila ECE
  (copia DUI/NIE como campos planos). Si ECE extiende su modelo de identificadores,
  extender el mapping.
# Blueprint: Bridge ECE↔HIS

Fase 2 — Streams 22 (paciente) y 22b (encounter).

Norma: Art. 16, 17 NTEC (Acuerdo n.° 1616, MINSAL 2024). Opción B: `public_patient_id` / `public_encounter_id` como Application Control Links (ACL) hacia el MPI y el ADT de HIS.

---

## 1. Modelo de integración (Opción B)

```
public."Patient"  ←──────  ece.paciente.public_patient_id (nullable, SET NULL on delete)
public."Encounter" ←─────  ece.episodio_atencion.public_encounter_id (nullable, SET NULL on delete)
```

- Nullable intencionado: un registro ECE puede preceder a la admisión formal en HIS (papel retroalimentado).
- SET NULL en DELETE preserva la trazabilidad histórica ECE cuando se elimina un Encounter HIS.

---

## 2. Bridge de Paciente (Stream 22)

Crea/vincula `ece.paciente` para un `public.Patient`. La columna `public_patient_id` actúa como ACL.

Prerequisito de stream 22b: el bridge de paciente debe ejecutarse antes de `createEpisodioFromEncounter`.

---

## 3. Bridge de Encounter (Stream 22b)

### 3.1 Router tRPC

`packages/trpc/src/routers/ece/bridge-encounter.router.ts` — expuesto en `_app.ts` como `eceBridgeEncounter`.

| Procedure | Tipo | Rol requerido |
|---|---|---|
| `eceBridgeEncounter.linkEncounter` | mutation | PHYSICIAN, NURSE, ADM |
| `eceBridgeEncounter.unlinkEncounter` | mutation | PHYSICIAN, NURSE, ADM |
| `eceBridgeEncounter.createEpisodioFromEncounter` | mutation | PHYSICIAN, NURSE, ADM |
| `eceBridgeEncounter.listEncountersWithoutEpisodio` | query | tenant (cualquier rol) |

### 3.2 Schema Zod

`packages/contracts/src/schemas/ece-bridge-encounter.ts`

- `linkEncounterSchema` — `{ encounterId, episodioId }`
- `unlinkEncounterSchema` — `{ episodioId }`
- `createEpisodioFromEncounterSchema` — `{ encounterId, modalidad, servicio_categoria, establecimientoEceId, origen_consulta?, motivo? }`
- `listEncountersWithoutEpisodioSchema` — `{ page, pageSize }`

### 3.3 Flujo `createEpisodioFromEncounter`

```
1. Busca public.Encounter por id + organizationId (Prisma, tenant-scoped).
2. Verifica que el Encounter NO tenga ya un episodio vinculado ($queryRaw).
3. Resuelve ece.paciente via public_patient_id = encounter.patientId ($queryRaw).
   → PRECONDITION_FAILED si no existe (bridge de paciente no ejecutado).
4. INSERT en ece.episodio_atencion copiando: paciente_id, establecimiento_id,
   public_encounter_id, modalidad, servicio_categoria, fecha_hora_inicio
   (= admittedAt del Encounter).
5. emitDomainEvent "ece.episodio.linkedToEncounter" — en la misma transacción.
```

### 3.4 Evento de dominio

`eventType: "ece.episodio.linkedToEncounter"` — registrado en:
- `packages/contracts/src/events/catalog.ts`
- `packages/contracts/src/events/payloads.ts` (payload: `eceEpisodioLinkedToEncounterPayloadSchema`)
- `packages/database/src/outbox/emit.ts` — discriminated union via `domainEventPayloadSchema`

Payload:
```ts
{
  episodioId: string (uuid),
  encounterId: string (uuid),
  patientId: string (uuid),
  organizationId: string (uuid),
  linkedById: string | null (uuid),
}
```

### 3.5 `listEncountersWithoutEpisodio`

Estrategia: obtiene los `public_encounter_id` vinculados desde `ece.episodio_atencion` via `$queryRaw`, luego consulta `public.Encounter` con Prisma excluyendo esos IDs (`notIn`). Sólo muestra Encounters abiertos (`dischargedAt IS NULL`).

Limitación conocida: si el volumen de Encounters vinculados es muy grande (>10k), la cláusula `notIn` puede ser ineficiente. Alternativa: mover a raw SQL con `NOT EXISTS`. Aceptable para MVP Fase 2.

### 3.6 Seguridad y multitenancy

- `linkEncounter` y `createEpisodioFromEncounter` verifican que el Encounter pertenece al `organizationId` del tenant antes de operar sobre ECE.
- `unlinkEncounter` y `listEncountersWithoutEpisodio` no hacen cross-tenant por diseño (ECE no tiene organizationId directo; el guard es a nivel del Encounter HIS que sí lo tiene).

### 3.7 Tests

`packages/trpc/src/routers/__tests__/ece-bridge-encounter.router.test.ts` — 8 tests:

- `linkEncounter` happy path, NOT_FOUND, CONFLICT
- `unlinkEncounter` happy path, BAD_REQUEST
- `createEpisodioFromEncounter` happy path, NOT_FOUND, CONFLICT, PRECONDITION_FAILED
- `listEncountersWithoutEpisodio` paginacion

### 3.8 Para @QA — E2E a automatizar

1. Flujo completo: admitir paciente (HIS) → bridge paciente → `createEpisodioFromEncounter` → verificar `ece.episodio_atencion.public_encounter_id` en BD.
2. Verificar que `linkEncounter` con episodio ya vinculado retorna 409 CONFLICT.
3. `listEncountersWithoutEpisodio` debe excluir encounters ya vinculados.
4. Verificar evento `ece.episodio.linkedToEncounter` en `DomainEvent` tras `createEpisodioFromEncounter`.
5. Verificar que `unlinkEncounter` + re-`linkEncounter` funciona (idempotencia de flujo).

---

## 4. Índices BD relevantes

Definidos en `59_ece_04_episodios.sql`:

- `idx_episodio_encounter` — `ON ece.episodio_atencion(public_encounter_id) WHERE public_encounter_id IS NOT NULL`
- `idx_episodio_paciente` — `ON ece.episodio_atencion(paciente_id)`

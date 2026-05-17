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

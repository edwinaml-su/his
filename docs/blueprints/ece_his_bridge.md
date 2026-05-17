# Blueprint: Bridge ECE ↔ HIS — Triage

**Stream:** 18-ext  
**Fecha:** 2026-05-17  
**Autor:** @Dev  
**Estado:** Implementado — pendiente review @QA

---

## 1. Contexto y motivación

El HIS gestiona el Triage Manchester mediante `public.TriageEvaluation` (modelo Prisma completo con niveles 1-5, discriminadores, signos vitales). La normativa NTEC Doc 4 (MINSAL) exige adicionalmente la **Hoja de Triaje ECE formal** en `ece.triaje`, con firma electrónica de enfermero (ENF) y validación del médico de turno (MT).

Este bridge conecta ambos mundos sin FK cruzada entre esquemas `public` y `ece`, preservando evolución independiente.

---

## 2. Diseño de vínculo

**No hay FK directa entre `public.TriageEvaluation` y `ece.triaje`.**

El vínculo se persiste en el campo JSONB `ece.triaje.data`:

```json
{ "hisTriageEvalId": "<uuid TriageEvaluation>" }
```

- Lookup inverso: `WHERE data->>'hisTriageEvalId' = '<uuid>'`
- Permite que cada esquema evolucione sin migración cruzada (ADR 0008 — VARCHAR eventType, misma filosofía).

---

## 3. Mapeo Manchester → Nivel ECE

| Manchester | Color  | ECE nivel | Etiqueta        |
|-----------|--------|-----------|-----------------|
| 1         | RED    | I         | Inmediata       |
| 2         | ORANGE | II        | Muy urgente     |
| 3         | YELLOW | III       | Urgente         |
| 4         | GREEN  | IV        | Menos urgente   |
| 5         | BLUE   | V         | No urgente      |

Fuente: `TriageLevel.priority` (INT 1-5) → `MANCHESTER_TO_ECE_NIVEL` en `ece-bridge-triage.ts`.

---

## 4. Procedures tRPC

Router: `eceBridgeTriage` — `requireRole(["NURSE","PHYSICIAN"])`

### 4.1 `linkTriage(triageId, eceTriajeId)`

Vincula una `TriageEvaluation` HIS existente a una `EceTriaje` ECE existente.

**Guards:**
- `TriageEvaluation.organizationId` debe coincidir con `ctx.tenant.organizationId`.
- Si `ece.triaje.data->>'hisTriageEvalId'` ya apunta a un UUID distinto → `CONFLICT`.

**Outbox:** `ece.triaje.linkedToHisTriage`.

---

### 4.2 `unlinkTriage(triageId)`

Elimina el campo `hisTriageEvalId` del JSONB de la EceTriaje vinculada.

No elimina ninguna entidad. No emite evento outbox (operación administrativa).

---

### 4.3 `createEceFromTriage(triageId, episodioId, registradoPorId, [firmarInmediatamente], [signosVitalesId], [destinoAsignado])`

Crea una `EceTriaje` nueva a partir de una `TriageEvaluation` HIS.

**Flujo:**
1. Verificar que `TriageEvaluation` existe y pertenece al tenant.
2. Verificar idempotencia: si ya hay `EceTriaje` con `hisTriageEvalId = triageId` → retornar existente.
3. Mapear `TriageLevel.priority` → `nivelPrioridad` ECE.
4. Determinar `estadoRegistro`:
   - `firmarInmediatamente=true` **y** `ctx.tenant.roleCodes.includes("NURSE")` → `"firmado"`
   - Cualquier otro caso → `"borrador"`
5. `INSERT INTO ece.triaje` con `data->>'hisTriageEvalId'`.
6. `emitDomainEvent` `ece.triaje.linkedToHisTriage` dentro de la misma transacción.

**Nota sobre firma:** El estado `"firmado"` en `ece.triaje.estado_registro` es la firma simple del ENF conforme a NTEC Doc 4 Art. 44. La validación MT (médico de turno) es un paso de workflow posterior vía `workflow-instance.router`.

---

### 4.4 `syncCompletedTriages(limit, registradoPorId, [defaultEpisodioId])`

**Job manual de recuperación** — no es cron automático.

Busca `TriageEvaluation` en estado `COMPLETED` que no tengan ninguna `EceTriaje` vinculada y las procesa en lote.

**Comportamiento:**
- Si `defaultEpisodioId` es `undefined` → registro marcado como `skipped`.
- Errores por fila son `fail-soft`: se cuentan pero no abortan el lote.
- Retorna `{ processed, errors, details[] }` para auditoría del operador.

**Idempotente:** cada `TriageEvaluation` puede procesarse solo una vez (la segunda vez el `INSERT` generaría duplicado detectado en check de `fetchCompletedUnlinkedTriages`).

---

## 5. Evento de dominio

**Tipo:** `ece.triaje.linkedToHisTriage`

**Payload:**

```ts
{
  hisTriageId: string;       // UUID TriageEvaluation HIS
  eceTriajeId: string;       // UUID ece.triaje
  patientId: string;         // UUID paciente HIS
  manchesterLevel: 1 | 2 | 3 | 4 | 5;
  firmadoInmediatamente: boolean;
  byUserId: string;
}
```

Registrado en `catalog.ts` y `payloads.ts`. Validado por `emitDomainEvent` vía `domainEventPayloadSchema` (discriminated union) antes del INSERT.

---

## 6. Archivos creados / modificados

| Archivo | Tipo |
|---------|------|
| `packages/contracts/src/schemas/ece-bridge-triage.ts` | Nuevo — Zod schemas input/output |
| `packages/contracts/src/events/catalog.ts` | Modificado — nuevo eventType |
| `packages/contracts/src/events/payloads.ts` | Modificado — payload schema + discriminated union |
| `packages/contracts/src/schemas/index.ts` | Modificado — re-export |
| `packages/trpc/src/routers/ece/bridge-triage.router.ts` | Nuevo — router |
| `packages/trpc/src/routers/__tests__/ece-bridge-triage.router.test.ts` | Nuevo — 4 tests |
| `packages/trpc/src/routers/_app.ts` | Modificado — registra `eceBridgeTriage` |
| `docs/blueprints/ece_his_bridge.md` | Nuevo — este documento |

---

## 7. Pendientes @QA (E2E)

- `linkTriage` flujo completo con TriageEvaluation y EceTriaje reales en BD efímera.
- `createEceFromTriage` con `firmarInmediatamente=true` verificando `estado_registro = 'firmado'`.
- `syncCompletedTriages` contra lote de 3 registros: 1 creado, 1 skipped (sin episodio), 1 error (rollback).
- Verificar que el vínculo doble (`linkTriage` dos veces mismo ECE → segundo lanza CONFLICT) se rechaza con 409.
- Verificar que `unlinkTriage` limpia el JSON sin borrar otros campos de `data`.

---

## 8. Validación MT (fuera de scope)

La firma del médico de turno (MT) que valida la Hoja ECE es un estado de workflow (`FIRMADO_ENF → VALIDADO_MT`) gestionado por `workflow-instance.router`. El bridge solo establece el estado inicial `borrador` o `firmado` (ENF). El trigger de avance de estado debe configurarse en `ece.workflow_tipo_doc` con el código `HOJA_TRIAJE_ECE`.

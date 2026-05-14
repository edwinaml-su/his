# ADR 0008 — Beta.15 Notifications: Outbox + pg_cron + Edge Function

- **Estado:** Propuesto (en revisión @DBA + @SRE + @AT)
- **Fecha:** 2026-05-14
- **Decisores:** @AS (proponente), @PO, @AE, @DBA, @SRE
- **Fase:** Beta.15 (Wave Phase 2 hardening — continuación)
- **Backlog:** [`docs/backlog/beta15_alerts_notifications.md`](../backlog/beta15_alerts_notifications.md)
- **Blueprint:** [`docs/blueprints/beta15_notifications.md`](../blueprints/beta15_notifications.md)
- **Supersedes:** comentarios "Wave 2" en `inpatient.router.ts`, `lis.router.ts`, `pharmacy.router.ts`, `respiratory.router.ts` (placeholders sin spec).

---

## Contexto

El HIS Multipaís ya detecta alertas clínicas críticas (vital signs out of range, LASA, valores de laboratorio críticos, alergias) pero NO las entrega: el detector marca un flag y el evento muere ahí. El backlog Beta.15 (15 user stories, 67 puntos) introduce un canal end-to-end Router → Notification → Email/Inbox con audit trail completo y preferencias por usuario.

Hay 5 decisiones arquitecturales que requieren registro formal porque afectarán el costo de mantenimiento durante años:

1. **¿Cómo publicamos eventos sin acoplar dominio a transporte?** (Outbox vs publish directo vs CDC).
2. **¿Quién corre el dispatcher?** (Inngest paid vs pg_cron + Edge Function gratis vs Vercel Cron vs worker propio).
3. **¿`eventType` es enum PG o VARCHAR?**
4. **¿Outbox amerita su propio paquete `@his/outbox`?**
5. **¿Cómo garantizamos idempotencia ante reintentos?**

---

## Decisión

### D1 — Patrón Outbox transaccional

Cada router que muta estado clínico **DEBE** insertar la fila `DomainEvent` dentro de la **misma transacción** Prisma que la mutación. Helper canónico: `emitDomainEvent(tx, dto)` en `@his/database`.

```ts
await prisma.$transaction(async (tx) => {
  const vitals = await tx.inpatientVitals.create({ data: ... });
  if (isCritical(vitals)) {
    await emitDomainEvent(tx, {
      eventType: "vital.critical",
      aggregateType: "InpatientVitals",
      aggregateId: vitals.id,
      payload: { admissionId, vitalsId: vitals.id, alerts: [...] },
    });
  }
});
```

**Justificación:** garantiza atomicidad estado↔evento. Si rollback, no hay evento huérfano. Si commit, hay durabilidad.

**Descartado:** publish directo a Resend desde el router. Acopla dominio a infraestructura externa; un crash de Resend cancelaría el INSERT clínico.

**Descartado:** CDC (Debezium/wal2json sobre tablas clínicas). Requiere infra adicional sobre Supabase y acopla forma del payload al schema interno de tablas (cambios de schema = rompe consumidores).

---

### D2 — `pg_cron` + Edge Function Supabase para el dispatcher

`pg_cron` corre cada 30s una función `notifications.process_outbox_batch(100)` que:
1. Reclama lote vía `SELECT ... FOR UPDATE SKIP LOCKED`.
2. Llama Edge Function `notifications-dispatch` con `eventIds[]`.
3. La Edge Function (Deno) ejecuta código TS shared (`@his/notifications`) y actualiza `publishedAt`.

**Justificación:**

| Criterio | pg_cron + EF | Inngest | Vercel Cron | Worker propio |
|---|---|---|---|---|
| Costo MVP | $0 (incluido Supabase) | $20/mo startup | Incluido en Vercel Pro | $0 |
| Observabilidad | logs Supabase + Vercel | dashboard nativo | logs Vercel básicos | logs app |
| Retry/DLQ | manual (en EF) | built-in UI | manual | manual |
| Setup | 1 archivo SQL + 1 EF | account + adapter | 1 route handler | infra propia |
| Concurrencia | `pg_try_advisory_xact_lock` | gestionado | gestionado | manual |
| Latencia P95 | ≤ 90s (3 ticks de 30s) | ≤ 5s | ≤ 60s | depende |

Para volumen MVP (200/día/estab) la latencia y observabilidad de pg_cron son suficientes. Migración a Inngest se evalúa en Beta.18+ cuando entren WebSockets real-time y `> 5,000` eventos/día/tenant.

**Descartado:** worker Node propio (frágil con réplicas, no agrega valor vs pg_cron). **Descartado MVP:** Inngest (costo + lock-in para un volumen que no lo justifica todavía).

---

### D3 — `eventType` es `VARCHAR(80)`, NO enum PostgreSQL

`DomainEvent.eventType` es `VARCHAR(80)`. La validación de valores válidos vive en TypeScript:

```ts
export const EVENT_TYPES = ["vital.critical", "lab.criticalValue", ...] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
```

El helper `emitDomainEvent` valida con Zod antes de INSERT. Si alguien escribe SQL crudo con `eventType="typo"`, el dispatcher lo marca FAILED tras Zod fail → operador investiga.

**Justificación:** Beta.6 nos enseñó que `ALTER TYPE ADD VALUE` en PostgreSQL no puede co-existir con uso del valor nuevo en la misma transacción (caso `SurgeryCaseStatus.POST_OP`). Añadir 1 eventType nuevo requeriría:

```sql
-- Migration #1 (transacción A)
ALTER TYPE "EventType" ADD VALUE 'new.event';
-- Esperar deploy + commit
-- Migration #2 (transacción B)
-- Ahora sí podemos usar 'new.event' en CREATE INDEX, INSERTs, etc.
```

Esto rompe el flujo de migraciones de Prisma y genera complejidad operacional desproporcionada al beneficio (autocomplete en SQL). El catálogo TS + Zod entrega el mismo type-safety en la capa que importa.

**Descartado:** `CREATE TYPE EventType AS ENUM (...)`. **Descartado:** tabla `EventTypeCatalog` con FK desde `DomainEvent.eventType` (overhead sin valor — las inserciones desde Edge Function son service-role bypassing RLS, no impone disciplina real).

---

### D4 — Outbox vive en `@his/database`, NO en paquete propio

El esquema (`DomainEvent` model + RLS) y el helper (`emitDomainEvent`) viven en `packages/database/`. **No se crea** `packages/outbox/`.

**Justificación:** 1 tabla + 1 helper de 20 líneas no merece overhead de workspace package (build pipeline, exports, versionado). El helper es tightly coupled a `PrismaClient` (acepta `tx` como primer parámetro) — su lugar natural es junto a Prisma.

El **dispatcher** (que es lógica de aplicación con providers/templates/etc.) SÍ tiene su propio paquete `@his/notifications` porque tiene 5+ módulos y se importa desde Edge Function (Deno) + Next.js app (Node) → necesita un build target consistente.

---

### D5 — Idempotencia vía `UNIQUE(eventId, recipientUserId, channel)` + `ON CONFLICT DO NOTHING`

Cada combinación `(evento, destinatario, canal)` produce **a lo más** una fila `Notification`. Garantizado por constraint UNIQUE en la tabla. El dispatcher usa:

```sql
INSERT INTO "Notification" (...) VALUES (...)
ON CONFLICT (eventId, recipientUserId, channel) DO NOTHING;
```

Si una row preexistente está en `status = SENT`, NO se llama Resend de nuevo (lectura de `providerMessageId` para confirmar).

**Justificación:** Esquemas alternativos (dedup key como hash, Redis SETNX) agregan dependencias o complejidad sin ventaja vs constraint nativo PG. PostgreSQL es la única fuente de verdad.

**Descartado:** dedup vía `payloadHash`. Útil para detectar bug de "router re-emite el mismo evento por accidente", pero no se sabe si es problema real hasta que pasa. Se difiere a Beta.16 si surface.

---

## Consecuencias

### Positivas

- **Costo $0 incremental** (todo dentro del plan Supabase + Vercel actuales) — solo Resend agrega ~$20/mes a escala 10k emails/mes.
- **Atomicidad fuerte** entre mutación clínica y registro de evento — auditoría limpia.
- **eventType evolutivo** sin migraciones complejas — añadir `med.missed` es 1 entrada en TS `EVENT_TYPES` + 1 schema Zod, sin tocar DB.
- **Re-uso de hash chain** `audit.fn_audit_log_chain` para trazabilidad sin lógica adicional.
- **Idempotencia garantizada por DB**, no por código aplicación.
- **Edge Function = código TS** → mismas plantillas/dispatcher funcionan si en Beta.18 migramos a Inngest (solo cambia el invocador).

### Negativas / costos

- **Latencia P95 = 90s** (3 ticks de 30s). Inaceptable para alertas tiempo-vida-o-muerte. Se mitiga marcando los eventos verdaderamente *bloqueantes* con un push síncrono al monitor cabecera (out of scope Beta.15; pertenece a Beta.18 real-time).
- **Edge Function cold start** (Deno) puede agregar 1-2s ocasionales. Mitigado con batch size 100 (amortiza overhead).
- **pg_cron 6-field cron (segundos)** requiere Supabase build con `--with-cron-seconds`. Confirmar con @SRE antes de Sprint 1. Si no disponible, schedule `* * * * *` (cada minuto) y latencia P95 = 180s — sigue dentro de límite "no es real-time crítico".
- **eventType drift posible** entre TS y DB. Mitigado con contract test en CI (`forEach EVENT_TYPES → assert schema registrado`).
- **Acoplamiento al ecosistema Supabase** (pg_cron + Edge Function). Salir requiere reescribir el dispatcher para correr en Inngest/AWS Lambda/Vercel cron. Aislamiento mitigado por interfaces `EventDispatcher`/`EmailProvider` hexagonales.

### Riesgos abiertos

- **R1** Tenant ruidoso satura poller — monitor + alerta @SRE. Si materializa, particionar batch por org.
- **R2** Resend rate limits — Resend tier startup permite 10k/mes, suficiente. Si pasa, escalar tier o agregar provider secundario.
- **R3** Edge Function timeout 60s — batch size conservadora; monitor P95 de invocación.

---

## Alternativas consideradas (descartadas)

### A1 — Publish directo desde router al provider

```ts
await tx.inpatientVitals.create({...});
await resend.send({...}); // ❌ no atómico, falla externa cancela tx
```

Rechazado por acoplamiento + falta de durabilidad ante fallos de Resend.

### A2 — Change Data Capture (Debezium + Kafka)

Captura cambios en tablas clínicas y los transforma a eventos. Rechazado por:
- Infra adicional (Kafka + Debezium) fuera de Supabase.
- Schema interno = forma del evento (cambio de columna = rompe consumidores).
- Overkill para volumen MVP.

### A3 — Inngest desde el inicio

Provider managed con dashboard nativo. Rechazado por:
- $20/mes adicional sin valor demostrado a 200/día.
- Lock-in (migrar a self-hosted = trabajo).
- Para Beta.18+ se reconsidera con datos de uso reales.

### A4 — eventType como enum PG con migration scripts

Type-safe en SQL crudo. Rechazado por trauma POST_OP de Beta.6 — el costo operacional de `ALTER TYPE ADD VALUE` cada vez que añadimos un evento (≥ 1/mes esperado) supera el beneficio de autocomplete en SQL crudo (que nadie escribe en Beta.15 — todo es via Prisma).

### A5 — Paquete separado `@his/outbox`

Rechazado por sobre-modularización. 1 tabla + 1 helper de 20 líneas no merece su build pipeline.

---

## Implementación (referencias)

- Blueprint detallado: [`docs/blueprints/beta15_notifications.md`](../blueprints/beta15_notifications.md).
- Sprint sequencing: §11 del blueprint (3 sprints, ~22 pts/sprint).
- Spike inicial (PR US.B15.1.1): tabla `DomainEvent` + RLS + helper `emitDomainEvent` + test E2E con `prescription.created` como evento "hola mundo".

---

## Revisión

Esta ADR debe ser revisada por:
- **@DBA**: validar shape de `DomainEvent`, `Notification`, RLS, índices, función pg_cron.
- **@SRE**: confirmar `pg_cron` con seconds-cron en Supabase project HIS, provisionar Resend account, secrets en Vercel.
- **@AT**: aprobar región de Edge Function (`us-east-1` recomendado para alinear con `iad1` de Vercel).
- **@AE**: confirmar que payload de eventos NO viola Ley de Protección de Datos SV (no envía PHI a email sin tenant context).
- **@QA**: estrategia de testing — vitest unit + integration con testcontainers + 1 E2E Playwright.

**Approval gate:** la decisión queda firme cuando @DBA + @SRE aprueben en comentarios o en el siguiente PR de spike US.B15.1.1.

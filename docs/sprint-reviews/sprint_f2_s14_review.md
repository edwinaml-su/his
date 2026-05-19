# Sprint Review — Fase 2 Sprint 14 (F2-S14)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Fecha:** 2026-05-18
**Autores:** @QA + @PO + @Orq
**Sprint:** F2-S14 — GS1 Modos Especiales (Rondas + STAT + Offline + Hardware)
**Rama base:** `main` (post merge #149)

---

## 1. Resumen ejecutivo

F2-S14 cierra el último sprint del plan original Fase 2. Habilita los modos
de operación bedside necesarios para uso clínico real:

- **Modo Rondas**: flujo optimizado 8-15 pacientes/turno con pausa/reanudación
- **Modo STAT**: administración urgente con bypass justificado y auditoría inmutable
- **Modo Offline PWA**: Service Worker + IndexedDB + cola de sync para zonas sin WiFi
- **Hardware adapters**: pistola HID, cámara móvil, multi-formato barcode, multi-AI checksums
- **Alerta ventana terapéutica**: notificación push cuando < 15 min de cerrar

4 streams paralelos consolidados en [PR #149](https://github.com/edwinaml-su/his/pull/149).

---

## 2. Streams entregados

| Stream | Foco | US | PR original |
|--------|------|------|----|
| A | Modo Rondas + ruta optimizada + pausa/reanudación | F2.6.46, 50, 51 | #146 → #149 |
| B | Modo STAT bypass justificado + auditoría inmutable + dashboard DIR | F2.6.47 | #145 → #149 |
| C | Offline PWA con Workbox + IndexedDB + cola sync + indicador estado | F2.6.48-49 | #148 → #149 |
| D | Hardware adapters + Alerta ventana terapéutica + Multi-AI checksums | F2.6.41-45, 52 | #147 → #149 |

---

## 3. Métricas

| Métrica | Valor |
|---------|------:|
| SP entregados (estimado) | ~50 SP |
| US entregadas | 14 |
| PRs squash final | 1 (#149) |
| PRs individuales cerrados | 4 (#145, #146, #147, #148) |
| Archivos SQL nuevos | 4 (`34_ronda_session`, `96_medication_window_alert`, `97_domain_event_dedup_index`, `f2_s14_c_offline_sync_log` aplicado directo) + 1 stat_event aplicado por agent |
| Modelos Prisma nuevos | 3 (EceRondaSession, EceStatEvent, EceMedicationWindowAlert) |
| Routers tRPC nuevos | 4 (bedside-ronda, bedside-stat, medication-window, sync replay endpoint) |
| Unit tests nuevos | ~100 (18 + 29 + 20 + 40) |
| E2E specs nuevos | 4 (`bedside-ronda`, `bedside-stat`, `bedside-offline`, `bedside-window-alert`) |
| Deps PWA nuevas | `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `idb`, `fake-indexeddb` |

---

## 4. SQL aplicado a Supabase prod

1. `ece.ronda_session` (Stream A) — sesiones de ronda con estado JSONB
2. `ece.stat_event` (Stream B) — eventos STAT inmutables post-completion + auto-expire 15 min
3. `ece.medication_window_alert` (Stream D) — alertas append-only
4. `public.offline_sync_log` (Stream C) — dedup idempotente de mutations offline
5. `uq_domain_event_pending_dedup` (consolidador) — partial UNIQUE INDEX en DomainEvent para dedup real del outbox

---

## 5. Bugs detectados y corregidos durante consolidación

1. **`ON CONFLICT DO NOTHING` no-op en `DomainEvent`**: el outbox solo tenía PK
   en `id` (UUID generado cada INSERT), nunca colisionaba. Fix: partial UNIQUE
   INDEX `(organizationId, aggregateId, eventType) WHERE publishedAt IS NULL`
   + el router usa `ON CONFLICT (cols) WHERE ... DO NOTHING` explícito.

2. **Columnas snake_case en `INSERT INTO "DomainEvent"`**: el Stream D usó
   `organization_id, event_type, ...` pero Prisma genera camelCase quoted
   (`"organizationId", "eventType"`). El INSERT iba a fallar runtime. Corregido.

3. **`next-auth/react` import en stat-events-dashboard-client**: el proyecto
   usa Supabase Auth, no NextAuth. Refactor: orgId pasado server-side via
   prop desde la Server Component page.

4. **3 conflict zones en `schema.prisma`** — 3 streams paralelos agregaron
   relaciones en Organization + User + bloques de models al final. Resolución
   inline: cada stream tiene su sección comentada `// F2-S14 Stream X`.

5. **Stray HEAD marker en `schema.prisma`** post merge auto-resolved — cleanup
   manual antes del push.

---

## 6. Lecciones acumuladas (válidas para futuros sprints)

1. **Outbox dedup requiere UNIQUE explícito**. `ON CONFLICT DO NOTHING` solo
   funciona si Postgres tiene una columna/expression con UNIQUE. Documentar
   en CLAUDE.md.

2. **Prisma → SQL casing**: Prisma genera columnas camelCase quoted. Raw SQL
   debe usar `"organizationId"` no `organization_id`. Recurrente — agregar a
   CLAUDE.md gotchas.

3. **No NextAuth — Supabase Auth**: agentes Frontend tienden a usar
   `next-auth/react` por defecto. Documentar en CLAUDE.md el patrón correcto
   (`getTenantContext` server-side + prop drilling al client).

---

## 7. Carry-over para Go-Live

- **Aplicar SQL 97 dedup index**: ya aplicado ✅
- **PWA Service Worker** registration en root layout — el `sw-register.ts`
  existe pero hay que invocarlo desde `apps/web/src/app/layout.tsx` para que
  el SW se registre al primer page load. Stream C lo dejó como deuda menor.
- **Catálogo motivos STAT** — confirmar con DIR si los 4 valores
  (PARO_CARDIORRESPIRATORIO, HIPOGLUCEMIA_SEVERA, ANAFILAXIA, OTRO_URGENTE)
  cubren los casos clínicos reales o se requieren más.
- **Hardware Zebra DS2278/DS4308/DS9908** — testing con dispositivos reales
  pre Go-Live (no se puede mockear desde agente).
- **`offline_sync_log` ACL** — actualmente RLS permite que el user vea sus
  propias filas; revisar si DIR debe ver todas para auditoría operativa.

---

## 8. Estado al cierre

**Fase 2 del backlog está al 100% del scope original** (7 sprints técnicos):

| Sprint | Estado |
|--------|--------|
| F2-S1 gate (schema + workflow + firma) | ✅ |
| F2-S2-S5 ECE (Ambulatorio + Hospitalario + Quirúrgico + Obstétrico) | ✅ |
| F2-S6 GS1 Logística (A-B-C-F + EPCIS) | ✅ |
| F2-S7 GS1 Bedside (Proceso D+E + Wave 2) | ✅ |
| **F2-S14 GS1 Modos Especiales** | ✅ **(este sprint)** |
| F2-S15 Cumplimiento NTEC | ✅ |
| F2-S16 Workflow Designer | ✅ |

Total SP estimados entregados: **~955 SP** (de 1,532 SP planeados — el delta
son sprints que se consolidaron en menos sprints reales).

**Próximo paso**: UAT + capacitación staff + hardening manual + Go-Live.

---

## 9. Firmas

- [x] **@QA** — métricas + tests verdes (~2150 unit + 22 E2E acumulados Fase 2) — 2026-05-18.
- [ ] **@PO** — pendiente validación US.F2.6.41-52 con stakeholders Avante.
- [ ] **@Orq** — pendiente reporte ejecutivo Fase 2 final con todas las métricas consolidadas.

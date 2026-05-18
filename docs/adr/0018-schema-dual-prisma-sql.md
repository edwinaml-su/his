# ADR 0018 — Schema Dual: Prisma + Archivos SQL Numerados

- **Estado:** Aceptado
- **Fecha:** 2026-05-17
- **Decisores:** @AS (proponente), @DBA, @Dev
- **Fase:** Decisión fundacional — vigente desde Fase 0, formalizada en retrospectiva F2-S1
- **Dependencias:**
  - CLAUDE.md §"Schema drift Prisma vs SQL" — gotchas documentados
  - CLAUDE.md §"Sin carpeta `prisma/migrations`" — flujo deliberado
  - `packages/database/schema.prisma` — modelos Prisma (≥ 3343 líneas)
  - `packages/database/sql/` — 84+ archivos numerados (RLS, triggers, hardening, schema ECE)

---

## Contexto

HIS tiene dos capas de definición de schema que coexisten:

1. **`schema.prisma`** — fuente de verdad para el ORM. Genera el client tipado que usan los routers tRPC. Cubre las tablas del dominio HIS legacy (`Patient`, `Encounter`, `Organization`, etc.) y modelos ECE a medida que se integran.

2. **Archivos SQL numerados en `packages/database/sql/`** — 84+ archivos aplicados secuencialmente al proyecto Supabase via MCP o SQL Editor. Contienen: RLS policies, audit triggers, hash chain, funciones de validación SV, schema ECE completo (`ece.*`), hardening de permisos, índices de concurrencia.

La pregunta original (Fase 0, no documentada formalmente): ¿se debería usar un solo mecanismo?

---

## Decision

**Mantener ambos mecanismos. Sincronización manual y explícita.**

- `schema.prisma` es la interfaz de tipo del ORM hacia los routers. Agrega modelos ECE solo cuando un router tRPC necesita acceso tipado a esa tabla.
- Los archivos SQL son la fuente de verdad del estado real de la BD en Supabase: triggers, RLS, funciones, constraints no expresables en Prisma.
- **Regla de stewardship:** todo PR que agregue una tabla en SQL debe agregar el model Prisma correspondiente si algún router lo consumirá. Si la tabla es solo interna (pivot, audit, log), el model Prisma es opcional.

---

## Alternativas consideradas

### A1. Solo Prisma (`prisma migrate dev` como flujo único)

**Razon de rechazo:**

- Prisma no soporta: `SET LOCAL` GUCs, `SECURITY DEFINER` functions, audit triggers con hash chain, `CREATE POLICY` RLS, `ALTER ROLE ... SET` por tenant, ni `SECURITY INVOKER` views.
- Forzar todo en Prisma requeriría `prisma.$executeRaw` para cada objeto de BD avanzado, perdiendo el tracking de migraciones y el diff automático.
- El flujo `prisma migrate dev` contra Supabase (hosted) tiene limitaciones conocidas con extensiones (`pg_cron`, `pgvector`) y roles custom — ya documentado en CLAUDE.md.

### A2. Solo archivos SQL (sin Prisma)

**Razon de rechazo:**

- Los routers tRPC perderían type safety: `prisma.patient.findMany()` retornaría `unknown` o requeriría tipos manuales.
- El DX de @Dev degradaría significativamente: sin autocompletado de campos, sin validación de tipos en compile time, sin `include`/`select` tipados.
- Generación de tipos desde SQL (e.g. `pgTyped`, `zapatos`) introduce tooling adicional no justificado dado que Prisma ya resuelve esto.

---

## Trade-offs

| Dimensión | Schema dual | Solo Prisma | Solo SQL |
|---|---|---|---|
| Type safety en routers | Alta (Prisma) | Alta | Baja |
| Expresividad BD (RLS, triggers) | Completa (SQL) | Parcial | Completa |
| Riesgo de drift | **Presente** | Nulo | Nulo |
| Curva de onboarding | Media | Baja | Alta |
| Compatibilidad Supabase | Total | Parcial | Total |

El drift es el costo principal. Mitigado con:
1. Regla de stewardship en CLAUDE.md (sección "Gotchas concretos").
2. Este ADR como referencia obligatoria en PRs que toquen schema.
3. `prisma db pull` disponible como herramienta de diagnóstico (no como flujo principal).

---

## Consecuencias

### Positivas

- Prisma provee type safety y DX completo para el 90% del acceso a datos (routers tRPC).
- Los archivos SQL expresan la superficie de seguridad completa (RLS, audit) sin restricciones del ORM.
- `prisma db pull` puede detectar drift en cualquier momento como herramienta de auditoría.

### Negativas / riesgos

- **Drift posible:** una tabla creada en SQL pero no agregada a `schema.prisma` es invisible para los routers hasta que se sincroniza manualmente. Historial de instancias: `LabReferenceRange`, `LabReflexRule`, columna BCMA en `MedicationAdministration` (documentadas en CLAUDE.md).
- **No hay migración automática:** el flujo de deploy requiere aplicar SQL files al proyecto Supabase vía MCP y luego ejecutar `prisma generate`. Si se invierte el orden, el client generado no refleja el schema real.
- **Responsabilidad del PR author:** no hay tooling que bloquee automáticamente un PR con drift — la revisión de @DBA en la checklist de DoD es la única guardia.

---

## Regla operacional (extracto para PRs)

> Si tu PR agrega `CREATE TABLE` en un archivo SQL bajo `packages/database/sql/` **y** algún router tRPC necesitará leer/escribir esa tabla, debes agregar el model Prisma correspondiente en `schema.prisma` en el mismo PR.

---

## Referencias

- CLAUDE.md §"Sin carpeta `prisma/migrations`" y §"Schema drift Prisma vs SQL"
- Newman, S. — *Building Microservices* (2nd ed.), Cap. 4: "Database Decomposition" — fundamento para separar contratos de ORM de implementación de BD
- Vernon, V. — *Implementing Domain-Driven Design*, Cap. 12: "Repositories" — justificación de mantener el modelo de dominio (Prisma) desacoplado del mecanismo de persistencia (SQL nativo)
- `packages/database/sql/README.md` — convención de numeración de archivos SQL
- ADR 0012 — Estrategia RLS ECE (ejemplo de objeto SQL no expresable en Prisma)

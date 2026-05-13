# ADR 0005 — Catálogo global vs tenant en `Drug`, `LabPanel`, `Insurer`, `StockItem`

- **Estado:** Aceptado
- **Fecha:** 2026-05-13
- **Decisores:** @AS (proponente), @AE, @DBA, @PO
- **Fase:** 2 (Waves 7/8)
- **Norma de referencia:** TDR §15.2 (DNM), §17.2 (catálogo MINSAL labs), §25.2 (aseguradoras), §19.2 (inventario).

## Contexto

Phase 2 introduce 4 catálogos de naturaleza híbrida que la plataforma puede entregar **prepoblados** (alineados a entes regulatorios SV) pero que cada organización-tenant debe poder **complementar o sobrescribir**:

| Catálogo     | Fuente global             | Razón de override por tenant                                  |
|--------------|---------------------------|---------------------------------------------------------------|
| `Drug`       | DNM (Dirección Nac. Medicamentos) — registro sanitario | Hospital agrega genéricos no en DNM, magistrales, productos importados |
| `LabPanel`   | MINSAL — catálogo de pruebas | Lab privado define paneles propios (mercadeo, oncología avanzada) |
| `Insurer`    | CSSP / SISAS — aseguradoras autorizadas | Cobertura interna, convenios particulares de cada hospital     |
| `StockItem`  | DNM + insumos genéricos   | Cada hospital tiene SKUs internos + dispositivos médicos no DNM |

Patrones rechazados:

1. **Solo catálogo global.** Reduce flexibilidad: hospitales no podrían registrar productos sin esperar a que el ente regulatorio los incorpore.
2. **Solo catálogo por tenant.** Duplicación masiva: cada tenant tendría que recrear 5000+ medicamentos del DNM, alta carga operativa.
3. **Tabla global + tabla tenant separadas.** Joins/UNIONs en cada query complican la capa de aplicación y rompen tipados Prisma.

## Decisión

**Single-table inheritance vía `organizationId NULL` para registros globales:**

```prisma
// packages/database/prisma/schema.prisma
model Drug {
  id             String   @id @default(cuid())
  organizationId String?  // NULL = catálogo global (DNM)
  organization   Organization? @relation(...)

  // ... campos del medicamento

  @@unique([organizationId, registroSanitario])  // único por scope
  @@index([organizationId])
  @@map("Drug")
}
```

Reglas:

1. **Lectura**: el filtro tenant aplica `OR (organizationId = currentOrg OR organizationId IS NULL)` — ver ADR-0001 (AND-compose) para implementación segura.
2. **Escritura nueva**: el caller debe indicar explícitamente si crea registro global (`organizationId: null`, requiere rol `PLATFORM_ADMIN`) o de tenant (`organizationId: currentOrg`, rol staff).
3. **Override**: si un tenant necesita modificar un registro global, **clona** a uno local (`copy + set organizationId`) — nunca edita el global. Esto preserva el catálogo de referencia.
4. **Resolución de conflicto**: si en un tenant existen ambos (global + propio con misma clave de negocio), la UI muestra ambos diferenciados; los workflows clínicos (e.g. prescription) consumen el local con preferencia.

## Consecuencias

**Positivas:**
- Catálogo prepoblado out-of-the-box: tenant arranca con miles de medicamentos/labs sin importación manual.
- Flexibilidad de override sin perder el catálogo base.
- Modelo Prisma único = tipos TypeScript uniformes y queries más simples.
- RLS subyacente refuerza el filtro tenant (defensa en profundidad).

**Negativas:**
- `organizationId NULL` complica el unique constraint — requiere `@@unique([organizationId, key])` con awareness de que NULL en Postgres es "distinto de NULL" (cada registro global con misma key es técnicamente único entre sí). Mitigación: trigger de validación o constraint check parcial.
- AND-compose obligatorio en cada query — un fallo de patrón expondría catálogo global de otros tenants (¡que es por diseño leíble!). El riesgo real es exponer registros tenant-private de otra organización; AND-compose lo previene.
- Mass-update del catálogo global (e.g. DNM publica nueva versión) requiere job batch — fuera de scope MVP, queda en backlog @DE.

**Neutrales:**
- Migración de catálogos a Phase 2: seed DNM/MINSAL ya está en `packages/database/seeds/` (pendiente verificación con @DBA).

## Alternativas consideradas

1. **`isGlobal: Boolean` + `tenantId` opcional.** Rechazada: redundancia (la información ya está en `organizationId IS NULL`). Añade campo que debe mantenerse consistente.
2. **Tabla `DrugGlobal` + `DrugTenant` separadas.** Rechazada: doble Prisma model, doble router, doble RLS — explosión de complejidad para el mismo concepto.
3. **JSONB campo `overrides` en registros tenant que apuntan al global.** Rechazada: pierde tipado, complica queries, dificulta integridad referencial.
4. **Catálogo solo en config app (no en BD).** Rechazada: el TDR exige catálogos versionables, auditables y consultables por reportes regulatorios.

## Referencias

- `packages/database/prisma/schema.prisma` — modelos `Drug`, `LabPanel`, `Insurer`, `StockItem`.
- `apps/web/src/server/api/routers/drug.ts` — implementación con AND-compose para catálogo global.
- `packages/database/sql/23_rls_catalog_gaps.sql` — RLS para catálogos globales (allow read; restrict write a admin).
- `docs/04_modelo_datos.md` §6 — estrategia de catálogos.
- ADR-0001 (AND-compose) — patrón obligatorio para queries multi-tenant.
- TDR §15.2, §17.2, §25.2, §19.2.

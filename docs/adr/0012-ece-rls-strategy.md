# ADR 0012 — ECE: Estrategia RLS — GUC-based via ece.set_ece_context vs JWT Claims

- **Estado:** Aceptado
- **Fecha:** 2026-05-17
- **Decisores:** @AS (proponente), @AE, @DBA
- **Fase:** Fase 2 — Sprint F2-S2 (ECE Historia Clínica)
- **Dependencias:**
  - `docs/12_rls_validation.md` — estrategia RLS del módulo HIS principal
  - CLAUDE.md §"Contrato RLS" — patrón `withTenantContext` con `SET LOCAL ROLE`
  - ADR 0011 — Motor data-driven (contexto de uso del RLS ECE)
  - `packages/database/sql/62_ece_07_rls.sql` — implementación DDL
  - Arts. 33, 42, 43, 53, 54, 55, 56 NTEC (Acuerdo 1616, MINSAL 2024)

---

## Contexto

El módulo HIS principal aplica multi-tenancy vía `withTenantContext(prisma, ctx.tenant, tx => ...)`,
que ejecuta `SET LOCAL app.current_org_id` + `SET LOCAL ROLE authenticated` dentro de una
transacción. Las policies RLS en `public.*` leen `current_setting('app.current_org_id')`.

El ECE requiere un contexto de seguridad **más granular** que el tenant principal:

1. **`app.ece_personal_id`** — identidad del profesional de salud dentro del ECE.
   No es el mismo que `auth.uid()`: un usuario Supabase puede tener múltiples registros
   en `ece.personal_salud` (p. ej. médico que trabaja en dos establecimientos).
2. **`app.ece_establecimiento_id`** — establecimiento activo dentro del episodio.
   Un paciente puede tener episodios en diferentes establecimientos del complejo; el RLS
   debe aislar por establecimiento, no solo por organización.

La pregunta es: ¿cómo se propaga este contexto al engine de RLS de Postgres?

---

## Decision

**Opción B: GUC SET LOCAL via `ece.set_ece_context(personal_id, establecimiento_id)`.**

```sql
CREATE OR REPLACE FUNCTION ece.set_ece_context(
  p_personal_id        uuid,
  p_establecimiento_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM set_config('app.ece_personal_id',
    coalesce(p_personal_id::text, ''), true);   -- true = use SET LOCAL
  PERFORM set_config('app.ece_establecimiento_id',
    coalesce(p_establecimiento_id::text, ''), true);
END;
$$;
```

Las policies RLS leen el contexto via helpers:

```sql
CREATE OR REPLACE FUNCTION ece.current_personal_id()
  RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.ece_personal_id', true), '')::uuid;
$$;
```

El router tRPC invoca `ece.set_ece_context` dentro de la misma transacción que ejecuta
las queries:

```ts
// packages/trpc/src/routers/workflow-instance.router.ts (pseudocódigo)
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT ece.set_ece_context(${ctx.ecePersonalId}, ${ctx.eceEstablecimientoId})`;
  // Ahora el rol 'authenticated' con RLS activo solo ve filas del establecimiento
  return tx.documentoInstancia.findMany({ ... });
});
```

---

## Alternativas consideradas

### A1. JWT Claims (app_metadata en Supabase JWT) — descartada

**Idea:** embeber `ece_personal_id` y `ece_establecimiento_id` en el JWT de Supabase
(`app_metadata`). Las policies RLS leen `auth.jwt()->'app_metadata'->>'ece_personal_id'`.

**Razón de rechazo:**

- **Latencia de propagación:** el JWT de Supabase tiene un TTL de 1 hora. Cambiar el
  establecimiento activo del profesional (p. ej. un médico que atiende en dos turnos en
  distintos servicios el mismo día) requiere forzar refresh del token. Esto agrega una
  operación de red en el hot path de cada cambio de contexto clínico.
- **Múltiples establecimiento por sesión:** el profesional puede tener roles en varios
  establecimientos simultáneamente. El JWT es un singleton por sesión; modelar múltiples
  contextos activos en un claim es una cadena JSON con lógica de selección — complejidad
  en SQL no justificada.
- **Depuración opaca:** cuando una policy falla, el debug requiere inspeccionar el JWT
  decodificado. Los GUCs son visibles con `SHOW app.ece_personal_id` en cualquier
  conexión de debug.
- **Patrón inconsistente:** el módulo HIS principal usa GUCs (`app.current_org_id`).
  Mezclar JWT claims para ECE y GUCs para HIS crea dos patrones de RLS en el mismo
  proyecto — deuda de conocimiento para desarrolladores nuevos.

### A2. Columna `personal_id` en cada tabla + WHERE en aplicación — descartada

**Idea:** todas las tablas ECE tienen `personal_id` y `establecimiento_id`. El router
filtra siempre con `WHERE establecimiento_id = ctx.eceEstablecimientoId`. Sin RLS.

**Razón de rechazo:**

- **Es el anti-patrón documentado en CLAUDE.md:** el filtro JS/TS es defensa débil.
  Si un router nuevo olvida el WHERE (o un query builder lo omite), la fila es visible
  sin autorización — y no hay segunda línea de defensa.
- **Precedente de seguridad:** ya se detectó este bypass en el módulo HIS principal
  (documentado en `docs/12_rls_validation.md` §"Gaps"). RLS fue la corrección.
- **Audit de seguridad:** los advisors de Supabase marcan como WARN las tablas sin RLS
  habilitado. La NTEC Art. 43 exige controles de acceso en BD, no solo en aplicación.
- **`BYPASSRLS` del rol Postgres:** el rol `postgres.<ref>` de Supabase tiene BYPASSRLS;
  sin RLS, cualquier fuga del role bypass (p. ej. un seed incorrecto en prod) expone
  todos los expedientes.

### A3. Schema separado con permisos GRANT por rol — descartada

**Idea:** el schema `ece` es accesible solo para el rol `ece_role`; se revoca `authenticated`
y se concede `ece_role` solo a usuarios con `personal_salud.activo = true`.

**Razón de rechazo:**

- Supabase Auth no gestiona roles Postgres personalizados por usuario — requería un
  `SET ROLE ece_role` explícito en cada conexión, equivalente a lo que hace `SET LOCAL ROLE`
  en el patrón GUC actual pero con gestión de roles adicional.
- Agregar un rol Postgres nuevo implica cambios en las políticas de GRANT de todas las
  tablas compartidas entre HIS y ECE (p. ej. `ece.establecimiento` referencia a
  `public."Organization"`).
- Complejidad operacional de gestión de roles sin beneficio incremental frente a RLS
  con GUCs — que ya está implementado y probado en el módulo HIS.

---

## Consecuencias

### Positivas

- **Consistencia con el módulo HIS principal:** mismo patrón GUC + `SET LOCAL` +
  `withTenantContext`. Un desarrollador que entiende el módulo HIS entiende ECE.
- **Cambio de contexto sin refresh de token:** el médico cambia de establecimiento
  cambiando el GUC en la siguiente transacción — sin latencia de red adicional.
- **Depuración directa:** `SELECT ece.current_personal_id()` en cualquier sesión de
  Supabase SQL Editor muestra el contexto activo.
- **Segunda línea de defensa bajo el trigger de certificación:** `ece.fn_check_dir_certificar`
  lee `ece.current_personal_id()` para verificar rol DIR — consistente con las policies RLS.
- **Auditoría automática:** `ece.bitacora_acceso` captura `auth_user_id` (de la sesión
  Supabase) y `establecimiento_id` (del GUC) en cada INSERT — sin código adicional en el router.

### Negativas / trade-offs

- **GUC = SET LOCAL → requiere transacción activa:** si `ece.set_ece_context` se llama
  fuera de una transacción, el GUC no persiste (silencioso). Documentado en CLAUDE.md.
  Mitigado con linting de router: un test de integración verifica que todas las queries
  ECE corren dentro de `prisma.$transaction`.
- **`SECURITY DEFINER` en `ece.set_ece_context`:** necesario para que el rol `authenticated`
  pueda ejecutar `set_config`. Riesgo: un error en la función podría elevar privilegios.
  Mitigado: la función solo llama `set_config` con GUCs de namespace `app.` — no modifica
  datos ni cambia ROLs.
- **Contexto compartido por conexión Postgres (pool):** si PgBouncer en modo transaction-pooling
  reutiliza una conexión sin limpiar los GUCs, el contexto puede filtrarse. Supabase usa
  `SET LOCAL` (scope de transacción), no `SET SESSION` — el GUC se revierte al fin de la
  transacción automáticamente.
- **No hay GUC para múltiples establecimientos activos simultáneamente:** el modelo actual
  asume un solo establecimiento por request. Si en Fase 3 se requiere acceso cross-
  establecimiento autorizado (p. ej. interconsulta), se necesitará extender el modelo.
  Decisión postergada a Fase 3 (registrada como deuda técnica en `docs/13_g0_closure_log.md`).

---

## Diseño de implementacion

### Invocación en el router tRPC

```ts
// Análogo a withTenantContext en el módulo HIS principal.
// Ubicación: packages/trpc/src/ece-context.ts
export async function withEceContext<T>(
  prisma: PrismaClient,
  ecePersonalId: string,
  eceEstablecimientoId: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT ece.set_ece_context(
        ${ecePersonalId}::uuid,
        ${eceEstablecimientoId}::uuid
      )
    `;
    return callback(tx);
  });
}
```

### Verificacion en CI

`packages/trpc/src/routers/__tests__/cross-tenant.integration.test.ts` incluye casos
que validan el aislamiento ECE:

- Con GUC seteado al establecimiento A, queries a `ece.paciente` no devuelven filas del
  establecimiento B.
- Sin GUC (`ece.current_personal_id()` retorna NULL), `SELECT` en `ece.paciente` devuelve 0 filas.
- La transición `certificar` con rol PHYSICIAN falla con EXCEPTION del trigger.

---

## Referencias

- CLAUDE.md §"Contrato RLS" — patrón GUC SET LOCAL para multi-tenancy HIS
- `docs/12_rls_validation.md` — gaps y remediaciones RLS módulo principal
- `packages/database/sql/62_ece_07_rls.sql` — implementación DDL completa
- `packages/database/sql/04_rls_session_helpers.sql` — analogía con `set_tenant_context`
- ADR 0011 — Motor data-driven (contexto de uso de `withEceContext`)
- OWASP Top 10 2021, A01 Broken Access Control — motivación de RLS como segunda línea
- Supabase docs, "Row Level Security" — comportamiento de `SET LOCAL` con connection pooling
- Arts. 33, 43 NTEC — obligatoriedad de controles de acceso a nivel de BD para ECE

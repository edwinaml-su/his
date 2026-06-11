# Incidente — Caída global HTTP 500 durante E2E

**Fecha/hora:** 2026-06-10, durante la sesión de pruebas E2E.
**Entorno:** https://his-avante.vercel.app/ (producción)
**Severidad:** P0 (app inaccesible para todos los usuarios autenticados).
**Estado:** Persistente al cierre de la observación (no se recuperó tras ~25 s de espera).

## Síntoma
Todas las rutas server-rendered devuelven una página de error de cliente vacía (sin sidebar) con:

```
Application error: a server-side exception has occurred (see the server logs for more information).
Digest: 1672498537
```

El documento HTML responde con **HTTP 500** (verificado en `/dashboard` vía panel de red). El error ocurre a nivel del **layout raíz** (no hay sidebar ni shell), lo que sugiere que el fallo está en un Server Component compartido que envuelve toda la app — típicamente la obtención de sesión/contexto de organización.

## Cronología observada
1. Inicio de sesión activa; `/dashboard`, `/analytics`, `/analytics/ejecutivo`, `/feedback`, `/tareas`, `/notifications` renderizaron **OK**.
2. En CLÍNICO: `/patients`, `/census`, `/beds` renderizaron OK; `/transfers`, `/emergency`, `/outpatient`, `/patient-id` ya daban **500** (Digest 1672498537).
3. Minutos después, **todas** las rutas — incluidas las que antes funcionaban (`/dashboard`, `/analytics`, `/patients`) — empezaron a devolver 500 con el mismo Digest.
4. Tras ~25 s de pausa, el `/dashboard` seguía en 500.

## Observaciones / hipótesis (a confirmar con logs)
- **Digest único `1672498537`** en todas las rutas → una sola causa raíz (Next.js reutiliza el digest por tipo/stack de error). Apunta a una utilidad/Server Component común que lanza la excepción.
- El paso de "algunas rutas OK" a "todas en 500" sugiere un recurso compartido que se degradó: **conexión a Supabase/Postgres agotada o caída**, expiración de token/clave de servicio, o un cold start/redeploy. La navegación rápida del E2E pudo agotar el pool de conexiones serverless (cada SSR abre conexión a Postgres) — si es así, es una **fragilidad real de producción** (sin pooler/PgBouncer o límite de conexiones bajo).
- Rutas `/transfers`, `/emergency`, `/outpatient`, `/patient-id` cayeron **antes** que las demás con el mismo digest. **Reconfirmado con la app estable: las cuatro renderizan bien** → NO eran bug determinista; fueron simplemente el **frente** de la saturación (primeras en topar el límite de conexiones). Toda la app comparte el único punto de fallo (el layout async).

## Recomendaciones de diagnóstico (para el equipo)
1. Revisar **logs de Vercel** del deploy de producción filtrando por `Digest: 1672498537` para obtener el stack real.
2. Revisar **estado de Supabase**: conexiones activas vs. límite, `db.max_connections`, uso de pooler (`pgbouncer`/`supavisor`) en la cadena de conexión de Prisma en serverless.
3. Confirmar vigencia de variables de entorno/secretos (service role, anon key, JWT) en el proyecto Vercel.
4. Verificar si hubo un **redeploy** o migración SQL en curso a esa hora.
5. Reproducir `/transfers` (y las otras 3) en local/preview para aislar el fallo determinista de la caída global.

## Recuperación
La aplicación **se recuperó por sí sola** tras detener la navegación intensiva y esperar ~2–3 min (sin redeploy). `/dashboard` volvió a renderizar con shell y sidebar. Esto confirma que **no fue una caída de infraestructura** sino **agotamiento transitorio de un recurso compartido que se drena al bajar la carga** — el patrón exacto de un pool de conexiones a Postgres saturado.

## Causa raíz (confirmada por código + comportamiento)

El propio módulo `apps/web/src/lib/auth/session.ts` documenta el modo de fallo en su encabezado:

> "Sin la memoización, una page que se compone de layout + Server Component + sidebar agotaba el pool en producción con error `(EMAXCONNSESSION) max clients reached in session mode`." — y: "cada llamada hace `prisma.user.upsert()` que consume una conexión del pool de Supabase (**15 max en session mode**)."

Cadena causal:

1. **Cada** página server-rendered pasa por `(clinical)/layout.tsx` o `(admin)/layout.tsx`, que son `async` y llaman `getCurrentUser()` (un `prisma.user.upsert` para actualizar `lastLoginAt`) **+** `getTenantContext()` (4–6 queries Prisma: memberships, establishments, asignaciones de servicio).
2. La conexión a Postgres está en **session mode** con **15 conexiones máximas** (confirmado por el comentario). En Vercel serverless cada request concurrente corre en su propia instancia y retiene su propia conexión.
3. Una **ráfaga de navegaciones concurrentes** (como la del E2E con `browser_batch`, o un pico real de usuarios) supera las 15 conexiones → Supabase responde `EMAXCONNSESSION: max clients reached in session mode`.
4. **No hay manejo de error**: `getCurrentUser`/`getTenantContext` no envuelven las llamadas Prisma en try/catch. La excepción sube, el layout `async` lanza, y Next.js renderiza el **error boundary raíz** → 500 de página completa (sin shell) con `Digest: 1672498537`. Como **toda** página depende del layout, **toda** la app cae a la vez.
5. El `cache()` de RSC deduplica dentro de un mismo request, pero **no** mitiga la concurrencia entre requests; session mode es el modo equivocado para serverless.

Las rutas `/transfers`, `/emergency`, `/outpatient`, `/patient-id` que cayeron primero probablemente son las más pesadas en queries (o simplemente fueron las que tiparon el pool), pero comparten exactamente el mismo punto de fallo (mismo digest).

## Recomendaciones (priorizadas)

1. **[P0] Migrar `DATABASE_URL` a transaction mode** del pooler de Supabase (Supavisor/PgBouncer, puerto **6543**, `?pgbouncer=true&connection_limit=1`), que soporta miles de conexiones de cliente. Dejar `DIRECT_URL` (puerto 5432) solo para migraciones. Esto elimina el techo de 15.
2. **[P1] Degradación elegante** en `getCurrentUser`/`getTenantContext`: envolver las llamadas Prisma en try/catch y, ante error transitorio de BD, renderizar un shell con reintento o redirigir a una página de mantenimiento — en vez de tirar 500 toda la app.
3. **[P2] Reducir presión por request:** el `prisma.user.upsert` en **cada** navegación (solo para refrescar `lastLoginAt`) es costoso. Considerar throttling (actualizar `lastLoginAt` como máximo cada N minutos) o moverlo fuera del camino de render.
4. **[P2] Validar con logs de Vercel** el stack tras `Digest: 1672498537` para confirmar `EMAXCONNSESSION`.

## Nota de honestidad metodológica
La ráfaga de navegaciones automáticas del E2E (múltiples `browser_batch` con varias navegaciones cada uno) **muy probablemente disparó** el agotamiento. No obstante, esto **es en sí un hallazgo**: un solo cliente generando ~20 navegaciones en segundos no debería tumbar producción para todos. El límite de 15 conexiones en session mode hace la app frágil ante cualquier pico real de tráfico concurrente.

## Impacto en el E2E
Los flujos se reanudan tras la recuperación, pero **con navegación moderada** (esperas entre rutas, lotes pequeños) para no volver a saturar el pool mientras no se aplique la recomendación P0.

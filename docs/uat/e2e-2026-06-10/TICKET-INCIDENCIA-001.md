# Ticket de Incidencia — INC-2026-06-10-001

> Emitido por **@QA** (Fase 5 — Validación) · Dirigido a **@Orq** para reasignación a **@Dev** · Marco SDLC Autónomo Avante.

| Campo | Valor |
|---|---|
| **ID** | INC-2026-06-10-001 |
| **Título** | Caída global HTTP 500 por agotamiento del pool de conexiones a Supabase |
| **Severidad** | **P0 — Crítico** (app inaccesible para todos los usuarios autenticados) |
| **Prioridad** | Alta |
| **Entorno** | Producción — https://his-avante.vercel.app/ (Vercel serverless) |
| **Detectado en** | Sesión E2E del 2026-06-10 |
| **Detectado por** | @QA (E2E navegador) |
| **Componente** | `apps/web/src/lib/auth/session.ts` + layouts `(clinical)`/`(admin)` + conexión Prisma→Supabase |
| **Estado** | EN PROGRESO (2026-06-10) — código de defensa aplicado por @Dev; **pendiente:** cambio de env (Edwin) + prueba de carga + re-test @QA |

## Descripción

Bajo una ráfaga de navegaciones concurrentes, **todas** las rutas server-rendered de la aplicación comienzan a devolver HTTP 500 con una página de error de cliente vacía (sin shell ni sidebar):

```
Application error: a server-side exception has occurred (see the server logs for more information).
Digest: 1672498537
```

El fallo es **global** (toda la app cae a la vez) y **transitorio**: se recupera por sí solo (~2–3 min) al bajar la carga, sin redeploy.

## Pasos para reproducir

1. Iniciar sesión en producción.
2. Navegar rápidamente entre múltiples rutas server-rendered en pocos segundos (p. ej. 15–20 navegaciones consecutivas).
3. Observar que, tras superar cierto umbral de concurrencia, todas las rutas (incluido `/dashboard`) devuelven 500 con `Digest: 1672498537`.
4. Esperar ~2–3 min sin navegar → la app vuelve a renderizar normalmente.

## Resultado esperado vs. obtenido

- **Esperado:** La app tolera picos de navegación/tráfico concurrente sin caer; ante un error transitorio de BD, degrada con gracia (reintento/mantenimiento) en lugar de tumbar toda la app.
- **Obtenido:** Un solo cliente con ~20 navegaciones en segundos satura el pool y deja la app en 500 global para todos los usuarios.

## Causa raíz (confirmada por código + comportamiento)

`apps/web/src/lib/auth/session.ts` documenta el modo de fallo: el pool de Supabase está en **session mode con 15 conexiones máximas**. Cada página pasa por un layout `async` (`(clinical)/layout.tsx`, `(admin)/layout.tsx`) que llama `getCurrentUser()` (un `prisma.user.upsert`) + `getTenantContext()` (4–6 queries Prisma). En Vercel serverless cada request concurrente retiene su propia conexión; al superar 15 → `EMAXCONNSESSION: max clients reached in session mode`. Como **no hay try/catch**, la excepción tira el layout y Next renderiza el error boundary raíz → 500 de página completa en toda la app. El `cache()` de RSC deduplica dentro de un request pero no mitiga la concurrencia entre requests.

Detalle técnico completo en [`99_incidente_500.md`](99_incidente_500.md).

## Solución propuesta (para @Dev, sujeta a diseño de @AS/@DBA)

| # | Acción | Prioridad | Estado |
|---|---|---|---|
| 1 | Migrar `DATABASE_URL` a **transaction mode** del pooler de Supabase (Supavisor, puerto 6543, `?pgbouncer=true&connection_limit=1`). Dejar `DIRECT_URL` (5432) solo para migraciones. | P0 | ⏳ pendiente Edwin (env Vercel) — `schema.prisma` ya tiene `directUrl`, zero-code |
| 2 | Degradación elegante ante throw del layout. | P1 | ✅ aplicado vía error boundaries (ver nota) |
| 3 | Throttle de `lastLoginAt` (no hacer `upsert` en cada navegación; máx. cada N min). | P2 | ⏭️ diferido (el FIX 1a resuelve la causa raíz; mejora futura) |
| 4 | Confirmar `EMAXCONNSESSION` en logs de Vercel filtrando por `Digest: 1672498537`. | P2 | ⏳ pendiente (logs Vercel) |

> **Nota sobre #2 (push-back @Dev, careful-coding):** NO se envolvió `getCurrentUser`/`getTenantContext` en try/catch — devolver `null` ante un error de BD haría que el layout (`if (!user) redirect("/login")`) expulse al login a un usuario con sesión válida. En su lugar se agregaron **error boundaries** de App Router. Detalle Next.js: un `error.tsx` NO captura el throw del `layout.tsx` de su mismo nivel; como el incidente es el layout `(clinical)`/`(admin)` lanzando, el boundary efectivo es **`apps/web/src/app/error.tsx`** (segmento raíz). Los `error.tsx` por grupo cubren errores de páginas preservando el shell. UI compartida: `apps/web/src/components/error-fallback.tsx`.

## Criterios de cierre (Definition of Done — @QA)

- [ ] `DATABASE_URL` en transaction mode verificado en Vercel (prod). — **pendiente Edwin**
- [ ] Prueba de carga: ≥ 50 navegaciones concurrentes sin 500 global. — **pendiente (post env)**
- [x] Degradación elegante ante throw del layout (no 500 crudo) — `app/error.tsx` + `(clinical)`/`(admin)/error.tsx` + `error-fallback.tsx`.
- [x] Tests verdes + typecheck + lint (workspaces tocados). Coverage global ≥80% se mide en `test:coverage` raíz (gate CI).
- [x] Entrada en matriz de trazabilidad — `docs/26_trazabilidad_matrix.md` §9.
- [ ] Re-testing E2E por @QA: sweep completo de rutas sin reproducir el incidente. — **pendiente (post env)**

## Asignación sugerida

@Orq → **@Dev** (implementación con `careful-coding`), con revisión de **@AS** (decisión de pooling) y **@DBA** (límites de conexión / modo del pooler). Cierre lo valida **@QA**.

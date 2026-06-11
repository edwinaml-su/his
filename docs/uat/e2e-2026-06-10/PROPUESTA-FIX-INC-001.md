> ⚠️ **Superseded por [`REMEDIACION-2026-06-10.md`](REMEDIACION-2026-06-10.md)**, que consolida el fix de TODOS los hallazgos. Este archivo se conserva como detalle del P0.

# Propuesta de fix — INC-2026-06-10-001 (pool de conexiones / 500 global)

> Estado: **PROPUESTA, NO APLICADA.** Para revisión de Edwin / @AS / @DBA antes de implementar. Sigue `careful-coding` (cambios mínimos y quirúrgicos).

## Causa raíz (resumen)
`DATABASE_URL` apunta al pooler de Supabase en **session mode** (15 conexiones máx). En Vercel serverless, las navegaciones escalan instancias y cada una retiene una conexión *pegada* (session mode no la libera por request). Al superar 15 → `EMAXCONNSESSION` → el layout `async` lanza → sin `error.tsx`, Next muestra la página cruda de 500 en toda la app.

## Fix primario (P0) — corrige la causa raíz. Cambio de configuración, **cero código**.

Migrar la conexión de la app a **transaction mode** del pooler (Supavisor), que multiplexa miles de clientes sobre pocas conexiones reales. Dejar **session mode / conexión directa** solo para migraciones.

En las variables de entorno del proyecto en **Vercel** (Production + Preview):

```bash
# App (runtime serverless) → TRANSACTION mode, puerto 6543
DATABASE_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Migraciones / Prisma CLI → DIRECT (session), puerto 5432
DIRECT_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Claves:
- **`6543` + `pgbouncer=true`** activa transaction mode (obligatorio con PgBouncer/Supavisor para que Prisma no use prepared statements persistentes).
- **`connection_limit=1`** por instancia serverless: cada lambda usa 1 conexión y la suelta al terminar la transacción; el pooler reparte.
- `schema.prisma` ya declara `url = env("DATABASE_URL")` + `directUrl = env("DIRECT_URL")` → **no requiere cambio de código**.

> Este solo cambio elimina el techo de 15 y, por sí mismo, resuelve el P0. No requiere tocar `session.ts`.

## Fix de defensa en profundidad (P1) — degradación elegante. **Cambio de código mínimo.**

Hoy no existe ningún `error.tsx`, por eso cualquier throw del layout muestra la página cruda de Next. Agregar un error boundary por grupo de rutas para que un fallo transitorio de BD muestre una pantalla amable con reintento, en vez de "Application error".

**Nuevo archivo** `apps/web/src/app/(clinical)/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";

export default function ClinicalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error en layout clínico:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Servicio temporalmente no disponible</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        No pudimos cargar esta sección. Suele ser un problema transitorio de
        conexión. Reintenta en unos segundos.
      </p>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Reintentar
      </button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>
      ) : null}
    </div>
  );
}
```

**Réplica idéntica** en `apps/web/src/app/(admin)/error.tsx` (mismo contenido; el grupo admin tiene el mismo patrón de layout `async`).

Efecto: el shell (sidebar/topbar del layout padre) se conserva y el usuario ve un "Reintentar" en lugar de una pantalla blanca con stacktrace. Es la red de seguridad si la BD vuelve a tener un blip; el fix P0 es lo que evita que ocurra.

> **No** se propone meter try/catch dentro de `getCurrentUser`/`getTenantContext`: devolver `null` ante un error de BD haría que el layout (`if (!user) redirect("/login")`) **expulse a un usuario con sesión válida** al login — peor UX y confuso para auditoría. El `error.tsx` es la forma correcta y mínima de degradar.

## Opcional (P2) — reducir presión de escritura

`getCurrentUser` hace `prisma.user.upsert({ update: { lastLoginAt: new Date() } })` en **cada** navegación. Con transaction mode ya no es crítico, pero se puede throttlear (actualizar `lastLoginAt` máx. cada N minutos) para bajar escrituras. **No recomendado de entrada** — agrega complejidad y el fix P0 ya resuelve el problema. Dejar como mejora futura solo si se observa presión de escritura en métricas.

## Plan de verificación (DoD)

1. Aplicar `DATABASE_URL` transaction mode en Vercel (Preview primero) → verify: `psql`/health OK.
2. Reanudar el **sweep E2E completo** (secciones 7–11) en Preview → verify: ninguna ráfaga produce 500 global (Digest `1672498537` no reaparece).
3. Si se agrega `error.tsx`: forzar un error de BD en Preview (p. ej. credenciales inválidas momentáneas) → verify: se muestra "Reintentar" con shell, no la página cruda.
4. typecheck + lint + tests verdes; entrada en matriz de trazabilidad.

## Qué NO incluye esta propuesta
- El fix de schema drift de Quirófano (`pc.orden_id`) es un hallazgo **separado** (HJ-QX-001) — ver `98_hallazgo_quirofano_schema_drift.md`.

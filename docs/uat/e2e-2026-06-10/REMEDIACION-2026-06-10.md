# Plan de Remediación — E2E HIS Avante 2026-06-10

> **Estado: APLICADO en código (2026-06-10) — pendiente cambio de env (Edwin) + prueba de carga.** Archivo único que remedia todos los hallazgos de la sesión E2E. Sigue `careful-coding`. El cambio de variable de entorno lo aplica Edwin (no se manejan credenciales).
>
> **Corrección importante al plan original (FIX 1b):** los `error.tsx` por grupo NO capturan el throw del `layout.tsx` de su mismo nivel (semántica de Next App Router). Como el P0 es el layout `(clinical)`/`(admin)` lanzando, se agregó **`apps/web/src/app/error.tsx`** (segmento raíz) — ese es el boundary que realmente atrapa el incidente. Los `error.tsx` por grupo se conservan para errores de páginas (preservan el shell). UI compartida en `apps/web/src/components/error-fallback.tsx`.
>
> **Estado por fix:** FIX 1a (env) ⏳ Edwin · FIX 1b (boundaries) ✅ · FIX 2 (quirófano) ✅ · FIX 3 (/beds) ✅ sin acción. Trazabilidad: `docs/26_trazabilidad_matrix.md` §9.

## Resumen de hallazgos y fixes

| ID | Sev. | Hallazgo | Tipo de fix | Esfuerzo |
|---|---|---|---|---|
| INC-2026-06-10-001 | P0 | 500 global por agotamiento del pool de conexiones (session mode, 15 máx) | Config (env) + 2 archivos código | Bajo |
| HJ-QX-001 | P2 | `pc.orden_id` inexistente en `listarProgramacion` (tarjeta "Cirugías del día") | 1 archivo código (2 líneas) | Trivial |
| OBS-BEDS | Bajo | `/beds` quedó en "Cargando…" | Verificación | Trivial |

---

## FIX 1 (P0) — Pool de conexiones → transaction mode

**Causa raíz:** `DATABASE_URL` usa el pooler de Supabase en *session mode* (15 conexiones). En Vercel serverless cada instancia retiene una conexión pegada; una ráfaga de navegación supera 15 → `EMAXCONNSESSION` → el layout `async` (`(clinical)/layout.tsx`, `(admin)/layout.tsx`) lanza → sin `error.tsx`, Next muestra el 500 crudo en toda la app. Confirmado por el comentario de cabecera de `apps/web/src/lib/auth/session.ts` y por el comportamiento (recupera sola al cesar la carga).

### 1a. Cambio de entorno (Vercel → Production y Preview) — CERO código

```bash
# Runtime de la app → TRANSACTION mode, puerto 6543
DATABASE_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Migraciones / Prisma CLI → conexión DIRECTA, puerto 5432
DIRECT_URL="postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

- `6543` + `pgbouncer=true` → transaction mode (multiplexa miles de clientes; obligatorio para que Prisma no use prepared statements persistentes).
- `connection_limit=1` → cada lambda usa 1 conexión y la libera al terminar la transacción.
- `schema.prisma` ya declara `url = env("DATABASE_URL")` + `directUrl = env("DIRECT_URL")` → **no requiere código**.
- Tras aplicar en Vercel: **Redeploy** para tomar las nuevas envs.

> Este cambio, por sí solo, elimina el techo de 15 y resuelve el P0. Los pasos 1b son defensa en profundidad.

### 1b. Red de seguridad — error boundaries (degradación elegante)

Hoy NO existe ningún `error.tsx`/`global-error.tsx` (verificado). Agregar uno por grupo de rutas para que un fallo transitorio muestre "Reintentar" conservando el shell, en vez de la página cruda de 500.

**Nuevo archivo `apps/web/src/app/(clinical)/error.tsx`:**

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
    console.error("Error en sección clínica:", error);
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

**Nuevo archivo `apps/web/src/app/(admin)/error.tsx`:** idéntico contenido (mismo patrón de layout `async`).

> **Push-back (careful-coding):** NO meter try/catch dentro de `getCurrentUser`/`getTenantContext`. Devolver `null` ante un error de BD haría que el layout (`if (!user) redirect("/login")`) **expulse al login a un usuario con sesión válida** — peor UX y ruido de auditoría. El `error.tsx` es la forma mínima y correcta.

---

## FIX 2 (P2) — Schema drift `pc.orden_id` en Programación Quirúrgica

**Archivo:** `packages/trpc/src/routers/ece/bridge-cirugia.router.ts` — procedimiento `listarProgramacion`, **ambas ramas** del `$queryRaw` (≈ líneas 518 y 547).

`ece.preop_checklist` no tiene columna `orden_id`; se enlaza por `episodio_hospitalario_id` (`sql/67_preop_checklist.sql`, `schema.prisma:5858`). `ece.reserva_sala_qx` (alias `r`) tiene `episodio_id` (`schema.prisma:6842`), que apunta al mismo episodio.

```diff
- LEFT JOIN ece.preop_checklist pc ON pc.orden_id = r.orden_qx_id
+ LEFT JOIN ece.preop_checklist pc ON pc.episodio_hospitalario_id = r.episodio_id
```

Aplicar el mismo cambio en las dos ocurrencias (rama `if (input.salaQxId)` y rama `else`).

---

## FIX 3 (Bajo) — `/beds` en "Cargando…"

No concluyente (pudo ser carga diferida o sin camas sembradas en el tenant activo, o coincidir con el inicio de la saturación del pool). **Acción:** reverificar `/beds` con la app sana tras el FIX 1; si persiste "Cargando…" sin resolver, abrir hallazgo aparte revisando el loader del mapa de camas y la query de ocupación.

---

## Orden de aplicación y verificación (DoD)

1. **FIX 1a** en Vercel (Preview primero) → redeploy → verify: health OK.
2. **Reanudar sweep E2E completo** (secciones 7–11: hospitalario, GS1, maternidad, soporte/finanzas, administración) en Preview → verify: ninguna ráfaga produce 500 global (Digest `1672498537` no reaparece).
3. **FIX 2** (rama `chore/fix-quirofano-programacion`) → verify: `/programacion` lista sin error 42703.
4. **FIX 1b** error.tsx → verify: forzar error de BD en Preview muestra "Reintentar" con shell.
5. **FIX 3** reverificar `/beds`.
6. typecheck + lint + tests verdes + coverage ≥ 80% + entrada en matriz de trazabilidad + review @QA (cierre de INC-2026-06-10-001 y HJ-QX-001).

## Trazabilidad
- Incidente P0: `TICKET-INCIDENCIA-001.md`, `99_incidente_500.md`
- Hallazgo Quirófano: `98_hallazgo_quirofano_schema_drift.md`
- Reporte por flujo: `00_resumen_e2e.md` + `01..06_*.md`

# Runbook: Sentry — HIS Multipaís

Nivel: SRE / Dev lead
Refs: TDR §29.4, §29.8 (PHI/PII redaction)

---

## 1. Configurar DSN en Vercel

1. Obtener DSN desde Sentry > Settings > Projects > HIS > Client Keys.
2. En Vercel Dashboard > Project > Settings > Environment Variables:

   | Variable | Entorno | Valor |
   |---|---|---|
   | `SENTRY_DSN` | Production, Preview | `https://xxx@oYYY.ingest.sentry.io/ZZZ` |
   | `SENTRY_ENVIRONMENT` | Production | `production` |
   | `SENTRY_ENVIRONMENT` | Preview | `preview` |
   | `SENTRY_RELEASE` | Production | dejar vacío — Vercel inyecta `VERCEL_GIT_COMMIT_SHA` automáticamente |
   | `NEXT_PUBLIC_SENTRY_DSN` | Production, Preview | mismo DSN (para client-side) |
   | `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Production | `production` |
   | `SENTRY_TRACES_SAMPLE_RATE` | Production | `0.05` |
   | `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | Production | `0.1` |

3. Redeploy para que las variables surtan efecto.
4. Verificar: abrir una ruta `/api/health` y luego `/no-existe` (404). Confirmar que el 404 llega a Sentry sin PII.

---

## 2. Silenciar errores conocidos

Editar `apps/web/sentry.shared.ts`, array `NOISY_ERROR_PATTERNS`:

```ts
const NOISY_ERROR_PATTERNS: RegExp[] = [
  // Existentes:
  /ResizeObserver loop .*/i,
  /Non-Error promise rejection captured/i,
  /Failed to fetch$/i,
  // Agregar nuevo patrón:
  /Mi error conocido específico/i,
];
```

Para ignorar un error por tipo (no por mensaje), usar `ignoreErrors` en `sentry.client.config.ts` o `sentry.server.config.ts`:

```ts
ignoreErrors: [
  'NEXT_NOT_FOUND',
  'NEXT_REDIRECT',
  'NombreDelErrorEspecifico',
],
```

---

## 3. Investigar un issue

1. Ir a Sentry > Issues > filtrar por `environment:production`.
2. Hacer clic en el issue. Ver:
   - **Stack trace**: qué archivo/línea lanzó el error.
   - **Breadcrumbs**: últimas acciones del usuario (URLs navegadas, requests XHR).
   - **Tags**: `organization_id`, `role`, `environment` — nunca debería aparecer `email` ni `dui` (verificar que PII está redactado).
   - **Context > Request**: headers y query params redactados.
3. Reproducir localmente: copiar el stack trace, aplicar `SENTRY_DSN=` vacío en `.env.local` para no contaminar prod.
4. Si el issue tiene `[REDACTED]` en campos donde se esperaría un valor legible para depurar, escalar a revisar el `deepScrub` en `sentry.shared.ts` — puede estar sobre-redactando.

---

## 4. Verificar que PII no llega a Sentry

Ejecutar localmente con DSN real (entorno staging):

```bash
# En .env.local
SENTRY_DSN=https://xxx@staging.sentry.io/YYY
SENTRY_ENVIRONMENT=test-local
```

Triggear un error deliberado con datos PII en el payload:

```ts
Sentry.captureException(new Error('test'), {
  extra: { dui: '12345678-9', email: 'test@test.com', organizationId: 'abc' }
});
```

Verificar en Sentry que `dui` y `email` aparecen como `[REDACTED]` pero `organizationId` pasa limpio.

---

## 5. Rollback

Si Sentry genera ruido o falsos positivos en produccion:

1. Quitar `SENTRY_DSN` y `NEXT_PUBLIC_SENTRY_DSN` en Vercel env vars.
2. Redeploy — la guard `if (dsn) { Sentry.init(...) }` en cada config file hace que Sentry no inicie sin DSN.
3. No se requiere code change.

---

## 6. Alertas recomendadas en Sentry

| Alert | Condicion | Canal |
|---|---|---|
| Error rate spike | >50 errores nuevos en 5 min | Slack #his-ops |
| Nuevo error en prod | 1ra vez que ocurre | Slack #his-ops |
| Performance: p95 > 3s | tRPC /api/trpc/* | Slack #his-ops |
| CSP violations | `csp-violation` events | Slack #his-security |

Configurar en Sentry > Alerts > Create Alert Rule.

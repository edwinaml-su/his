# Runbook: Content Security Policy (CSP) — HIS Multipaís

Nivel: SRE / Dev lead
Refs: OWASP A05, TDR §29 (Seguridad)

---

## Estado actual

CSP en **enforce mode con nonce por request** desde Sprint 5 Beta.22.

- `Content-Security-Policy` se genera en **`apps/web/src/middleware.ts`** — un nonce único por request (`crypto.randomUUID()` base64). `script-src 'self' 'nonce-{nonce}' 'strict-dynamic'` — **sin `'unsafe-inline'`**.
- El nonce se inyecta en los request headers (`x-nonce` + CSP) vía `NextResponse.next({ request: { headers } })`, threaded por `updateSession` (Supabase). Next.js 14 lo añade automáticamente a sus `<script>` de hidratación.
- Los headers estáticos (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) siguen en `apps/web/next.config.mjs` `headers()`.

**Por qué middleware y no next.config:** `headers()` es estático (build-time) y no puede generar un valor aleatorio por request. El nonce DEBE generarse en Edge runtime.

Server Components que necesiten el nonce: `import { headers } from "next/headers"; const nonce = headers().get("x-nonce")`.

---

## 1. Agregar un dominio nuevo

Cuando una nueva integracion requiere un origen que no esta en la CSP:

1. Identificar qué directiva aplica al recurso:
   - Scripts (`.js`): `script-src`
   - Estilos (`.css`): `style-src`
   - Imagenes: `img-src`
   - Fetch/WebSocket: `connect-src`
   - Iframes: `frame-src`
   - Fonts: `font-src`

2. Editar `apps/web/src/middleware.ts`, función `buildCspHeader()`:

   ```js
   // Ejemplo: agregar api.mapbox.com para maps
   "connect-src 'self' https://*.supabase.co ... https://api.mapbox.com",
   ```

3. Editar la directiva correspondiente en el array de `buildCspHeader()`.

4. Desplegar a Preview primero. Verificar que la nueva integracion funciona sin violaciones.

5. Merge a main.

**Regla:** no agregar `'unsafe-inline'` ni `'unsafe-eval'` para nuevas integraciones — usar dominios especificos. Si un SDK de tercero requiere `eval`, evaluar alternativa o aislar en iframe.

---

## 2. Investigar violaciones CSP

Las violaciones CSP llegan a Sentry con tag `csp-violation` (si se configura `report-uri`).

Para agregar `report-uri` (opcional, para reporte activo):

```js
// En buildCspHeader() (middleware.ts), agregar al final del array:
"report-uri https://oYYY.ingest.sentry.io/api/ZZZ/security/?sentry_key=XXX",
```

El endpoint de Sentry lo encuentras en: Sentry > Settings > Security Headers.

Sin `report-uri`, las violaciones solo aparecen en la consola del browser del usuario (DevTools > Console).

**Para investigar manualmente:**
1. Abrir la pagina en browser con DevTools > Console.
2. Las violaciones aparecen como: `Refused to load the script 'https://...' because it violates the following Content Security Policy directive: ...`
3. Identificar el origen bloqueado y la directiva.
4. Decidir: ¿es un recurso legitimo? → agregar dominio. ¿Es un XSS? → investigar inyeccion.

---

## 3. Rollback

Si el nonce CSP bloquea funcionalidad critica en produccion (ej. scripts de
hidratacion bloqueados → paginas en blanco):

**Rollback rápido (< 3 min, sin revertir el PR):**
En `apps/web/src/middleware.ts`, función `buildCspHeader()`, agregar
`'unsafe-inline'` temporalmente al `scriptSrc`:
```js
// ROLLBACK TEMPORAL — remover tras diagnóstico
`script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https://*.vercel-insights.com`
```
Commit + push + merge → Vercel redeploy automático. (Con `'strict-dynamic'`
presente, los browsers modernos IGNORAN `'unsafe-inline'`, pero los browsers
sin soporte `strict-dynamic` caen a `'unsafe-inline'` — degradación segura.)

**Rollback completo:**
1. `git revert` del PR de nonce-based CSP, o
2. Vercel Dashboard > Deployments > deploy anterior > Redeploy (instantáneo).

---

## 4. Nota: estado nonce-based ya alcanzado (Sprint 5)

El objetivo de remover `'unsafe-inline'` de `script-src` se logró en Sprint 5
Beta.22 (ver "Estado actual" arriba). `script-src` usa `'nonce-{nonce}'` +
`'strict-dynamic'`. Próximo endurecimiento posible (Sprint 6+): nonce también
en `style-src` (eliminar `'unsafe-inline'` de estilos) — requiere refactor de
estilos inline de Tailwind/Next, bajo ROI.

---

## 5. Dominios actuales en CSP (referencia rapida)

| Directiva | Origenes permitidos |
|---|---|
| `script-src` | `'self'`, `'nonce-{nonce}'`, `'strict-dynamic'`, (dev) `'unsafe-eval'`, `*.vercel-insights.com` |
| `style-src` | `'self'`, `'unsafe-inline'` |
| `img-src` | `'self'`, `data:`, `blob:`, `*.supabase.co` |
| `font-src` | `'self'`, `data:` |
| `connect-src` | `'self'`, `*.supabase.co`, `wss://*.supabase.co`, `*.vercel-insights.com`, `*.ingest.sentry.io` |
| `frame-src` | `'self'`, `*.supabase.co` |
| `frame-ancestors` | `'none'` |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |
| `form-action` | `'self'` |

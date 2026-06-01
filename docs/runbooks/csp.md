# Runbook: Content Security Policy (CSP) — HIS Multipaís

Nivel: SRE / Dev lead
Refs: OWASP A05, TDR §29 (Seguridad)

---

## Estado actual

CSP en **enforce mode** desde Sprint 4 Beta.21 (2026-05-30). Directiva enforce activa en `Content-Security-Policy`. Una directiva `Content-Security-Policy-Report-Only` mas estricta detecta nuevas violaciones antes de que lleguen a enforce.

Configuracion en: `apps/web/next.config.mjs` — funcion `headers()`.

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

2. Editar `next.config.mjs`, arrays `cspEnforce` y `cspReportOnly`:

   ```js
   // Ejemplo: agregar api.mapbox.com para maps
   "connect-src 'self' https://*.supabase.co ... https://api.mapbox.com",
   ```

3. Agregar en AMBOS arrays (`cspEnforce` y `cspReportOnly`) para consistencia.

4. Desplegar a Preview primero. Verificar que la nueva integracion funciona sin violaciones.

5. Merge a main.

**Regla:** no agregar `'unsafe-inline'` ni `'unsafe-eval'` para nuevas integraciones — usar dominios especificos. Si un SDK de tercero requiere `eval`, evaluar alternativa o aislar en iframe.

---

## 2. Investigar violaciones CSP

Las violaciones CSP llegan a Sentry con tag `csp-violation` (si se configura `report-uri`).

Para agregar `report-uri` (opcional, para reporte activo):

```js
// En cspEnforce, agregar al final:
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

## 3. Rollback a Report-Only

Si CSP enforce bloquea funcionalidad critica en produccion:

**Rollback inmediato (sin deploy):**
No es posible — la CSP esta hardcodeada en `next.config.mjs` y requiere redeploy.

**Rollback via deploy (< 3 min en Vercel):**

1. Editar `apps/web/next.config.mjs`:
   ```js
   // Cambiar:
   key: "Content-Security-Policy",
   // Por:
   key: "Content-Security-Policy-Report-Only",
   ```
2. Commit + push + merge a main.
3. Vercel redeploy automatico.

**Alternativamente**, si el commit esta en la branch reciente, usar Vercel Dashboard > Deployments > seleccionar el deploy anterior > Redeploy (instantaneo, sin nuevo commit).

---

## 4. Promover Report-Only a Enforce (futuro Sprint 5)

El objetivo final es remover `'unsafe-inline'` de `script-src` usando nonce-based CSP:

1. Implementar `middleware.ts` que genera un nonce por request.
2. Pasar el nonce a `headers()` y a los `<Script>` de Next.js.
3. Reemplazar `'unsafe-inline'` por `'nonce-{nonce}'` en la CSP.
4. Esta es la directiva mas estricta posible para Next.js App Router.

Scope: Sprint 5 hardening. Requiere cambios en middleware + layout.

---

## 5. Dominios actuales en CSP (referencia rapida)

| Directiva | Origenes permitidos |
|---|---|
| `script-src` | `'self'`, `'unsafe-inline'`, (dev) `'unsafe-eval'`, `*.vercel-insights.com` |
| `style-src` | `'self'`, `'unsafe-inline'` |
| `img-src` | `'self'`, `data:`, `blob:`, `*.supabase.co` |
| `font-src` | `'self'`, `data:` |
| `connect-src` | `'self'`, `*.supabase.co`, `wss://*.supabase.co`, `*.vercel-insights.com`, `*.ingest.sentry.io` |
| `frame-src` | `'self'`, `*.supabase.co` |
| `frame-ancestors` | `'none'` |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |
| `form-action` | `'self'` |

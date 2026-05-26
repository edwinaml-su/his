# Audit Cat-K — Portal Paciente

**Fecha:** 2026-05-26
**Alcance:** 12 páginas + 2 routers del portal paciente (`apps/web/src/app/(portal)/**`, `packages/trpc/src/routers/portal*.router.ts`).
**Streams:** 3 paralelos auditados por @QA en background.
**Marco:** completa la cobertura del audit masivo 2026-05-19 que dejó Cat-K como pendiente.

## Resumen ejecutivo

| Severidad | Hallazgos únicos | Notas |
|---|---:|---|
| **P0** | **6** | Bloqueador funcional + LOPD + security crítica |
| **P1** | **9** | Riesgos altos (drift schema, brute force, IDOR potencial) |
| **P2** | **8** | Calidad / UX / mantenibilidad |
| **P3** | **3** | Mejoras menores |
| **Total** | **26 únicos** | (33 reportados − 7 duplicados cross-stream) |

**Estado real del portal:** **NO FUNCIONAL en producción.** K-1.01 (portalAccount nunca se construye en el API route) hace que TODOS los `portalProcedure` lancen UNAUTHORIZED inmediatamente. Hasta resolver eso, el portal no atiende ninguna funcionalidad post-login.

## P0 (6 hallazgos — orden de remediación obligatorio)

### K-01 · portalAccount nunca se construye en API route
**Archivos:** `apps/web/src/app/api/trpc/[trpc]/route.ts:1-27` + `packages/trpc/src/context.ts:49`
**Problema:** `createTRPCContext` nunca recibe `portalAccount`. Default `null`. Todo `portalProcedure` lanza UNAUTHORIZED. Portal completo inoperable.
**Impacto operativo:** Login completa pero todas las acciones post-login (expediente, recetas, citas, MFA, ARCO) → 401.
**Fix:** Implementar `resolvePortalContext(req)` que lea cookie `portal-session`, query `PortalSession`, inyecte en context. **Bloqueador #1.**

### K-02 · Session token nunca persiste como cookie
**Archivos:** `apps/web/src/app/(portal)/portal/verify/page.tsx:20-26` + `packages/trpc/src/routers/portal.router.ts:424-429`
**Problema:** `verifyLogin` devuelve `{ token, expiresAt }` en body JSON. Cliente solo hace `router.push("/dashboard")` y descarta el token. Sin cookie HttpOnly. Si se almacena en localStorage queda vulnerable a XSS.
**Fix:** Server-side set-cookie en API route o server action con `HttpOnly; Secure; SameSite=Strict`. **Bloqueador #2.**

### K-03 · Token magic-link logueado en claro
**Archivos:** `packages/trpc/src/routers/portal.router.ts:141`
**Problema:** `console.log(\`[portal][magic-link] email=${email} purpose=${purpose} token=${token}\`)` loguea raw token (64 hex, pre-hash) + PII. Logs llegan a Vercel/Datadog/Supabase. Token válido 15min permite sesión hijack vía log exfiltration.
**Fix:** Eliminar el log o redactar: `console.log('[portal][magic-link] purpose=%s', purpose)`.

### K-04 · Sin rate-limit en auth endpoints
**Archivos:** `portal.router.ts:315-343` (requestLogin) + `350-430` (verifyLogin)
**Problema:** Ambos `publicProcedure` sin middleware throttling. `lockedUntil` existe en schema pero nunca se escribe. Atacante puede: (a) spam de magic links (agota cuota Resend/SES), (b) brute-force TOTP, (c) reconocimiento cuentas por timing side-channel.
**Fix:** Middleware Next.js con Upstash Redis sliding window, 5 req/min por IP en mutations `portal.auth.*`.

### K-05 · `ClinicalNote.isInternal` prometido pero no existe en schema
**Archivos:** `portal.router.ts:769-771` (docstring) + `portal.router.ts:879-895` (query) + `schema.prisma:2298-2326` (modelo)
**Problema:** Docstring promete excluir notas internas/confidenciales. Where solo filtra `signedAt: { not: null }`. Modelo `ClinicalNote` NO tiene campo `isInternal`/`confidential`/`showInPortal`. Notas psiquiátricas, trabajo social, sospecha de abuso llegan al portal sin que el clínico lo espere. Viola LGPDP Art. 9 + TDR §5.2.
**Fix:** Migración SQL + Prisma agregando `isPortalVisible Boolean @default(false)` a `ClinicalNote`. Filtrar `isPortalVisible: true` en where. Hasta que el campo exista, retornar array vacío.

### K-06 · `ece.solicitud_arco` sin RLS ni audit trigger en BD
**Archivos:** Gap completo en `packages/database/sql/` (cero referencias a `solicitud_arco` en SQL hardening)
**Problema:** Tabla schema `ece` sin `ENABLE ROW LEVEL SECURITY`, sin policy `paciente_id = current_portal_account_patient_id()`, sin trigger `AFTER INSERT/UPDATE EXECUTE FUNCTION audit.if_modified_func()`. LOPD Art. 18 exige trazabilidad inmutable del ejercicio de derechos ARCO.
**Fix:** Crear `packages/database/sql/96_arco_rls_hardening.sql` con ENABLE RLS + policies + audit trigger.

## P1 (9 hallazgos)

### K-07 · TOTP secret en plaintext en respuesta JSON
**Archivo:** `portal.router.ts:279` + `apps/web/src/app/(portal)/portal/settings/mfa/page.tsx:19-20, 57, 66-68`
**Fix:** Generar QR server-side con `qrcode` lib, devolver imagen base64. Limpiar caché React Query post-enrollment.

### K-08 · Magic link en URL no se invalida
**Archivo:** `apps/web/src/app/(portal)/portal/verify/page.tsx:15, 37`
**Fix:** `router.replace(pathname)` antes de redirección final.

### K-09 · `PortalMagicLink` sin policy RLS INSERT
**Archivo:** `packages/database/sql/52_portal_hardening.sql:54-57`
**Fix:** `CREATE POLICY portal_magic_link_insert ON "PortalMagicLink" FOR INSERT TO authenticated WITH CHECK ("accountId" = public.current_portal_account())`.

### K-10 · `PortalSession.create` sin `applyPortalContext` en tx
**Archivo:** `portal.router.ts:404-422`
**Fix:** `applyPortalContext(tx, acct.id)` antes de `portalSession.create` dentro de la transacción.

### K-11 · Middleware no protege `/portal/*`
**Archivo:** `apps/web/src/middleware.ts:4-11, 17-23`
**Fix:** Layout portal con server-side check de cookie sesión portal + redirect a `/portal/login`.

### K-12 · `failedLoginAttempts` nunca se incrementa
**Archivo:** `portal.router.ts:386-396`
**Fix:** Increment + `lockedUntil = now + 15m` cuando supere umbral. Consumir magic link en ambas ramas (éxito + fallo TOTP) para prevenir replay.

### K-13 · `ClinicalNote.authorId` expuesto al paciente
**Archivo:** `portal.router.ts:889`
**Fix:** Reemplazar `authorId: true` por `author: { select: { fullName: true } }`.

### K-14 · `crearSolicitud` ARCO: patient lookup fuera de `withPortalContext`
**Archivo:** `portal-arco.router.ts:52-58`
**Fix:** Mover lookup dentro del callback `withPortalContext`.

### K-15 · `OutpatientAppointment` sin `@@unique(providerId, scheduledAt)`
**Archivo:** `schema.prisma:1783-1813`
**Fix:** `@@unique([providerId, scheduledAt])` + migración SQL + booking dentro de `$transaction` con SELECT FOR UPDATE.

### K-16 · `LabResult` sin campo `confidential`/`showInPortal`
**Archivo:** `portal.router.ts:597-603` (comentario línea 603 documenta el gap)
**Fix:** Migración Prisma + SQL agregando ambos campos. Filtrar `confidential: false AND showInPortal: true` en query.

### K-17 · `labResults.get` retorna `order.patientId` en payload
**Archivo:** `portal.router.ts:678`
**Fix:** Eliminar `patientId: true` del select de `order`.

### K-18 · `getMisDocumentosFirmados` sin whitelist de `noteType`
**Archivo:** `portal.router.ts:879-895`
**Fix:** `noteType: { notIn: ["PSYCHIATRIC_EVAL", "SOCIAL_WORK", "INTERNAL_COORDINATION"] }` o usar `isPortalVisible` cuando exista (K-05).

## P2 (8 hallazgos)

### K-19 · `validateDUI` duplicado inlinado en portal.router.ts
**Archivo:** `portal.router.ts:31-44`
**Problema:** Comentario advierte drift con `@his/contracts`. Workspace import falla en vitest del paquete trpc.
**Fix:** Resolver import workspace + borrar copia. Cross-paridad test mientras.

### K-20 · `wardPatientId` no propagado a detalle de resultado
**Archivo:** `apps/web/src/app/(portal)/portal/resultados/[resultId]/page.tsx:37`
**Problema:** `useQuery({ resultId })` sin `wardPatientId` → tutor ve NOT_FOUND en detalle de pupilo.
**Fix:** Leer `wardPatientId` de searchParams y pasarlo: `useQuery({ resultId, wardPatientId })`.

### K-21 · Rangos de referencia sin estratificar sexo/edad
**Archivo:** `resultados/[resultId]/page.tsx:110-118`
**Problema:** UI usa `LabTest.refRangeLow/High` planos en vez de `LabReferenceRange` (que ya existe estratificado por sex+age).
**Fix:** Procedure JOIN a `LabReferenceRange` con sex+age del paciente.

### K-22 · `z.string().email()` sin `.max()` en `requestLogin`
**Archivo:** `portal.router.ts:316`
**Fix:** `z.string().email().max(254)` (RFC 5321).

### K-23 · TOTP seed enviado a `api.qrserver.com` (tercero)
**Archivo:** `apps/web/src/app/(portal)/portal/settings/mfa/page.tsx:72-79`
**Fix:** Generar QR localmente con `qrcode.react` o server-side con `qrcode` (puro Node.js).

### K-24 · `documentoTarget` ARCO UI sin `maxLength` client-side
**Archivo:** `apps/web/src/app/(portal)/solicitudes-arco/page.tsx:98-104`
**Fix:** `maxLength={200}` + contador análogo al de motivo.

### K-25 · `hce.vaccinations.list` sin paginación
**Archivo:** `portal.router.ts:741-759`
**Fix:** `take: 100` mínimo + indicador "mostrando primeras 100".

### K-26 · Resultados cualitativos sin `refRangeText` mostrado
**Archivo:** `resultados/[resultId]/page.tsx:110`
**Fix:** Añadir `refRangeText: true` al select. UI lo muestra cuando `refRangeLow`/`refRangeHigh` son null.

## P3 (3 hallazgos)

### K-27 · TZ shift en `birthDate` de mi-expediente
**Archivo:** `apps/web/src/app/(portal)/mi-expediente/page.tsx:80-83, 121-126, 158`
**Problema:** `new Date(patient.birthDate).toLocaleDateString("es-SV")` con `@db.Timestamptz()` muestra -1 día en UTC-6.
**Fix:** `toLocaleDateString` con `{ timeZone: 'UTC' }` o `parseDateOnly` de `apps/web/src/lib/date-only.ts`.

### K-28 · TZ shift en `scheduledAt` de citas
**Archivo:** `apps/web/src/app/(portal)/portal/citas/page.tsx:13-20`
**Problema:** `toLocaleString("es-SV")` sin `timeZone` fijo — paciente fuera de SV ve hora del browser. E2E con `timezoneId` fijo no detecta.
**Fix:** `timeZone: "America/El_Salvador"` en options.

### K-29 · Redirección post-login a `/dashboard` admin
**Archivo:** `apps/web/src/app/(portal)/portal/verify/page.tsx:24`
**Fix:** `router.push("/portal/dashboard")`.

## Sprint sugerido de remediación

| Sprint | Hallazgos | Esfuerzo | Justificación |
|---|---|---|---|
| **S-K-1 (Bloqueador)** | K-01, K-02 | ~4h | Sin esto el portal no opera |
| **S-K-2 (Seguridad crítica)** | K-03, K-04, K-05, K-06, K-23 | ~6h | LOPD compliance + brute-force + leak |
| **S-K-3 (RLS + IDOR potenciales)** | K-07 a K-15, K-16 | ~8h | Hardening defense-in-depth |
| **S-K-4 (Calidad clínica)** | K-17, K-18, K-21, K-25, K-26 | ~4h | Datos correctos al paciente |
| **S-K-5 (UX + TZ)** | K-19, K-20, K-22, K-24, K-27, K-28, K-29 | ~3h | Pulido |

**Total estimado:** ~25h trabajo. **Cero bloqueadores externos** (todas las dependencias en código + 1 SQL migration).

## Duplicados cross-stream (consolidados)

| Stream original | ID original | Consolidado como | Razón |
|---|---|---|---|
| K-1 | K1-03 | K-03 (mismo hallazgo) | Stream K-2 K2-05 = K1-03 |
| K-1 | K1-04 | K-04 | K3-07 = K1-04 |
| K-1 | K1-10 | K-12 | K3-05 = K1-10 |
| K-2 | K2-02 | K-05 | K3-02 ≈ K2-02 |
| K-2 | K2-03 | K-18 | (relacionado con K-05) |
| K-3 | K3-02 | K-05 | dup de K2-02 |
| K-3 | K3-05 | K-12 | dup de K1-10 |
| K-3 | K3-06 | K-16 (LabResult, no ClinicalNote) | hallazgo nuevo distinto a K-05 |
| K-3 | K3-07 | K-04 | dup de K1-04 |

## Patrones detectados (suma al audit 2026-05-19)

1. **Campos `*Visible`/`*Internal`/`*Confidential` sin implementar en schema** — la guardia de "qué exponer al paciente" vive solo en docstrings y comentarios, no en BD. Recurrente en K-05, K-16, K-18. Sprint específico de modelado de control de visibilidad clínica recomendado.

2. **Sesión portal sin glue server-side** — el portal asume "el cliente persistirá el token" pero ningún código lo hace. K-01 + K-02 son consecuencia de implementación incompleta del adapter Next.js ↔ tRPC para sesión portal.

3. **Rate-limiting ausente en toda la capa portal** — único tipo de endpoint no protegido por throttling.

4. **TZ shift recurrente** — patrón ya documentado en audit 2026-05-19 reaparece en K-27 + K-28. Falta lint rule o helper canónico forzado.

## Archivos auditados

**Stream K-1 (Identidad/Acceso):**
- `apps/web/src/app/(portal)/layout.tsx`
- `apps/web/src/app/(portal)/portal/login/page.tsx`
- `apps/web/src/app/(portal)/portal/verify/page.tsx`
- `apps/web/src/app/(portal)/portal/settings/mfa/page.tsx`

**Stream K-2 (Datos clínicos READ):**
- `apps/web/src/app/(portal)/mi-expediente/page.tsx`
- `apps/web/src/app/(portal)/portal/recetas/page.tsx`
- `apps/web/src/app/(portal)/portal/resultados/page.tsx`
- `apps/web/src/app/(portal)/portal/resultados/[resultId]/page.tsx`
- `apps/web/src/app/(portal)/portal/dashboard/page.tsx`

**Stream K-3 (Operaciones):**
- `apps/web/src/app/(portal)/portal/citas/page.tsx`
- `apps/web/src/app/(portal)/portal/vacunacion/page.tsx`
- `apps/web/src/app/(portal)/solicitudes-arco/page.tsx`
- `packages/trpc/src/routers/portal.router.ts`
- `packages/trpc/src/routers/portal-arco.router.ts`

**Archivos de soporte revisados:**
- `packages/trpc/src/context.ts`
- `packages/trpc/src/trpc.ts`
- `packages/trpc/src/rls-context.ts`
- `apps/web/src/app/api/trpc/[trpc]/route.ts`
- `apps/web/src/middleware.ts`
- `packages/database/sql/52_portal_hardening.sql`
- `packages/database/prisma/schema.prisma` (modelos `ClinicalNote`, `LabResult`, `LabTest`, `LabReferenceRange`, `OutpatientAppointment`, `PortalAccount`, `PortalSession`, `PortalMagicLink`, `EceSolicitudArco`)

# REQ-SEC-USR-001 — Alta de usuario end-to-end (HIS `public.User` ↔ Supabase `auth.users`) por invitación email

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0019** |
| Fecha | 2026-08-11 |
| Solicitante | Edwin Martínez (Inversiones Avante) — auditoría interna |
| Rama | `feat/cc-0019-alta-usuario-auth` |
| SQL | Ninguno. Sin columnas/tablas nuevas — `authStatus` se deriva por query, no se persiste. |
| Alcance | `userAdmin.create` funcional (Supabase Auth + invitación email) + `resendInvitation` + `listSinCuentaAuth` (reconciliación) + UI `/users` |

## 1. El bug (confirmado)

`packages/trpc/src/routers/user-admin.router.ts` `create` (línea ~175 antes de este cambio) era un stub:

```ts
create: tenantProcedure.input(userAdminCreateInput).mutation(async ({ ctx, input }) => {
  return await ctx.prisma.user.create({ data: { email, fullName, active: true, mfaEnabled: false, ... } });
}),
```

Solo escribía `public.User`. El login pasa por `supabase.auth.signInWithPassword` (`auth.users`) — un usuario creado desde `/users` **no podía iniciar sesión**: no existía en `auth.users`, sin credencial, sin invitación. Además, el gate de permisos era inexistente (`tenantProcedure` puro, cualquier miembro del tenant podía crear usuarios) pese a que el efecto ahora es crear una cuenta de autenticación real.

Hoy en prod hay paridad casual (6/6 usuarios existentes vienen de seed/SSO/reset admin) — el próximo alta por UI la habría roto.

## 2. Decisión de producto: invitación por email, sin exponer password

Al crear el usuario: se crea la cuenta en Supabase Auth **sin contraseña** y se envía un correo con un enlace para que el propio usuario fije su contraseña. Ningún admin ve ni transmite una contraseña.

## 3. Mecanismo elegido — y por qué

### 3.1 Crear la cuenta en `auth.users`: Admin API REST (no el SDK, no SQL raw)

`@his/trpc` no tiene `@supabase/supabase-js` como dependencia (solo `apps/web` la tiene). En vez de agregarla al paquete (nueva dependencia = `npm install` + riesgo de romper `npm ci` en CI, ver gotcha de CLAUDE.md), `packages/trpc/src/lib/supabase-admin.ts` llama al **Admin API de GoTrue directo con `fetch`** (Node 20+ nativo):

- `POST /auth/v1/admin/users` — crea la cuenta con `email_confirm: true` y **sin password**.
- `DELETE /auth/v1/admin/users/{id}` — compensación best-effort.
- `POST /auth/v1/admin/generate_link` — genera (NO envía) el enlace de "fijar contraseña".

Esto espeja **dos patrones ya existentes en el código base**, no uno nuevo:

1. `packages/database/scripts/seed-test-users.mjs` — ya hace `fetch` directo a `/auth/v1/admin/users` con `apikey`/`Authorization: Bearer <service_role>`.
2. `userAdmin.resetPassword` (Sprint 5, Beta.22) — ya resolvió el mismo dilema (sin SDK admin en `@his/trpc`) escribiendo `auth.users`/`auth.identities` con SQL raw vía `ctx.prisma.$executeRaw`. Este CC usa REST en vez de SQL raw porque `admin/users` y `admin/generate_link` no tienen equivalente trivial en SQL (GoTrue calcula tokens de invitación internamente).

`email_confirm: true` (no `false`): mismo valor que `seed-test-users.mjs`. Importa porque el mismo usuario puede más tarde entrar por Azure SSO — GoTrue hace *account linking* automático cuando el email coincide y ambas identidades están confirmadas, evitando una cuenta duplicada. Ver §5 (SSO dual).

### 3.2 El enlace: `type="recovery"`, no `type="invite"`

`generateAuthActionLink` usa `type: "recovery"` tanto para la invitación inicial como para reenvíos. Decisión deliberada, no un descuido:

- `apps/web/src/app/(auth)/recover/reset/page.tsx` **ya existe y ya está probado**: escucha el evento `PASSWORD_RECOVERY` de `supabase-js` (`onAuthStateChange`) y llama `updateUser({ password })`. Es el mecanismo exacto de "fijar contraseña" que necesitamos.
- `type="invite"` dispara semántica distinta en GoTrue (auto-creación de cuenta + evento de cliente no ejercitado en este código base). Como la cuenta la creamos nosotros explícitamente en el paso anterior (`createAuthUser`), no necesitamos que el link "cree la cuenta" — solo que permita fijar password. `recovery` cubre exactamente eso, con cero riesgo de un evento no probado.
- Consecuencia práctica: **no se creó ninguna página nueva** (`/recover/reset` ya sirve el flujo completo). El item "verificar que la ruta destino acepte el token de invite" del encargo queda satisfecho por diseño, sin tocar esa página.

**Riesgo declarado, no verificado en vivo:** el contrato exacto de la respuesta de `/admin/generate_link` (campo `action_link` top-level vs. anidado en `properties.action_link`) se documentó según la referencia pública de Supabase y se cubrió con ambas formas en `generateAuthActionLink` + tests (`packages/trpc/src/lib/__tests__/supabase-admin.test.ts`). **No se hizo una llamada real contra el proyecto Supabase de prod** (la tarea prohibía tocar prod; generar un link real habría creado una cuenta Auth real). Recomendación: antes de mergear, un smoke test manual con un usuario de prueba (crear → recibir correo → fijar password → login) usando `/admin/email-test` para confirmar SMTP y un usuario descartable para confirmar el link.

### 3.3 El envío: SMTP M365 propio del proyecto, no el de GoTrue

`/admin/generate_link` **nunca envía email** — solo genera el link. El envío usa `sendMail` de `@his/infrastructure` (`packages/infrastructure/src/notifications/smtp.ts`), el mismo adapter nodemailer→M365 ya usado por `/admin/email-test` (`apps/web/src/app/api/admin/email/test/route.ts`). El propio comentario de ese archivo ya nombraba "invitaciones" como caso de uso previsto:

> *"Útil para notificaciones operativas que no requieren routing complejo: invitaciones, recuperación, menciones, alertas ad-hoc."*

Por qué no usar el SMTP propio de GoTrue (configurable en Supabase Dashboard): usar nuestro propio `sendMail` da control total sobre el template, evita depender de si el SMTP de GoTrue está configurado a M365 (no verificado en esta tarea), y reusa el mismo camino de fallos/reintentos (`TransientProviderError`/`PermanentProviderError`) que el resto del proyecto.

### 3.4 Mapeo `User` (local) ↔ `auth.users`: por email

Mismo patrón que `resetPassword` y el callback SSO (`apps/web/src/app/(auth)/sso/callback/route.ts`): los ids son independientes (`User.id` sigue siendo `@default(uuid())` de Prisma, no se fuerza a igualar `auth.users.id`). Todo lookup es `WHERE lower(email) = lower($1)`.

## 4. Flujo `create` — orden y compensación

```
1. dupeLocal = SELECT ... FROM "User" WHERE email = $1
   → si existe: CONFLICT. (chequeo ANTES de tocar Auth — evita huérfanos)
2. provisionAuthAccount(email):
   a. SELECT id FROM auth.users WHERE email = $1
      → si existe: REUTILIZA (huérfano de un alta previa fallida, o
        pre-provisionada por otro flujo). GoTrue no permite emails
        duplicados, así que reutilizar es la única opción segura.
      → si no existe: createAuthUser(email) [REST, sin password]
   b. si createAuthUser falla: INTERNAL_SERVER_ERROR, nada se crea.
3. prisma.user.create({ email, fullName, active: true, ... })
   → si falla Y la cuenta Auth se creó EN ESTE REQUEST (no reutilizada):
     deleteAuthUser(authUserId) [best-effort, no enmascara el error]
   → rethrowPrisma(err)
4. sendAccountInvitation(email, fullName):
   generateAuthActionLink(type=recovery) + sendMail(...)
   → si falla: NO revierte nada. invitationSent=false en la respuesta;
     el usuario queda creado y usable vía "Reenviar invitación".
```

Devuelve `{ ...user, authCreated: true, invitationSent: boolean }`.

## 5. SSO dual (Azure) — no se bloquea

`resetPassword` ya documentó el patrón "login dual": un usuario con identidad `azure` puede ganar también una identidad `email` (y viceversa) porque GoTrue hace *account linking* automático quand el email coincide y está confirmado en ambos lados. `createAuthUser` usa `email_confirm: true` exactamente para no romper ese linking si el mismo usuario más tarde entra por Azure SSO. El callback SSO (`/sso/callback`) sigue exigiendo que `public.User` exista primero (regla "opción B" ya vigente, sin cambios) — este CC no toca esa regla.

## 6. Reconciliación de huérfanos

`userAdmin.listSinCuentaAuth` — usuarios locales **activos** sin fila en `auth.users` (por email). Cubre: usuarios creados por el stub viejo (pre-CC-0019) antes de este fix, o una carrera donde `create` falló entre pasos. Hoy son **0 en prod** (verificado en memoria de sesión — paridad 6/6), pero el mecanismo debe existir para el futuro.

`userAdmin.resendInvitation({ userId })` cubre dos casos con la misma lógica (`provisionAuthAccount` + `sendAccountInvitation`):

- Reenviar a alguien ya invitado (link expirado o perdido).
- Provisionar + invitar a un huérfano detectado por `listSinCuentaAuth`.

UI: `/users` muestra un banner "N usuario(s) sin cuenta de acceso" con botón "Crear cuenta e invitar" por fila (cuando `listSinCuentaAuth` no está vacío), más una columna "Cuenta acceso" (badge `SIN_CUENTA`/`INVITADO`/`ACTIVO`) y botón "Reenviar invitación" por fila en la tabla principal. La página de detalle (`/users/[id]`) agrega una card "Cuenta de acceso" con el mismo botón.

`authStatus` se deriva en cada query (`listAll`, `get`) con un `JOIN` liviano contra `auth.users` por email — **no se persiste** (sin columna nueva, sin SQL):

- `SIN_CUENTA`: no hay fila en `auth.users`.
- `INVITADO`: hay fila pero `last_sign_in_at IS NULL` (nunca completó login).
- `ACTIVO`: `last_sign_in_at IS NOT NULL`.

## 7. Gate de permisos

`create`, `resendInvitation`, `listSinCuentaAuth` migran de `tenantProcedure` (sin rol) a `requirePermission("user.manage")` — mismo permiso que ya usa `resetPassword` (CC-0017, otorgado a ADMIN por `194_cc0017_rbac_parametrizable.sql`, ya en prod). **Esto es un endurecimiento deliberado**, no parte literal del encargo original (que asumía que `create` ya tenía gate): antes cualquier miembro del tenant podía invocar `create`; ahora `create` provisiona cuentas de autenticación reales, mismo nivel de sensibilidad que `resetPassword` — se le aplica el mismo gate por consistencia y por prudencia de seguridad. `listAll`/`get`/`update`/`deactivate`/`assignRole`/`revokeRole` NO se tocaron (fuera de alcance de este CC).

## 8. Variables de entorno

| Variable | Ya existía? | Uso en este CC |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí (Vercel) | Base del Admin API REST (`supabase-admin.ts`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí (Vercel) | Bearer token del Admin API |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Documentadas en `.env.example` raíz; **estado real en Vercel Production NO verificado en esta tarea** | Envío de la invitación (`sendMail`) |
| `NEXT_PUBLIC_APP_URL` | Documentada en `.env.example` raíz; **estado real en Vercel Production NO verificado** | Construye el `redirectTo` (`${APP_URL}/recover/reset`) del enlace de invitación |

**⚠️ Bloqueante potencial declarado a @Orq:** `NEXT_PUBLIC_APP_URL` se inlinea en build time (prefijo `NEXT_PUBLIC_`, como `NEXT_PUBLIC_SUPABASE_URL` ya en este código base). Si no está configurada en Vercel Production/Preview, el fallback de código (`http://localhost:3000`) queda **horneado en el bundle de producción** y los enlaces de invitación apuntarían a localhost. Mismo riesgo para `SMTP_*`: si no están seteadas, `sendMail` lanza `EmailNotConfiguredError` y `invitationSent` queda `false` para todo alta (el usuario se crea igual, pero sin invitación — recuperable vía "Reenviar invitación" una vez configurado SMTP). **Verificar ambas antes de considerar esta feature lista para uso real en prod** — `/admin/email-test` ya existe para probar SMTP sin crear usuarios.

## 9. Archivos

- `packages/trpc/src/lib/supabase-admin.ts` (nuevo) — Admin API REST (`createAuthUser`, `deleteAuthUser`, `generateAuthActionLink`).
- `packages/trpc/src/lib/__tests__/supabase-admin.test.ts` (nuevo) — 11 tests, `fetch` mockeado.
- `packages/trpc/src/routers/user-admin.router.ts` — `create` reescrito; `resendInvitation` y `listSinCuentaAuth` nuevos; `authStatus` en `listAll`/`get`; gate `requirePermission("user.manage")`.
- `packages/trpc/src/routers/__tests__/user-admin-create-invite.test.ts` (nuevo) — 15 tests: happy path, reutilización de huérfano, compensación, fallos de Auth/email, gates.
- `packages/trpc/src/routers/__tests__/user-admin-auth-status.test.ts` (nuevo) — 4 tests de derivación `authStatus`.
- `packages/contracts/src/schemas/user-admin.ts` — `userAuthStatusSchema`, `userAdminResendInvitationInput`, `authStatus` en `userListItemSchema`.
- `apps/web/src/app/(admin)/users/page.tsx` — columna/badge `authStatus`, botón "Reenviar invitación", banner de reconciliación.
- `apps/web/src/app/(admin)/users/user-form.tsx` — feedback inline de `invitationSent` en el wizard.
- `apps/web/src/app/(admin)/users/[id]/page.tsx` — card "Cuenta de acceso" + badge + botón reenviar.
- `apps/web/.env.example`, `turbo.json` — documentan/declaran `NEXT_PUBLIC_APP_URL` + `SMTP_*`.

## 10. Verificación

- `npm run -w @his/contracts typecheck` — verde.
- `npm run -w @his/trpc typecheck` — verde.
- `npm run -w @his/web typecheck` — verde.
- `npx vitest run` en `packages/trpc` — 191 archivos, 2883 tests, verde (incluye los 30 tests nuevos de este CC).
- `npx vitest run` en `packages/contracts` — 45 archivos, 1732 tests, verde.
- `npx vitest run` en `apps/web` — 54 archivos, 597 tests, verde.
- `npm run -w @his/web lint` — sin warnings nuevos en archivos tocados (warnings preexistentes en otros archivos, no relacionados).
- Sin SQL aplicado a prod. Sin PR abierto (por instrucción explícita de la tarea).

## 11. Pendiente / fuera de alcance de este CC

- Smoke test manual real (crear usuario de prueba → recibir correo → fijar password → login) — no ejecutado en esta sesión (evita crear cuentas Auth reales en prod sin autorización explícita).
- Verificar en Vercel Dashboard que `SMTP_*` y `NEXT_PUBLIC_APP_URL` estén seteadas en Production — no verificable desde este entorno de agente.
- `listAll`/`get` no estaban cubiertos por tests antes de este CC (solo se agregó cobertura para `authStatus`, la parte nueva) — deuda preexistente, no de este CC.

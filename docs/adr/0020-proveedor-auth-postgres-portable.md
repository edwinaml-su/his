# ADR 0020 — Proveedor de autenticación para un Postgres portable fuera de Supabase

- **Estado:** Propuesto — decisión abierta, requiere elección de Edwin (impacto de costo/arquitectura)
- **Fecha:** 2026-08-19
- **Decisores:** @AT (proponente, este documento), pendiente sign-off de @AS + @SRE + Edwin
- **Fase:** Evaluación de portabilidad (sprint `feat/db-portable`), categoría A del runbook de
  reconstrucción
- **Dependencias:**
  - `docs/runbooks/db-reconstruccion-fuera-de-supabase.md` §3 (prerrequisitos de portabilidad,
    reescrita en el mismo PR que este ADR)
  - `docs/runbooks/e2e-gotrue-auth.md` (stack GoTrue real ya levantado para E2E, con bloqueo abierto)
  - `packages/trpc/src/rls-context.ts` (`withTenantContext` — el mecanismo real de RLS en producción)
  - `docker-compose.test.yml`, `scripts/gotrue-test-*` (el stack que se evalúa reutilizar)
  - `packages/trpc/src/routers/user-admin.router.ts` (`resetPassword`, único write directo a `auth.*`)

---

## Contexto

Edwin quiere la **capacidad** de migrar la base de datos de HIS fuera de Supabase (K8s/Docker/RDS/
on-prem) — no una migración inminente, sino no quedar atado a una sola plataforma. El runbook de
reconstrucción (`db-reconstruccion-fuera-de-supabase.md`) cuantificó 6 dependencias reales de la
plataforma Supabase; 5 de ellas tienen sustituto barato y probado (roles, schema `extensions`, `pg_cron`
→ scheduler externo, Vault → AES app-layer ya existente, `pgcrypto`/`crypt`). La sexta —
autenticación— es la única que requiere una decisión de arquitectura con costo real, y es el objeto de
este ADR.

**Hallazgo que cambia el marco del problema:** el diagnóstico original trataba "RLS depende de
`auth.*`" como parte del mismo gap que "el login depende de GoTrue". Se probó (Postgres 18.4 nativo,
sin Docker, sin que el schema `auth` existiera en ningún momento) que **RLS multi-tenant funciona
end-to-end sin `auth.*`** — `withTenantContext` setea GUCs (`app.current_org_id`) directamente, y las
políticas RLS los leen sin pasar por `auth.jwt()`. El aislamiento por tenant, el motor ECE, la cadena de
hash de auditoría, ninguno de esos depende de GoTrue en runtime.

Lo que sí depende de GoTrue, de forma real y no evitable sin reescribir código:

1. **17 archivos** de `apps/web`/`packages/trpc` llaman `supabase.auth.*` (`signInWithPassword`,
   `getUser`, `getSession`) — la sesión de usuario en el navegador.
2. **SSO Azure** (`apps/web/src/app/(auth)/sso/*`) — depende del flujo OAuth de GoTrue.
3. **MFA** (`apps/web/src/app/actions/mfa.ts`) — depende de los endpoints de MFA de GoTrue.
4. **`userAdmin.resetPassword`** — escribe directo a `auth.users`/`auth.identities` (bypassa
   `supabase-js`, pero sigue dependiendo del schema `auth` de GoTrue).
5. **6 FK `REFERENCES auth.users(id)`** en tablas de dominio (`fall_event`, `personal_salud`,
   `proceso_b_transfers` ×2, `inventory_thresholds`, `certificado_defuncion`) — de bajo costo (apuntar a
   `public."User"(id)` en su lugar, probado), pero solo se resuelven una vez que se sepa qué tabla de
   usuarios es la autoritativa.

---

## Opciones consideradas

### Opción A — Self-hosted GoTrue (reusar y madurar el stack de E2E)

El proyecto ya tiene, en `docker-compose.test.yml`, un stack real de GoTrue (mismo binario que usa
Supabase managed) con: bootstrap de schema `auth` + rol `postgres`, gateway nginx que traduce
`/auth/v1/*` (convención de Kong que GoTrue no implementa por sí solo), y generación de JWT compatible.
Verificado contra el código fuente real de `supabase/auth`, no adivinado — ver
`docs/runbooks/e2e-gotrue-auth.md`.

**Pros:**
- Cero reescritura de los 17 call sites de `supabase-js`, ni de SSO Azure, ni de MFA — todos hablan el
  mismo protocolo (`GoTrue REST + JWT HS256`) sea el backend Supabase managed o self-hosted.
- El trabajo de investigación más difícil (qué migraciones corre GoTrue, qué prefijo de ruta espera,
  qué variables de entorno importan) ya está hecho y verificado contra runs reales de CI.
- Camino de rollback simple: si algo falla, se puede volver a apuntar `NEXT_PUBLIC_SUPABASE_URL` a
  Supabase managed sin tocar código de aplicación.

**Contras:**
- **Bloqueo funcional sin resolver**: `500 Database error checking email` al crear el primer usuario
  (`docs/runbooks/e2e-gotrue-auth.md` §2) — nadie ha visto un login completo funcionar contra este stack
  todavía, ni en E2E ni en esta evaluación.
- 6 brechas de madurez de producción sin cerrar: persistencia (el compose de test usa `tmpfs`),
  gestión de secretos (`GOTRUE_JWT_SECRET` con default hardcodeado "no usar en prod"), correo real
  (`GOTRUE_MAILER_AUTOCONFIRM=true` en test), HA (un solo contenedor, punto único de falla para todo
  login), verificación end-to-end de sesión real, y superficie de parcheo propia (CVEs de un servicio de
  auth que el equipo nunca operó, hoy gestionados de forma transparente por Supabase).
- Opera un componente adicional (Go binario + su propio ciclo de vida de dependencias) que hoy es
  invisible para el equipo.

### Opción B — Reescribir contra un proveedor propio (ej. NextAuth/Auth.js + `public."User"`)

**Pros:**
- Control total, sin depender de un servicio externo (ni siquiera self-hosted) cuyo comportamiento
  interno el equipo no diseñó.
- Elimina la dependencia de `supabase-js` del todo — coherente con "salir de Supabase" en el sentido
  más estricto, no solo el motor de datos.
- El GUC pattern (`app.current_org_id`) ya es compatible con cualquier proveedor — no hay que tocar RLS.

**Contras:**
- Reescribe los 17 call sites, el flujo de SSO Azure completo, el flujo de MFA completo, y
  `resetPassword` — trabajo de varios sprints, no de un PR.
- Reintroduce riesgo de regresión en un área ya endurecida (Beta.21/22 cerraron pentest + JCI compliance
  sobre el flujo actual; CLAUDE.md documenta rate-limiting, Vault MFA enforcement, dual-login SSO+password
  ya cableados contra Supabase Auth — todo eso habría que volver a auditar).
- Sin el trabajo de investigación que ya existe para GoTrue (no hay un stack de prueba, no hay
  verificación contra un proveedor real).

### Opción C — Arquitectura híbrida: portar solo el motor de datos, mantener Supabase Auth managed

**Pros:**
- Cero cambio de código, cero riesgo de regresión.
- Resuelve el caso de uso más probable: DR/portabilidad del **dato clínico** (lo que tiene retención de
  10 años y cadena de hash de auditoría), sin exigir portar el login el mismo día.

**Contras:**
- No resuelve "salir de Supabase" en sentido estricto — sigue habiendo una dependencia de plataforma
  (el login), aunque el dato viva en otro Postgres. Si la motivación de portabilidad es contractual/DR
  regulatorio total, esta opción no cierra el requisito.
- Requiere que el Postgres portado sea alcanzable por el GoTrue managed de Supabase para las 6 FK y
  para cualquier lectura cruzada — normalmente no es el diseño de un DR real (el DR asume que Supabase
  como plataforma completa no está disponible).

---

## Trade-offs

| Dimensión | A — GoTrue self-hosted | B — Proveedor propio | C — Híbrido (solo motor de datos) |
|---|---|---|---|
| Esfuerzo de migración de código | Ninguno (0 call sites) | Alto (17+ call sites, SSO, MFA) | Ninguno |
| Resuelve "salir de Supabase" de verdad | Sí | Sí | No (parcial) |
| Riesgo de regresión en seguridad ya auditada (Beta.21/22) | Bajo (mismo protocolo) | Alto (rehacer todo) | Ninguno |
| Carga operativa nueva | Media-alta (operar un servicio de auth) | Alta (operar + mantener código propio) | Ninguna |
| Tiempo hasta viable | Corto si se resuelve el bug 500 | Largo (sprints) | Inmediato |
| Sirve para DR real (Supabase totalmente caído) | Sí | Sí | No |

---

## Recomendación (@AT, con reserva — no es la decisión final)

**Opción A como objetivo de mediano plazo, con Opción C como puente inmediato.** Razonamiento con los
pilares Well-Architected:

- ***Operational Excellence***: la Opción A reusa investigación ya hecha y verificada contra código
  fuente real; reescribir desde cero (B) repite ese trabajo sin necesidad.
- ***Reliability***: ninguna opción es gratis en disponibilidad — A introduce un servicio nuevo a
  operar, C mantiene el único punto de falla que ya existe hoy (Supabase managed) pero sin agregar uno
  nuevo. Por eso C como puente: no hay urgencia de cerrar el gap de auth si el driver real es DR del
  dato clínico.
- ***Security***: A y C mantienen el flujo ya auditado en Beta.21/22 (JCI, pentest, rate-limit,
  Vault-MFA-enforcement); B lo pone todo en riesgo de regresión por reescritura completa, en un dominio
  (auth de un sistema clínico con datos PHI) donde el costo de un bug de seguridad es alto.
- ***Cost***: A tiene costo operativo recurrente (parchear GoTrue) pero acotado; B tiene costo de
  ingeniería inicial alto más el mismo costo operativo recurrente después (ahora de código propio, sin
  el beneficio de reusar un binario ya probado en producción por Supabase mismo).

**Antes de comprometerse a A en serio**, el bloqueo de `docs/runbooks/e2e-gotrue-auth.md` §2 (500 al
crear usuario) debe resolverse y debe probarse un login real end-to-end (browser → GoTrue self-hosted →
cookie de sesión → RLS) — ninguna de las dos cosas se hizo en esta sesión (Docker caído). Sin eso, A
sigue siendo una hipótesis fundamentada, no una opción verificada para producción.

---

## Decisión

**No tomada en este documento.** Este ADR mapea el terreno (opciones, trade-offs, costo) para que Edwin
decida con @AS el nivel de inversión que amerita "poder salir de Supabase" — es una decisión de negocio
(cuánto vale la opcionalidad de portar el login, no solo el dato) tanto como técnica. Cuando se decida,
actualizar el **Estado** de este ADR a Aceptado/Rechazado con la opción elegida y abrir el sprint de
implementación correspondiente.

---

## Consecuencias de no decidir (statu quo)

- La capacidad de reconstrucción probada en `db-reconstruccion-fuera-de-supabase.md` cubre el motor de
  datos (con las brechas de categorías B/C/D/E que otros dos agentes de esta misma tarea cierran en
  paralelo) pero **no** cubre un login funcional fuera de Supabase — cualquier ejercicio de DR real hoy
  tendría un sistema con datos pero sin forma de que el personal clínico inicie sesión, salvo que
  Supabase Auth managed siga alcanzable (Opción C de facto, sin haberla elegido explícitamente).
- Esto es aceptable como estado transitorio — no es una regresión de este sprint, es el estado real
  desde que el proyecto empezó a usar Supabase Auth.

---

## Referencias

- `docs/runbooks/db-reconstruccion-fuera-de-supabase.md` §3.3 — evidencia técnica detallada y pruebas
- `docs/runbooks/e2e-gotrue-auth.md` — estado real del stack GoTrue self-hosted (E2E), bloqueo abierto
- CLAUDE.md §"Patrones de seguridad establecidos (Beta.21/22)" — superficie de seguridad ya auditada
  que cualquier opción debe preservar
- ADR 0018 — Schema dual Prisma + SQL (mismo patrón de "no forzar una sola herramienta cuando el costo
  de forzarla supera el beneficio", aplicado aquí a auth en vez de a schema)
- `github.com/supabase/auth` (GoTrue) — código fuente real usado para verificar rutas/migraciones/config

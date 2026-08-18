# Beta.23 — Riesgos Residuales OWASP Top 10:2025 + Gobernanza — Backlog

**Owner:** @PO — Chief Product Officer, Inversiones Avante
**Fase:** 3 — Planificación (post-remediación OWASP 2025)
**Fecha:** 2026-08-17
**Estado:** Backlog priorizado — listo para planning Sprint 1
**Insumos:**
- `docs/audit/2026-08-17_owasp_2025_remediacion.md` (remediación OWASP Top 10:2025, rama `feat/owasp-2025-hardening`, base `main`@`ebce058`)
- Revisión @AE (gobernanza y tensión LOPD/ARCO), @AS (arquitectura adversarial, hallazgo P3 RLS-sin-CI), @QA (gaps de cobertura funcional)

**No se toca código ni tests en este documento.** Es planificación pura; el trabajo de ingeniería referenciado se ejecuta en sprints futuros.

---

## 1. Definition of Done (DoD) — Beta.23

Una US se cierra cuando:

- [ ] Mergeada en `main` via PR con CI verde (typecheck + lint + test + build).
- [ ] Tests unitarios/integración ≥ 80% cobertura en el path modificado (§Vitest thresholds, CLAUDE.md).
- [ ] Si toca schema o routers BD: RLS validado (`SET LOCAL ROLE authenticated`) y `get_advisors` limpio.
- [ ] Entrada en la matriz de trazabilidad de este backlog (columna PR).
- [ ] Review explícito de @QA (o @QAF para JCI/UX clínico).
- [ ] Para US-22-A (migración Next): UAT manual en browser real (consola sin errores de hidratación + interactividad) — lección Beta.22 #440, axe verde no basta.
- [ ] Para US de gobernanza (ADR/política): documento fusionado a `docs/adr/` o `docs/` y referenciado desde CLAUDE.md si aplica.
- [ ] Para US "Avante" (config/decisión): evidencia de la acción tomada (screenshot config, confirmación de contrato) adjunta a la US, no requiere PR.

---

## 2. Personas de Seguridad / Partes Interesadas

| ID | Rol | Interés en Beta.23 |
|----|-----|--------------------|
| SEC-1 | DPO / Compliance (Decreto 143, LOPD) | Resolución (o mitigación documentada) de la tensión minimización-vs-auditoría inmutable |
| SEC-2 | @AE — Gobernanza | 3 ADR cerrados; fecha comprometida de migración Next |
| SEC-3 | @AS — Arquitectura adversarial | Test de integración RLS contra Postgres real en CI, no solo advisors manuales |
| SEC-4 | @QA | Cobertura funcional real (no solo regresión de seguridad) en workflow-inbox, middleware, mfa-guard |
| SEC-5 | Clínico (bandeja de trabajo hospitalaria) | Ningún cambio de policy RLS futuro debe vaciar `workflowInbox.miBandeja` sin que CI lo detecte |
| SEC-6 | Avante (dirección/legal/IT ops) | Acciones de configuración y contratación fuera del alcance de ingeniería |

---

## 3. Épicas

| ID | Nombre | Fuente | SP total | WSJF base | Sprint sugerido |
|----|--------|--------|----------|-----------|------------------|
| E-22-A | Migración Next.js 14 → 15.5.x | OWASP A03 (Software Supply Chain) — abierto | 29 | 6.8 | S1-S2 (fecha comprometida abajo) |
| E-22-B | Activación enforcement MFA de personal | OWASP A07 — código listo, apagado | 9 | 8.1 | S1 |
| E-22-C | Cobertura de pruebas del hardening | @QA — gaps identificados | 23 | 6.2 | S1-S2 |
| E-22-D | Test de integración RLS contra Postgres real en CI | @AS — hallazgo P3 | 8 | 7.5 | S1 |
| E-22-E | Gobernanza: 3 ADR + política de retención/minimización auditoría copiloto | @AE | 11 | 5.4 | S2 |
| E-22-F | Acciones de configuración Avante (no ingeniería) | Informe §5 | 7 | — (no aplica WSJF, son decisiones) | S1 (paralelo) |
| | **TOTAL** | | **87 SP** | | |

---

## E-22-A — Migración Next.js 14 → 15.5.x

**Goal:** Cerrar el mayor riesgo abierto del informe OWASP 2025: ~21 advisories corregidos en la línea 15.5.x (SSRF en Server Actions y en rewrites, cache poisoning de respuestas RSC, bypass de middleware/proxy en i18n, XSS con nonces CSP, varios DoS). Next 14 es hoy la mayor exposición de cadena de suministro del proyecto (`docs/audit/2026-08-17_owasp_2025_remediacion.md` §A03).

**Por qué no es un bump trivial:** precedente Beta.22 — un salto automático 14→16 vía Dependabot rompió el build (`headers()` pasó a `Promise<ReadonlyHeaders>`) y se revirtió. Medido en este repo:

- **17 archivos** importan `next/headers` (candidatos a la API async `headers()`/`cookies()`).
- **22 archivos** con directiva `"use server"` (Server Actions — superficie del SSRF corregido en 15.x).
- `apps/web/src/middleware.ts` (165 líneas) — ya tiene lógica fail-closed y parsing de batch tRPC (`isPublicTrpcPath()`, cerrado en este mismo ciclo OWASP) que debe re-validarse contra el nuevo comportamiento de middleware/proxy de 15.x.
- `apps/web/next.config.mjs` (166 líneas) — contiene `headers()` (CSP/HSTS) y debe auditarse por los rewrites vulnerables a SSRF corregidos en 15.x.
- Intento previo de nonce-CSP fue revertido por incompatibilidad con páginas estáticas de Next 14 (`#440`); Next 15 cambia el modelo de renderizado estático/dinámico y debe re-evaluarse si CSP con nonce vuelve a ser viable — sin repetir el error sin resolver primero el render estático.

**WSJF:** Cost of delay = 8 (mayor exposición de cadena de suministro abierta, gate semanal de `npm audit` en rojo por esto). Tamaño = L. **WSJF = 6.8.**

**Fecha comprometida (exigida por @AE):** inicio Sprint 1 **2026-08-18**, cierre **2026-09-05** (13 días hábiles, 2 sprints de 1 semana efectiva de trabajo dedicado + 1 semana de soak en staging). Si el spike (US-22-A1) revela breaking changes no contemplados aquí, @PO reabre el compromiso de fecha en el primer daily post-spike — no se difiere en silencio.

---

### US-22-A1 — Spike de compatibilidad Next 15.5.x (inventario de breaking changes reales)

**Como** arquitecto de software **quiero** un inventario exhaustivo de los breaking changes de Next 15.5.x que afectan específicamente los 17 archivos con `next/headers`, los 22 Server Actions, `middleware.ts` y `next.config.mjs` **para** dimensionar el resto de la migración con datos reales y no con la lista genérica del changelog.

**Origen:** informe OWASP 2025 §A03; precedente Beta.22 (revert 14→16).

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: inventario completo de archivos afectados
  Dado un checkout de main en una rama de spike
  Cuando se ejecuta el codemod oficial `npx @next/codemod@canary upgrade latest` en modo dry-run
  Entonces se produce un reporte con cada archivo afectado y el tipo de cambio (async headers/cookies, searchParams, fetch caching default)

Escenario: clasificación de riesgo por archivo
  Dado el reporte del codemod
  Cuando @AS clasifica cada uno de los 17+22 archivos por riesgo (bajo/medio/alto)
  Entonces el documento de spike lista explícitamente los archivos de riesgo alto (middleware, next.config.mjs, Server Actions con validación de input externo)

Escenario: decisión go/no-go documentada
  Dado el inventario completo
  Cuando se presenta a @PO y @AE
  Entonces se confirma o ajusta la fecha comprometida de cierre (2026-09-05) con justificación explícita
```

**Esfuerzo (SP):** 3
**WSJF:** BV=8, TC=9, RR=7 → (24) / 3 = **8.0**
**Dependencias:** ninguna. Debe completarse en los primeros 2 días de S1.

---

### US-22-A2 — Bump Next 14→15.5.x + fix de APIs async (`headers()`/`cookies()`)

**Como** desarrollador del HIS **quiero** actualizar `next` a `15.5.x` en `apps/web/package.json` y adaptar los 17 archivos que consumen `next/headers` al contrato async (`await headers()`, `await cookies()`) **para** eliminar la exposición de cadena de suministro sin repetir la ruptura de Beta.22.

**Origen:** OWASP A03 (informe 2026-08-17); codemod de US-22-A1.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: build verde tras el bump
  Dado next 15.5.x instalado y los 17 archivos migrados a headers()/cookies() async
  Cuando se ejecuta npm run build
  Entonces el build completa sin errores de tipo Promise<ReadonlyHeaders>

Escenario: typecheck verde en los 7 workspaces
  Cuando se ejecuta npm run typecheck desde raiz
  Entonces los 7 workspaces retornan 0 errores

Escenario: rutas dinamicas que leen cookies de tenant siguen funcionando
  Dado una ruta que lee cookies his.org / his.estab via cookies()
  Cuando un usuario autenticado navega a /dashboard
  Entonces el contexto de tenant se resuelve igual que en Next 14
```

**Esfuerzo (SP):** 8
**WSJF:** BV=9, TC=8, RR=7 → (24) / 8 = **3.0**
**Dependencias:** US-22-A1.
**Archivos:** los 17 identificados en el spike + `apps/web/package.json` + `package-lock.json` (requiere `npm install`, no solo edición manual — lección Sentry/lockfile de CLAUDE.md).

---

### US-22-A3 — Auditoría y fix de Server Actions (22 archivos) contra SSRF

**Como** arquitecto de seguridad **quiero** revisar los 22 archivos con `"use server"` contra el patrón de SSRF corregido en 15.x (validación de URL/host en Server Actions que aceptan input controlado por el cliente) **para** confirmar que ninguno queda expuesto tras el bump, dado que el CVE original se corrigió en el framework pero cualquier Server Action que reenvíe URLs de usuario a `fetch()` interno sigue siendo responsabilidad de la app.

**Origen:** OWASP A03 (SSRF en Server Actions, línea 15.5.x); `packages/trpc` no aplica (Server Actions son de `apps/web`).

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: ninguna Server Action acepta URL arbitraria sin allowlist
  Dado los 22 archivos con "use server"
  Cuando se audita cada uno por inputs que se usan como destino de fetch/redirect
  Entonces ninguno permite un host fuera de una allowlist explicita (o no aplica el patron)

Escenario: test de regresion para el patron mas sensible (si existe)
  Dado el Server Action de mayor riesgo identificado en el spike
  Cuando se envia un payload con host externo controlado
  Entonces la Server Action rechaza el request con error de validacion Zod
```

**Esfuerzo (SP):** 5
**WSJF:** BV=8, TC=7, RR=8 → (23) / 5 = **4.6**
**Dependencias:** US-22-A1.

---

### US-22-A4 — Revalidar `middleware.ts` y rewrites de `next.config.mjs` contra bypass 15.x

**Como** arquitecto de seguridad **quiero** revalidar `middleware.ts` (fail-closed, parsing de batch tRPC ya endurecido en este ciclo OWASP) y los rewrites de `next.config.mjs` contra el bypass de middleware/proxy en i18n y el SSRF de rewrites corregidos en 15.x **para** confirmar que el gate de borde sigue siendo efectivo bajo el nuevo runtime.

**Origen:** OWASP A03; continuidad directa del fix de `isPublicTrpcPath()` (commit `9b3931e`, mismo ciclo).

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: middleware sigue fail-closed bajo Next 15
  Dado el middleware con el catch-all fail-closed
  Cuando se simula un error interno del gate de borde
  Entonces las rutas protegidas siguen redirigiendo a /login (no fail-open)

Escenario: parsing de batch tRPC sigue exigiendo unanimidad publica
  Dado /api/trpc/locale.x,patient.list como request
  Cuando pasa por isPublicTrpcPath() bajo Next 15
  Entonces el resultado es "no publico" identico al comportamiento pre-migracion

Escenario: rewrites no exponen SSRF
  Dado los rewrites definidos en next.config.mjs
  Cuando se audita cada uno contra el CVE de rewrites SSRF de la release 15.x
  Entonces ninguno reenvia a un host derivado de input no confiable
```

**Esfuerzo (SP):** 5
**WSJF:** BV=9, TC=8, RR=8 → (25) / 5 = **5.0**
**Dependencias:** US-22-A1, coordinar con US-22-A2 (mismo PR recomendado para evitar drift).

---

### US-22-A5 — UAT manual completo + regresión de flujos clínicos críticos

**Como** QA **quiero** ejecutar UAT manual en browser real de triage, admisión, BCMA, ECE (los mismos flujos que el criterio de A11y Baseline Beta.22 identificó como insuficientes) tras el bump a Next 15.5.x **para** confirmar hidratación e interactividad reales, no solo axe/build verdes (lección `#440`: axe pasó verde con la app rota).

**Origen:** lección Beta.22 documentada en CLAUDE.md §Gotchas ("A11y Baseline... NO valida hidratación").

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: consola sin errores de hidratacion en flujos criticos
  Dado el deploy de staging con Next 15.5.x
  Cuando @QA navega triage, admision, BCMA y un documento ECE completo
  Entonces la consola del browser no muestra "Refused to execute inline script" ni errores de hidratacion

Escenario: interactividad confirmada, no solo render SSR
  Dado la pantalla de BCMA cargada
  Cuando @QA hace click en un boton de administracion de medicamento
  Entonces la accion se ejecuta (no solo se ve el HTML estatico)

Escenario: axe + UAT manual ambos verdes antes de merge a main
  Dado el reporte axe automatizado y el checklist de UAT manual
  Cuando ambos se adjuntan a la US
  Entonces @QA y @Orq firman el cierre conjunto
```

**Esfuerzo (SP):** 5
**WSJF:** BV=9, TC=6, RR=9 → (24) / 5 = **4.8**
**Dependencias:** US-22-A2, US-22-A3, US-22-A4 mergeadas en staging.

---

### US-22-A6 — Plan de rollback + ventana de soak en staging

**Como** SRE **quiero** un plan de rollback documentado (revert de PR + `next@14.2.18` pineado en `dependabot.yml`) y una ventana de soak de 48h en staging antes de promover a producción **para** que un breaking change no detectado en UAT no repita el incidente de reversión de emergencia de Beta.22.

**Origen:** precedente directo Beta.22 (revert de nonce CSP y de Next 16).

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: rollback ejecutable en menos de 15 minutos
  Dado el PR de migracion mergeado a main
  Cuando se simula un rollback (git revert + redeploy)
  Entonces la app vuelve a Next 14.2.18 funcional en menos de 15 minutos

Escenario: soak de 48h sin errores Sentry nuevos
  Dado el deploy en staging por 48 horas
  Cuando se revisa Sentry al final de la ventana
  Entonces no hay errores nuevos atribuibles a la migracion

Escenario: promocion a produccion solo tras soak limpio
  Dado el soak de 48h sin hallazgos
  Cuando @SRE aprueba la promocion
  Entonces el deploy a produccion ocurre dentro de la fecha comprometida (2026-09-05)
```

**Esfuerzo (SP):** 3
**WSJF:** BV=7, TC=6, RR=8 → (21) / 3 = **7.0**
**Dependencias:** US-22-A5.

---

## E-22-B — Activación enforcement MFA de personal

**Goal:** El código de enforcement MFA ya está mergeado y probado (commit `66fb6fc`, `mfa-session.test.ts` con 15 tests) pero **apagado por defecto** (`MFA_REQUIRED_ROLE_CODES` vacía). Es una US mayormente operativa: la dependencia es Avante (enrolamiento de usuarios), no ingeniería — pero ingeniería debe entregar el plan de contingencia antes de activar.

**WSJF:** Cost of delay = 8 (MFA de personal privilegiado es un gap de A07 activo mientras esté apagado). Tamaño = S. **WSJF = 8.1.**

---

### US-22-B1 — Plan de contingencia: verificación end-to-end de backup codes antes de activar

**Como** arquitecto de seguridad **quiero** verificar en staging el flujo completo de recuperación por backup codes (generación, uso, invalidación tras uso, regeneración) **para** que activar `MFA_REQUIRED_ROLE_CODES` no deje a un DIR/ARCH/ADMIN bloqueado sin ruta de escape documentada.

**Origen:** informe OWASP 2025 §A07 ("Activarlo antes del enrolamiento deja a esos usuarios fuera").

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: backup code valido permite login sin TOTP
  Dado un usuario con MFA activo y 10 backup codes generados
  Cuando ingresa un backup code valido en vez del TOTP
  Entonces el login tiene exito y el codigo queda marcado como usado

Escenario: backup code usado no es reutilizable
  Dado un backup code ya usado
  Cuando se intenta usar de nuevo
  Entonces el login es rechazado

Escenario: procedimiento de emergencia documentado para ADMIN sin backup codes
  Dado un usuario ADMIN que perdio su dispositivo TOTP y sus backup codes
  Cuando se consulta el runbook de contingencia
  Entonces existe un procedimiento (ej. otro ADMIN resetea el MFA via panel admin) con audit trail
```

**Esfuerzo (SP):** 3
**WSJF:** BV=8, TC=7, RR=9 → (24) / 3 = **8.0**
**Dependencias:** ninguna (verificación sobre código ya existente).
**Archivo:** runbook nuevo, `docs/15_production_runbook.md` (sección MFA) o `docs/17_hipercuidado_runbook.md`.

---

### US-22-B2 — Enrolar DIR/ARCH/ADMIN en `/mfa/enroll` (Avante)

**Como** administrador de Inversiones Avante **quiero** enrolar a todos los usuarios con rol DIR, ARCH y ADMIN en `/mfa/enroll` **para** que al activar la política nadie quede fuera del sistema.

**Origen:** informe OWASP 2025 §5, acción #2 ("Pendiente de Avante").

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: 100% de usuarios DIR/ARCH/ADMIN con MFA enrolado
  Dado la lista de usuarios con rol DIR, ARCH o ADMIN en produccion
  Cuando se consulta User.mfaEnabled para ese conjunto
  Entonces el 100% tiene mfaEnabled = true

Escenario: cada usuario enrolado tiene backup codes generados
  Dado un usuario recien enrolado
  Cuando completa el flujo de /mfa/enroll
  Entonces recibe y confirma haber guardado sus backup codes
```

**Esfuerzo (SP):** 2 (coordinación, no código)
**WSJF:** no aplica formalmente (acción operativa) — se prioriza por bloquear US-22-B4.
**Dependencias:** ninguna. **Owner:** Avante (IT ops), no @Dev.

---

### US-22-B3 — Definir `MFA_SESSION_SECRET` en Vercel (Avante)

**Como** SRE **quiero** que `MFA_SESSION_SECRET` esté configurado en Vercel Production y Preview **para** que la marca de sesión firmada (HMAC-SHA256) funcione antes de activar cualquier rol en `MFA_REQUIRED_ROLE_CODES`.

**Origen:** informe OWASP 2025 §A07 ("Roles configurados sin `MFA_SESSION_SECRET` válido → deniega fail-closed").

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: variable presente en ambos scopes
  Dado Vercel Project Settings > Environment Variables
  Cuando se verifica MFA_SESSION_SECRET
  Entonces existe con un valor distinto en Production y Preview, longitud >= 32 bytes

Escenario: sin la variable, el sistema deniega (no permite bypass)
  Dado un rol en MFA_REQUIRED_ROLE_CODES sin MFA_SESSION_SECRET configurado
  Cuando un usuario de ese rol intenta autenticarse
  Entonces el acceso es denegado (fail-closed), no se otorga sesion sin firma valida
```

**Esfuerzo (SP):** 1
**WSJF:** — (config). **Owner:** Avante/@SRE.
**Dependencias:** ninguna.

---

### US-22-B4 — Activar `MFA_REQUIRED_ROLE_CODES` en producción

**Como** DPO **quiero** poblar `MFA_REQUIRED_ROLE_CODES=DIR,ARCH,ADMIN` en Vercel Production **para** cerrar el gap de A07 (Authentication Failures) para los roles de mayor privilegio del sistema.

**Origen:** informe OWASP 2025 §A07.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: usuario DIR sin MFA satisfecho es redirigido
  Dado un usuario con rol DIR y sesion sin marca MFA valida
  Cuando accede a una ruta de (clinical) o (admin)
  Entonces es redirigido a /mfa

Escenario: gate tambien aplica en la API, no solo en la pagina
  Dado un usuario DIR sin MFA satisfecho
  Cuando invoca un procedure tenantProcedure via API directamente
  Entonces ctx.mfaSatisfied es false y el procedure rechaza la operacion

Escenario: activacion sin incidentes de bloqueo
  Dado la activacion en produccion
  Cuando se revisan los logs de las primeras 24h
  Entonces no hay reportes de usuarios DIR/ARCH/ADMIN bloqueados sin ruta de recuperacion
```

**Esfuerzo (SP):** 2 (verificación post-activación + monitoreo, no código nuevo)
**WSJF:** BV=8, TC=8, RR=7 → (23) / 2 = **11.5** (alto: es solo flip de config sobre código ya probado).
**Dependencias:** US-22-B1, US-22-B2, US-22-B3 — **bloqueante:** no activar sin las tres.

---

### US-22-B5 — Subir `password_min_length` y exigir clases de caracteres (Avante)

**Como** DPO **quiero** subir `password_min_length` de 6 (actual) a un mínimo de 12 con clases de caracteres exigidas en Supabase Auth Settings **para** cerrar el hallazgo de contraseñas débiles que persiste incluso con protección HaveIBeenPwned activa.

**Origen:** informe OWASP 2025 §5, acción #3.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: password corto rechazado
  Dado password_min_length = 12 en Supabase Auth
  Cuando un usuario intenta registrar password de 8 caracteres
  Entonces Supabase rechaza el registro

Escenario: usuarios existentes no son forzados a re-set inmediato
  Dado usuarios con password anteriores al cambio de politica
  Cuando inicia sesion normalmente
  Entonces no se bloquea (la politica aplica a cambios/altas nuevas, segun comportamiento de GoTrue)
```

**Esfuerzo (SP):** 1
**WSJF:** — (config). **Owner:** Avante.
**Dependencias:** ninguna.

---

## E-22-C — Cobertura de pruebas del hardening

**Goal:** Cerrar los gaps de cobertura funcional identificados por @QA sobre los cambios de este ciclo. La regresión de seguridad de `workflow-inbox.rls.test.ts` (4 tests) fija la propiedad "abre transacción y demota rol", pero **no** prueba la lógica de negocio de los 8 procedures (2.320 líneas). `middleware.ts` y `mfa-guard.ts` no tienen tests dedicados.

**WSJF:** Cost of delay = 7 (deuda de calidad sobre código de seguridad crítico recién tocado). Tamaño = M. **WSJF = 6.2.**

---

### US-22-C1 — Tests funcionales de `workflow-inbox.router.ts` (8 procedures)

**Como** QA **quiero** tests funcionales (no solo de regresión RLS) para `miBandeja`, `contadorBadge`, `reasignar`, `escalar`, `completar`, `comentar`, `historialTarea` y `actividadEquipo` **para** cubrir la lógica de negocio de las 2.320 líneas del router más grande del sistema, que hoy solo tiene verificado el patrón de seguridad, no el comportamiento.

**Origen:** @QA (revisión post-OWASP 2025); `packages/trpc/src/routers/workflow-inbox.router.ts` (2.320 líneas, 8 procedures verificado con `grep`), `packages/trpc/src/routers/__tests__/workflow-inbox.rls.test.ts` (existe, 4 tests, solo cubre demote de rol con todos los modelos mockeados vacíos).

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: miBandeja retorna items agregados de las ~30 fuentes correctamente priorizados
  Dado un usuario con tareas pendientes en prescripciones, triage y labs
  Cuando invoca workflowInbox.miBandeja
  Entonces la respuesta incluye items de cada fuente ordenados por prioridad/vencimiento

Escenario: reasignar mueve la tarea a otro usuario del mismo rol
  Dado una tarea asignada a usuario A
  Cuando usuario B (supervisor) la reasigna a usuario C
  Entonces la tarea aparece en la bandeja de C y no en la de A

Escenario: escalar respeta la jerarquia de roles
  Dado una tarea vencida sin atender
  Cuando se ejecuta escalar()
  Entonces la tarea se asigna al rol superior configurado, no a un rol arbitrario

Escenario: completar registra evento de dominio y cierra la tarea
  Dado una tarea en curso
  Cuando el usuario la completa
  Entonces la tarea desaparece de miBandeja y se emite un DomainEvent

Escenario: contadorBadge coincide con el conteo real de miBandeja
  Dado N tareas pendientes para un usuario
  Cuando se consulta contadorBadge
  Entonces el numero retornado es igual a len(miBandeja().items)
```

**Esfuerzo (SP):** 8
**WSJF:** BV=7, TC=6, RR=8 → (21) / 8 = **2.6**
**Dependencias:** ninguna. Reutiliza `installTenantContextMock` (helper ya creado en este ciclo OWASP).

---

### US-22-C2 — Suite de tests para `middleware.ts` (fail-closed + parsing de batch)

**Como** QA **quiero** una suite de tests unitarios para `apps/web/src/middleware.ts` (165 líneas, sin ningún test hoy) que cubra el comportamiento fail-closed y `isPublicTrpcPath()` **para** que un cambio futuro no reintroduzca el fail-open corregido en A10 ni el bypass de batch corregido en A01, sin depender de revisión manual.

**Origen:** @QA; hallazgo A01 residual (`isPublicTrpcPath`, commit `9b3931e`) y A10 (fail-closed, sin test dedicado hoy).

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: error interno en el gate produce fail-closed
  Dado un mock que fuerza una excepcion dentro del middleware
  Cuando se procesa un request a una ruta protegida
  Entonces el resultado es redirect a /login, no NextResponse.next()

Escenario: ruta publica sigue sirviendose ante error interno
  Dado el mismo mock de excepcion
  Cuando el request es a una ruta en PUBLIC_PATHS
  Entonces la ruta se sirve normalmente

Escenario: batch con un procedure privado bloquea todo el batch
  Dado el request /api/trpc/locale.x,patient.list
  Cuando isPublicTrpcPath() lo evalua
  Entonces retorna false (no publico)

Escenario: batch 100% publico pasa
  Dado el request /api/trpc/locale.x,locale.y
  Cuando isPublicTrpcPath() lo evalua
  Entonces retorna true

Escenario: URI malformada nunca se clasifica como publica
  Dado un path con encoding invalido
  Cuando isPublicTrpcPath() lo evalua
  Entonces retorna false
```

**Esfuerzo (SP):** 5
**WSJF:** BV=8, TC=7, RR=8 → (23) / 5 = **4.6**
**Dependencias:** ninguna.
**Archivo nuevo:** `apps/web/src/middleware.test.ts` (o `__tests__/middleware.test.ts`).

---

### US-22-C3 — Tests unitarios de `mfa-guard.ts` (0% cobertura)

**Como** QA **quiero** tests unitarios para las 34 líneas de `apps/web/src/lib/auth/mfa-guard.ts` **para** que la lógica de gate (`ctx.mfaSatisfied`, verificación de rol contra `MFA_REQUIRED_ROLE_CODES`) tenga cobertura antes de activar el enforcement en producción (E-22-B).

**Origen:** @QA; `apps/web/coverage/lib/auth/mfa-guard.ts.html` confirma 0% de cobertura actual.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: rol en MFA_REQUIRED_ROLE_CODES sin sesion MFA es bloqueado
  Dado MFA_REQUIRED_ROLE_CODES="DIR" y un usuario DIR sin marca MFA
  Cuando se evalua el guard
  Entonces retorna bloqueado=true

Escenario: rol fuera de la lista nunca es bloqueado
  Dado MFA_REQUIRED_ROLE_CODES="DIR" y un usuario NURSE
  Cuando se evalua el guard
  Entonces retorna bloqueado=false independientemente de la marca MFA

Escenario: MFA_REQUIRED_ROLE_CODES vacia deshabilita el guard globalmente
  Dado MFA_REQUIRED_ROLE_CODES=""
  Cuando se evalua el guard para cualquier rol
  Entonces retorna bloqueado=false (comportamiento actual, default seguro)

Escenario: MFA_SESSION_SECRET ausente con rol activo deniega (fail-closed)
  Dado MFA_REQUIRED_ROLE_CODES="DIR" y MFA_SESSION_SECRET no definido
  Cuando se evalua el guard para un usuario DIR
  Entonces el resultado es bloqueado=true (fail-closed, no bypass)
```

**Esfuerzo (SP):** 2
**WSJF:** BV=8, TC=6, RR=9 → (23) / 2 = **11.5** (alto: 34 líneas, gate crítico previo a activar MFA).
**Dependencias:** ninguna. Debe cerrarse antes de US-22-B4.

---

### US-22-C4 — Patrón de test combinado: filtro de negocio + demote de rol simultáneo

**Como** QA **quiero** un helper de test reutilizable que verifique en una sola aserción que (a) un procedure filtra correctamente por `organizationId`/tenant y (b) lo hace dentro de una transacción con rol demotado a `authenticated` **para** que ningún router nuevo pueda "pasar" el test de negocio con un mock que nunca demuestra que RLS realmente aplicaría en producción.

**Origen:** @QA (gap identificado: los tests actuales prueban una propiedad u otra, nunca ambas a la vez, con datos mockeados vacíos que no ejercitan el filtro real).

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: helper detecta filtro de negocio ausente aunque el rol se demote
  Dado un procedure que demota el rol pero olvida el where organizationId
  Cuando se ejecuta el helper combinado contra datos de dos orgs
  Entonces el test falla explicitando "cross-tenant leak detectado"

Escenario: helper detecta demote ausente aunque el filtro JS este presente
  Dado un procedure con where organizationId correcto pero sin withTenantContext
  Cuando se ejecuta el helper combinado
  Entonces el test falla explicitando "SET LOCAL ROLE authenticated no invocado"

Escenario: procedure correcto pasa ambas verificaciones
  Dado un procedure con withTenantContext y filtro tenant correctos
  Cuando se ejecuta el helper
  Entonces ambas aserciones (aislamiento + demote) pasan
```

**Esfuerzo (SP):** 3
**WSJF:** BV=7, TC=7, RR=8 → (22) / 3 = **7.3**
**Dependencias:** ninguna. Se recomienda aplicar retroactivamente a `workflow-inbox.rls.test.ts`, `nutrition.router.ts`, `census.router.ts` una vez creado (no incluido en el esfuerzo de esta US).
**Archivo:** `packages/trpc/src/__tests__/helpers/tenant-isolation-matcher.ts` (propuesto).

---

### US-22-C5 — Sembrar usuario TOTP dedicado + E2E de MFA

**Como** QA **quiero** un usuario de prueba con TOTP real sembrado en `packages/database/scripts/seed-test-users.mjs` y un spec Playwright que ejercite el flujo `/mfa/enroll` → login con TOTP → backup code **para** que el enforcement de MFA (E-22-B) tenga cobertura E2E antes de activarse en producción, no solo tests unitarios de `mfa-session.test.ts`.

**Origen:** @QA; `seed-test-users.mjs` confirmado sin ninguna referencia a TOTP/MFA hoy; no existe spec en `apps/web/e2e/` con "mfa" en el nombre.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: usuario TOTP sembrado con secreto conocido en entorno de test
  Dado seed-test-users.mjs ejecutado en BD efimera de E2E
  Cuando se consulta el usuario qa.mfa@his.test
  Entonces tiene mfaEnabled=true y un secreto TOTP determinista para generar codigos en el test

Escenario: E2E genera codigo TOTP valido y completa login
  Dado el usuario qa.mfa@his.test con rol en MFA_REQUIRED_ROLE_CODES de test
  Cuando el spec Playwright genera un codigo TOTP con el secreto sembrado y lo ingresa en /mfa
  Entonces el login completa y redirige al dashboard

Escenario: E2E prueba tambien el camino de backup code
  Dado el mismo usuario con backup codes sembrados
  Cuando el spec usa un backup code en vez del TOTP
  Entonces el login completa y el codigo queda invalidado
```

**Esfuerzo (SP):** 5
**WSJF:** BV=6, TC=6, RR=7 → (19) / 5 = **3.8**
**Dependencias:** US-22-B1 (mismo flujo de backup codes verificado). Nota: `e2e.yml` corre nightly, no per-PR (CLAUDE.md) — este spec no bloquea merges individuales.
**Archivos:** `packages/database/scripts/seed-test-users.mjs`, `apps/web/e2e/mfa.spec.ts` (nuevo).

---

## E-22-D — Test de integración RLS contra Postgres real en CI

**Goal:** Cerrar el hallazgo P3 de @AS: la garantía de que las tablas `ece.*` siguen devolviendo filas correctas bajo el rol `authenticated` descansa hoy en inspección manual de `get_advisors`, no en CI automatizado. Un cambio futuro de policy que vacíe accidentalmente la bandeja de trabajo del hospital completo no tiene ninguna red que lo atrape antes de producción.

**WSJF:** Cost of delay = 8 (falla silenciosa de disponibilidad clínica, no de confidencialidad — categoría distinta y sin cobertura hoy). Tamaño = M. **WSJF = 7.5.**

---

### US-22-D1 — Job de CI con Postgres efímero real ejecutando RLS end-to-end

**Como** arquitecto de software **quiero** un workflow de CI (`.github/workflows/`) que levante un Postgres efímero con el schema + RLS policies aplicados, cree usuarios de prueba en 2 organizaciones distintas, y verifique con aserciones SQL reales (no mocks de Prisma) que `SELECT` bajo rol `authenticated` retorna las filas esperadas para `ece.documento_instancia`, `workflowInbox`-relevant tables y al menos 2 tablas más de alto tráfico **para** que un cambio de policy que rompa el acceso legítimo (no solo el cross-tenant) falle en CI antes de llegar a main.

**Origen:** @AS, hallazgo P3 ("un cambio futuro de policy vacía la bandeja de trabajo del hospital entero sin que CI se entere").

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: usuario autenticado de org A ve sus propios documentos ECE
  Dado un Postgres efimero con schema + RLS + 2 orgs sembradas
  Cuando se conecta como usuario de org A con SET LOCAL ROLE authenticated
  Entonces SELECT * FROM ece.documento_instancia retorna solo filas de org A (no cero, no de otra org)

Escenario: policy rota que vacia resultados legitimos es detectada
  Dado una policy modificada deliberadamente para simular el bug (USING(false))
  Cuando corre el job de CI contra ese estado
  Entonces el job falla explicitamente en la aserción "org A debe ver >0 filas propias"

Escenario: policy rota que permite cross-tenant es detectada
  Dado una policy modificada para simular USING(true)
  Cuando corre el job de CI
  Entonces falla en la aserción "org B no debe ver filas de org A"

Escenario: job corre en cada PR que toca sql/ o schema.prisma
  Dado un PR que modifica packages/database/sql/*.sql
  Cuando se abre el PR
  Entonces el nuevo workflow se dispara automaticamente (path filter)
```

**Esfuerzo (SP):** 8
**WSJF:** BV=9, TC=7, RR=9 → (25) / 8 = **3.1**
**Dependencias:** ninguna, pero coordinar con @DBA/@SRE (infraestructura de Postgres efímero en CI ya existe para `e2e.yml`, reutilizable).
**Archivo nuevo:** `.github/workflows/rls-integration.yml`, `packages/database/scripts/rls-ci-seed.mjs`.
**Nota:** distinto de `e2e.yml` (que corre nightly y prueba UI) — este job es rápido (solo SQL, sin browser) y debe correr **en cada PR** que toque `sql/` o `schema.prisma`, no nightly.

---

## E-22-E — Gobernanza: 3 ADR + política de retención/minimización

**Goal:** Formalizar 3 decisiones de arquitectura pendientes identificadas por @AE y abrir (no necesariamente cerrar en este backlog — es una decisión de Legal+DBA+AS) la tensión estructural entre la auditoría inmutable de 10 años del copiloto clínico y la minimización de datos del Decreto 143 / flujo ARCO.

**WSJF:** Cost of delay = 6 (riesgo regulatorio, no de explotación técnica inmediata). Tamaño = M. **WSJF = 5.4.**

---

### US-22-E1 — ADR-0019: postura fail-closed por defecto en gates de borde

**Como** arquitecto empresarial **quiero** un ADR que documente la decisión de que todo gate de borde (middleware, guards de MFA, rate limiting) falle **cerrado** por defecto ante error interno, con las excepciones explícitas donde se decidió fail-open (rate limiter, documentado en el informe OWASP §A06 "un rate limiter no puede tumbar la atención clínica") **para** que futuros gates nuevos hereden la postura por defecto sin que cada desarrollador la reinvente caso por caso.

**Origen:** @AE; decisiones ya tomadas en el ciclo OWASP 2025 (middleware fail-closed A10, rate limit fail-open A06) sin ADR que las capture como precedente.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: ADR documenta la regla general y las excepciones
  Dado docs/adr/0019-fail-closed-default-edge-gates.md
  Cuando se lee el documento
  Entonces establece "fail-closed por defecto" como regla y lista middleware + mfa-guard como conformes y rate-limit como excepcion justificada

Escenario: ADR referenciado desde CLAUDE.md
  Dado el ADR mergeado
  Cuando se actualiza la seccion de Documentacion viva de CLAUDE.md
  Entonces docs/adr/0019-*.md aparece listado
```

**Esfuerzo (SP):** 2
**WSJF:** BV=6, TC=5, RR=7 → (18) / 2 = **9.0**
**Dependencias:** ninguna. Es documentación de una decisión ya tomada, no nueva ingeniería.
**Archivo:** `docs/adr/0019-fail-closed-default-edge-gates.md`.

---

### US-22-E2 — ADR-0020: alcance de la auditoría del copiloto clínico y tensión LOPD

**Como** arquitecto empresarial **quiero** un ADR que documente explícitamente que el contenido del chat clínico (`chat_session`, `chat_message`) queda replicado e inmutable 10 años en el hash chain de `AuditLog` (SQL 197, este ciclo), y que registre la tensión no resuelta con la minimización de datos del Decreto 143 y el flujo ARCO **para** que la decisión de diseño (auditar todo, inmutable) quede trazada como decisión consciente y no como omisión, con la tensión abierta visible para Legal/DPO en vez de enterrada en un commit.

**Origen:** @AE ("la auditoría es inmutable por diseño: contradicción estructural no resuelta, previa a este cambio pero agravada").

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: ADR documenta la contradiccion sin resolverla artificialmente
  Dado docs/adr/0020-copiloto-audit-scope-lopd-tension.md
  Cuando se lee el documento
  Entonces describe: que se audita, por que es inmutable (cadena hash), y la tension explicita con Decreto 143 / ARCO sin pretender que esta resuelta

Escenario: ADR referencia la US de politica de retencion como seguimiento
  Dado el ADR
  Cuando se lee la seccion de consecuencias
  Entonces enlaza a US-22-E4 (politica de retencion/minimizacion) como el trabajo de seguimiento, no como solucion ya aplicada
```

**Esfuerzo (SP):** 2
**WSJF:** BV=6, TC=4, RR=8 → (18) / 2 = **9.0**
**Dependencias:** ninguna.
**Archivo:** `docs/adr/0020-copiloto-audit-scope-lopd-tension.md`.

---

### US-22-E3 — ADR-0021: doble régimen de rate limiting y decisión de fallo abierto

**Como** arquitecto empresarial **quiero** un ADR que documente los dos regímenes de rate limiting aplicados en este ciclo (sin sesión → Postgres compartido por IP 60/min; con sesión → memoria por proceso 600/min) y la decisión explícita de que ambos fallan **abierto** si el store revienta **para** que la decisión de disponibilidad-sobre-estrictez quede trazada, dado que contradice la postura fail-closed general de US-22-E1 y necesita su propia justificación documentada.

**Origen:** @AE; informe OWASP 2025 §A06.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: ADR documenta ambos regimenes y su justificacion de fallo abierto
  Dado docs/adr/0021-dual-rate-limit-fail-open.md
  Cuando se lee el documento
  Entonces describe el regimen sin sesion (Postgres, 60/min, por IP) y con sesion (memoria, 600/min, por usuario) y por que ambos fallan abierto

Escenario: ADR reconoce la excepcion a la regla fail-closed de ADR-0019
  Dado ambos ADR mergeados
  Cuando se comparan
  Entonces 0021 referencia explicitamente a 0019 como la regla general de la que este caso se aparta, con la razon (continuidad de atencion clinica)

Escenario: ADR nota la limitacion del regimen en memoria en despliegue multi-pod
  Dado el regimen con sesion (in-memory por proceso)
  Cuando se documenta su alcance
  Entonces el ADR aclara que no es un limite global en Vercel multi-pod, es un tope anti-bucle por instancia
```

**Esfuerzo (SP):** 2
**WSJF:** BV=5, TC=5, RR=6 → (16) / 2 = **8.0**
**Dependencias:** US-22-E1 (referencia cruzada).
**Archivo:** `docs/adr/0021-dual-rate-limit-fail-open.md`.

---

### US-22-E4 — Política de retención/minimización de auditoría del copiloto + evaluación de vía ARCO

**Como** DPO **quiero** una política formal (no solo un ADR de decisión de diseño) que evalúe opciones concretas para reconciliar la auditoría inmutable de 10 años con el derecho de cancelación/oposición (ARCO) del Decreto 143 — por ejemplo pseudonimización del contenido del chat tras N años manteniendo el hash chain intacto, o separación de "metadata auditable" vs "contenido purgable" — **para** que exista un camino de remediación evaluado, incluso si la decisión final es "no se puede resolver sin cambiar el requisito regulatorio de retención de 10 años", en cuyo caso la política lo declara explícitamente en vez de dejarlo como pregunta abierta indefinida.

**Origen:** @AE; contradicción estructural señalada como "agravada, no nueva" — ya existía la tensión general (ver `docs/audit/` GDPR right-to-erasure listado como fuera de scope en Beta.21 §8) pero el copiloto la hace más concreta al capturar texto libre de consultas clínicas.

**Criterios de aceptación (Gherkin):**

```gherkin
Escenario: politica evalua al menos 2 opciones tecnicas concretas
  Dado docs/compliance/politica-retencion-copiloto.md
  Cuando se lee la seccion de opciones
  Entonces incluye al menos: (a) pseudonimizacion post-N-anios preservando hash chain, (b) separacion metadata/contenido, con pros/contras de cada una

Escenario: politica declara explicitamente si la tension queda sin resolver
  Dado que ninguna opcion es trivial de implementar sin tocar el requisito de retencion de 10 anios
  Cuando la politica llega a una recomendacion
  Entonces declara explicitamente el estado (resuelto / mitigado / sin resolver con justificacion) — no lo omite

Escenario: politica coordina con Legal antes de publicarse
  Dado el borrador de la politica
  Cuando se revisa
  Entonces tiene sign-off explicito de Legal/DPO de Avante, no solo de @AE
```

**Esfuerzo (SP):** 5
**WSJF:** BV=6, TC=3, RR=6 → (15) / 5 = **3.0** (bajo — es decisión que requiere insumo de Legal, no ingeniería pura; no debe forzarse en un sprint técnico).
**Dependencias:** US-22-E2 (ADR previo). **Owner primario:** DPO/Legal de Avante con soporte de @AE — no es una US que @Dev pueda cerrar solo.
**Archivo:** `docs/compliance/politica-retencion-copiloto.md` (nuevo directorio).

---

## E-22-F — Acciones de configuración Avante (no ingeniería)

**Goal:** Registrar como backlog trazable las 5 acciones del informe OWASP 2025 §5 que son decisión o configuración de Avante, no trabajo de ingeniería, para que no se pierdan como notas sueltas del informe.

**No aplica WSJF clásico** — son decisiones/contrataciones, no features priorizables por valor de negocio incremental. Se ordenan por urgencia de cierre de gap.

---

### US-22-F1 — Contratar y ejecutar pentest externo activo (gate nunca ejecutado)

**Como** CISO de Inversiones Avante **quiero** contratar y ejecutar el pentest externo activo (ZAP/Burp contra staging con scope document) **para** cerrar el gate `US-21-E2` del backlog Beta.21, que fue definido en 2026-05-30 y nunca se ejecutó.

**Origen:** informe OWASP 2025 §5 acción #5; `docs/backlog/beta21_pentest_jci_hardening.md` US-21-E2.

**Esfuerzo (SP):** 3 (coordinación + revisión de hallazgos, no ejecución técnica interna)
**Dependencias:** `docs/security/pentest-scope-2026.md` (si no existe, crearlo es parte de esta US — ya estaba previsto en US-21-C7 de Beta.21, verificar si se completó).
**Owner:** Avante (CISO) + @SRE de soporte.

---

### US-22-F2 — Activar `SENTRY_DSN` en producción + DPA con Sentry

**Como** SRE **quiero** que `SENTRY_DSN` esté activo en Vercel Production y exista un DPA (Data Processing Agreement) firmado con Sentry **para** que el alerting de A09 (Security Logging and Alerting Failures) funcione en producción con cobertura legal sobre el procesamiento de datos que puedan llegar en los payloads de error.

**Origen:** informe OWASP 2025 §5 acción #4.

**Esfuerzo (SP):** 2
**Dependencias:** ninguna técnica — el código de Sentry ya está instrumentado (Beta.22) y con filtro de PII (`beforeSend`).
**Owner:** Avante (legal para el DPA) + @SRE (activación técnica de la variable).

---

### US-22-F3 — Branch protection en `main` + SSL enforce en Supabase

**Como** líder técnico **quiero** confirmar el estado de branch protection en `main` (nota: memoria de sesión indica que ya está activa desde 2026-06-30, requiere `gh pr merge --admin`) y activar SSL enforce en la conexión Postgres de Supabase **para** cerrar dos ítems de configuración pendientes listados en memoria del proyecto.

**Origen:** informe OWASP 2025 §5 (branch protection, SSL enforce); nota: branch protection puede ya estar cerrada — **verificar antes de trabajar** (posible duplicado con estado ya alcanzado post-Beta.22).

**Esfuerzo (SP):** 1
**Dependencias:** verificación de estado actual antes de ejecutar (evitar re-trabajo).
**Owner:** Avante/@SRE.

---

### US-22-F4 — Reevaluar `expr-eval` (motor de fórmulas clínicas) si aparece fork mantenido

**Como** arquitecto de software **quiero** monitorear trimestralmente si aparece un fork mantenido de `expr-eval` (hoy sin fix upstream para 2 advisories, mitigado con allowlist sintáctica en este ciclo) **para** eventualmente eliminar la mitigación manual y volver a una dependencia con soporte activo.

**Origen:** informe OWASP 2025 §A05, §5 acción #6.

**Esfuerzo (SP):** 1 (tarea de vigilancia recurrente, no un sprint dedicado)
**Dependencias:** ninguna. Se sugiere como recordatorio trimestral, no ítem de sprint único.
**Owner:** @AS (vigilancia técnica).

---

## 4. Sprint Planning (2 sprints x 2 semanas + comprometido Next 15 en paralelo)

### Sprint 1 — 2026-08-18 a 2026-08-31 (capacidad: ~48 SP)

**Objetivo:** Iniciar y avanzar la migración Next 15 dentro de la fecha comprometida, activar el guard de MFA con su red de seguridad de tests, cerrar el gap de CI de RLS. Fecha de corte comprometida de E-22-A: **2026-09-05** (se extiende 3 días hacia S2 por la ventana de soak).

| US | Título | SP | WSJF | Owner |
|----|--------|----|------|-------|
| US-22-A1 | Spike compatibilidad Next 15.5.x | 3 | 8.0 | @AS |
| US-22-C3 | Tests mfa-guard.ts (0% cobertura) | 2 | 11.5 | @QA |
| US-22-B1 | Verificación E2E backup codes | 3 | 8.0 | @Dev |
| US-22-B3 | `MFA_SESSION_SECRET` en Vercel | 1 | — | Avante/@SRE |
| US-22-B2 | Enrolar DIR/ARCH/ADMIN | 2 | — | Avante |
| US-22-E1 | ADR-0019 fail-closed | 2 | 9.0 | @AE |
| US-22-E3 | ADR-0021 dual rate-limit | 2 | 8.0 | @AE |
| US-22-C4 | Helper test filtro+demote combinado | 3 | 7.3 | @QA |
| US-22-D1 | CI RLS integración Postgres real | 8 | 3.1 | @AS+@DBA |
| US-22-A2 | Bump Next + fix headers()/cookies() | 8 | 3.0 | @Dev |
| US-22-A3 | Auditoría Server Actions SSRF | 5 | 4.6 | @AS |
| US-22-F3 | Verificar branch protection + SSL enforce | 1 | — | Avante |
| US-22-B5 | Subir password_min_length | 1 | — | Avante |
| US-22-F4 | Vigilancia expr-eval (recurrente) | 1 | — | @AS |
| **Sub-total S1** | | **42 SP** | | |

---

### Sprint 2 — 2026-09-01 a 2026-09-14 (capacidad: ~46 SP)

**Objetivo:** Cerrar la migración Next 15 (UAT + rollback plan + soak), activar MFA en producción, cerrar cobertura de tests restante, cerrar ADR de gobernanza y arrancar la política de retención.

| US | Título | SP | WSJF | Owner |
|----|--------|----|------|-------|
| US-22-A4 | Middleware/rewrites vs bypass 15.x | 5 | 5.0 | @AS+@Dev |
| US-22-A5 | UAT manual regresión clínica | 5 | 4.8 | @QAF |
| US-22-A6 | Plan rollback + soak 48h | 3 | 7.0 | @SRE |
| US-22-B4 | Activar `MFA_REQUIRED_ROLE_CODES` en prod | 2 | 11.5 | Avante+@SRE |
| US-22-C1 | Tests funcionales workflow-inbox (8 procs) | 8 | 2.6 | @QA |
| US-22-C2 | Suite tests middleware.ts | 5 | 4.6 | @QA |
| US-22-C5 | Usuario TOTP seed + E2E MFA | 5 | 3.8 | @QA |
| US-22-E2 | ADR-0020 alcance auditoría copiloto | 2 | 9.0 | @AE |
| US-22-E4 | Política retención/minimización (spike, Legal) | 5 | 3.0 | DPO+@AE |
| US-22-F1 | Contratar pentest externo activo | 3 | — | Avante |
| US-22-F2 | SENTRY_DSN prod + DPA | 2 | — | Avante+@SRE |
| **Sub-total S2** | | **45 SP** | | |

*E-22-A cierra oficialmente el 2026-09-05, dentro de S2 — el soak de 48h (US-22-A6) corre en paralelo a los primeros días de S2, no bloquea el resto del sprint.*

---

## 5. Matriz de Trazabilidad

| Hallazgo | Severidad/Origen | US | Sprint | PR/Doc esperado |
|----------|-------------------|----|--------|------------------|
| Next 14 — ~21 advisories línea 15.5.x | Riesgo alto, A03 | US-22-A1 a US-22-A6 | S1-S2 | `feat/beta23-next15-migration` |
| MFA enforcement apagado | A07 | US-22-B1 a US-22-B5 | S1-S2 | `feat/beta23-mfa-activation` |
| `workflow-inbox` sin test funcional | @QA | US-22-C1 | S2 | `test/beta23-workflow-inbox-coverage` |
| `middleware.ts` sin instrumentar | @QA | US-22-C2 | S2 | `test/beta23-middleware-coverage` |
| `mfa-guard.ts` 0% cobertura | @QA | US-22-C3 | S1 | `test/beta23-mfa-guard-coverage` |
| Sin test combinado filtro+demote | @QA | US-22-C4 | S1 | `test/beta23-tenant-isolation-matcher` |
| E2E MFA no viable (falta seed TOTP) | @QA | US-22-C5 | S2 | `test/beta23-mfa-e2e-seed` |
| RLS ece.* sin test de integración CI | @AS P3 | US-22-D1 | S1 | `ci/beta23-rls-integration` |
| Falta ADR fail-closed por defecto | @AE | US-22-E1 | S1 | `docs/adr/0019-*.md` |
| Falta ADR alcance auditoría copiloto | @AE | US-22-E2 | S2 | `docs/adr/0020-*.md` |
| Falta ADR dual rate-limit | @AE | US-22-E3 | S1 | `docs/adr/0021-*.md` |
| Tensión retención/minimización sin política | @AE | US-22-E4 | S2 | `docs/compliance/politica-retencion-copiloto.md` |
| `password_min_length=6` | Informe §5.3 | US-22-B5 | S1 | config Supabase |
| `SENTRY_DSN` + DPA pendiente | Informe §5.4 | US-22-F2 | S2 | config Vercel + legal |
| Pentest externo activo nunca ejecutado | Informe §5.5 (=US-21-E2) | US-22-F1 | S2 | contratación |
| Branch protection / SSL enforce | Informe §5 | US-22-F3 | S1 | config GitHub/Supabase |
| `expr-eval` sin fix upstream | Informe §5.6 | US-22-F4 | recurrente | vigilancia trimestral |

---

## 6. Ruta Crítica

1. **US-22-A1** (spike Next 15) — debe completarse en los primeros 2 días de S1; todo el resto de E-22-A depende de su inventario.
2. **US-22-C3** (tests mfa-guard) y **US-22-B1** (verificación backup codes) — bloquean **US-22-B4** (activación en producción). No activar MFA sin ambos cerrados.
3. **US-22-A2 a US-22-A4** — deben mergearse antes de **US-22-A5** (UAT); UAT antes de **US-22-A6** (soak); soak antes de promover a producción el **2026-09-05**.
4. **US-22-D1** (CI RLS real) no bloquea nada externo pero es la mayor ganancia estructural del backlog — cierra un gap que hoy depende 100% de disciplina manual.

**Compromiso de fecha con @AE:** la migración Next 15.5.x cierra en producción el **2026-09-05**. Si US-22-A1 revela alcance mayor al estimado, @PO comunica el ajuste el mismo día del spike (2026-08-19 o 2026-08-20), no al final del sprint.

---

## 7. KPIs de Producto Beta.23

| KPI | Línea base | Meta Beta.23 | Medición |
|-----|------------|---------------|----------|
| Versión de Next.js | 14.2.18 | 15.5.x en producción | `apps/web/package.json` |
| `npm audit --omit=dev --audit-level=high` | rojo (Next 14) | verde | CI gate semanal |
| Roles privilegiados con MFA activo | 0% (apagado) | 100% DIR/ARCH/ADMIN | `MFA_REQUIRED_ROLE_CODES` + `User.mfaEnabled` |
| Cobertura `workflow-inbox.router.ts` | RLS-only (4 tests) | funcional + RLS (≥80% líneas) | `npm run test:coverage` |
| Cobertura `middleware.ts` / `mfa-guard.ts` | 0% ambos | ≥80% | `npm run test:coverage` |
| Detección de policy RLS rota en CI | manual (`get_advisors`) | automática, por PR | `.github/workflows/rls-integration.yml` |
| ADR de gobernanza pendientes | 3 | 0 | `docs/adr/0019-0021` mergeados |
| Acciones de config Avante cerradas | 0/5 | 5/5 | evidencia adjunta por US en E-22-F |

---

## 8. Recomendación a @Orq

### Ejecución inmediata (no espera planning formal):

- **US-22-C3** (tests `mfa-guard.ts`) — 34 líneas, riesgo cero, bloquea la activación segura de MFA.
- **US-22-E1** y **US-22-E3** (ADR-0019, ADR-0021) — documentan decisiones ya tomadas, cero riesgo de regresión, cierran deuda de gobernanza de inmediato.
- **US-22-B3** (`MFA_SESSION_SECRET` en Vercel) — config de 5 minutos, prerequisito de todo E-22-B.

### Espera planning formal (S1):

- **US-22-A1** (spike Next 15) — debe ser el primer ítem de S1 por ser bloqueante de toda la épica de mayor riesgo.
- **US-22-D1** (CI RLS real) — requiere coordinación @AS+@DBA sobre infraestructura de Postgres efímero.
- **US-22-B4** (activar MFA en prod) — no ejecutar hasta que US-22-B1/B2/B3 estén cerrados; riesgo de bloquear usuarios privilegiados si se adelanta.

### Requiere decisión de Avante antes de poder planificarse con fecha (E-22-F, US-22-E4):

- Contratación de pentest externo (**US-22-F1**) y DPA con Sentry (**US-22-F2**) tienen ciclo de procurement fuera del control de ingeniería — @PO no puede comprometer fecha de cierre sin respuesta de Avante.
- **US-22-E4** (política de retención) requiere sign-off de Legal/DPO; @AE puede producir el borrador pero no cerrar la US solo.

### Fuera del scope Beta.23 (diferir):

- Migración completa a Next 16+ — no se evalúa hasta que 15.5.x esté estable en producción por al menos un ciclo de release.
- Rediseño de CSP con nonce — solo reabrir si Next 15 cambia el modelo de renderizado estático de forma que resuelva la incompatibilidad de `#440` (evaluar como parte del spike US-22-A1, no como US separada todavía).
- Pseudonimización retroactiva de `chat_message` histórico — depende de la decisión de política de US-22-E4; no se dimensiona hasta tener esa decisión.

---

*Backlog producido por @PO — Inversiones Avante. Fecha: 2026-08-17. Próxima revisión: post-Sprint 1, pre-Sprint 2, con checkpoint intermedio el 2026-08-20 sobre el resultado del spike Next 15 (US-22-A1).*

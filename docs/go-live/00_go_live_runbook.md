# 00 — Go-Live Runbook Operativo

**Proyecto:** HIS Multipaís — Inversiones Avante  
**Autor:** @SRE — Site Reliability Engineer  
**Versión:** 1.0 — 2026-05-18  
**Referencias:** `docs/15_production_runbook.md`, `docs/17_hipercuidado_runbook.md`

> Este runbook es el guion de ejecución para el Día 0 del go-live y los 7 días previos. Cada paso tiene un propietario y un criterio de "hecho". Si algún paso falla, **detener y escalar** — no continuar al siguiente por inercia.

---

## T-7 días — Checklist pre-deploy

**Fecha objetivo:** 7 días calendario antes del cutover.  
**Propietario:** SRE Lead + PO + Clinical Lead.

### Variables de entorno Vercel (Production scope)

Verificar que **todas** existen en scope `Production` (no solo Preview):

```bash
vercel env ls production | sort
```

Comparar contra la lista canónica de `docs/15_production_runbook.md §2`:

| Variable | Estado requerido |
|---|---|
| `DATABASE_URL` | Pooler port 6543, modo transaction |
| `DIRECT_URL` | Puerto 5432 directo |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ejacvsgbewcerxtjtwto.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key rotada post-hardening |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Verificar que NO está en `NEXT_PUBLIC_*` |
| `SUPABASE_JWT_SECRET` | Verificar que coincide con el del proyecto Supabase |
| `AUTH_SECRET` | ≥ 32 bytes random. Generar con `openssl rand -base64 32` |
| `NEXTAUTH_URL` | URL de producción (no Preview URL) |
| `AUDIT_HASH_SECRET` | **Inmutable.** Mismo valor usado durante pruebas |
| `SENTRY_DSN` | DSN servidor válido |
| `NEXT_PUBLIC_SENTRY_DSN` | DSN cliente (puede ser el mismo) |
| `SENTRY_ENVIRONMENT` | `production` |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` |
| `NEXT_PUBLIC_SENTRY_REPLAYS_SESSION` | `0` (PHI — NO habilitar) |
| `NEXT_PUBLIC_SENTRY_REPLAYS_ERROR` | `0` (PHI — NO habilitar) |
| `MAINTENANCE_MODE` | Ausente o `false` |

- [ ] Todas las variables presentes y con valores correctos.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` **no** visible en ninguna variable `NEXT_PUBLIC_*`.
- [ ] `AUDIT_HASH_SECRET` registrado en bóveda de secrets (1Password / AWS SM) con fecha y actor.

### Supabase advisors = 0 CRITICAL

```bash
# Via MCP (herramienta mcp__supabase__get_advisors)
# O Dashboard: Database → Security Advisors
```

- [ ] 0 advisors de nivel CRITICAL.
- [ ] Advisors WARN documentados: los 38 `function_search_path_mutable` están en `docs/go-live/04_carry_over_manual.md` con plan de remediación aprobado.
- [ ] Auth → Leaked Password Protection habilitado (HaveIBeenPwned).

### RLS verificado

```bash
# Ejecutar via mcp__supabase__execute_sql o Supabase SQL Editor:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname IN ('public','ece','audit')
  AND rowsecurity = false
  AND tablename NOT IN ('schema_migrations');
```

- [ ] Resultado vacío — todas las tablas tenant-scoped tienen RLS ON.
- [ ] Validar que `withTenantContext` demota a rol `authenticated` (ver `packages/trpc/src/rls-context.ts`).

### Backup ejecutado y verificado

- [ ] Supabase Dashboard → Database → Backups: backup automático de hoy existe.
- [ ] Tomar snapshot manual: Dashboard → Backups → "Create backup" con label `pre-golive-T-7`.
- [ ] Anotar timestamp del snapshot en este documento: `_______________________`.
- [ ] Verificar PITR habilitado (Plan Pro lo incluye).

### Tag de release

```bash
git tag v1.0.0-go-live
git push origin v1.0.0-go-live
```

- [ ] Tag `v1.0.0-go-live` apuntando al commit HEAD de `main` pre-deploy.
- [ ] GitHub Release creado con changelog desde último tag.
- [ ] `NEXT_PUBLIC_APP_VERSION=1.0.0` configurado en Vercel Production.

### pg_cron habilitado

```sql
-- Verificar que pg_cron está activo:
SELECT * FROM cron.job WHERE jobname = 'expire_pharmacy_reservations';
```

- [ ] Job `expire_pharmacy_reservations` existe y tiene schedule `*/5 * * * *`.
- [ ] REVOKE de anon+authenticated en `public.expire_pharmacy_reservations()` aplicado (ver `docs/go-live/04_carry_over_manual.md`).

### Contingencia paper-based lista

- [ ] Formularios en papel impresos y ubicados en cada estación clínica:
  - Hoja de triaje Manchester (formulario FT-01)
  - Hoja de registro de signos vitales (formulario FSV-01)
  - Hoja de prescripción manual (formulario FP-01)
  - Formulario de dispensación farmacia (formulario FF-01)
- [ ] Personal conoce la ubicación física de los formularios.
- [ ] Procedimiento de entrada retroactiva al HIS documentado (`docs/go-live/02_manuales_usuario/contingencia.md`).

---

## T-1 día — Pre-cutover

**Fecha:** 1 día antes del cutover.  
**Propietario:** SRE Lead + Clinical Lead.

### Smoke tests completos

```bash
# 1. Health check
curl -s https://his-avante.vercel.app/api/health | jq .
# Esperado: { "status": "ok", "checks": { "db": { "status": "ok" } } }

# 2. Autenticación (login manual con usuario de prueba)
# URL: https://his-avante.vercel.app/login
# Credencial: qa.admin@his.test / TestPass123!

# 3. Módulos críticos accesibles
curl -I https://his-avante.vercel.app/triage          # 200 o 302 a login
curl -I https://his-avante.vercel.app/admission       # 200 o 302 a login
curl -I https://his-avante.vercel.app/pharmacy        # 200 o 302 a login
```

- [ ] `/api/health` retorna `{ "status": "ok" }`.
- [ ] Login con usuario admin funciona.
- [ ] Los 3 módulos críticos responden (no 500).
- [ ] Sentry: 0 errores nuevos en últimas 2 horas post-smoke.
- [ ] Vercel Analytics: p95 < 1.5s en últimas 24h.

### Capacitación final

- [ ] Sesión de repaso (30 min) con super-usuarios de cada turno.
- [ ] Números de contacto on-call distribuidos a todos los super-usuarios.
- [ ] Grupo WhatsApp "HIS Hipercuidado" activo con todos los integrantes.
- [ ] Clinical Lead confirma que el personal de turno del Día 0 está capacitado.

### Audit chain integrity

```sql
-- Via Supabase SQL Editor:
SELECT
  MAX(created_at) AS ultimo_registro,
  COUNT(*) AS total_entradas,
  SUM(CASE WHEN chain_hash IS NULL THEN 1 ELSE 0 END) AS sin_hash
FROM audit.audit_log
WHERE created_at > NOW() - INTERVAL '24 hours';
```

- [ ] `sin_hash` = 0.
- [ ] Chain hash del último registro verificado manualmente.

### Status page configurada

- [ ] UptimeRobot apunta a `/api/health` desde 3 regiones con intervalo 1 min.
- [ ] Status page pública accesible: `https://status.avante-his.com`.
- [ ] Alertas configuradas: email + WhatsApp si downtime > 2 min.

---

## T-0 — Día del deploy (cutover)

**Propietario:** SRE Lead (ejecuta). PO + Clinical Lead (aprueban cada etapa).

> Horario recomendado: inicio a las **19:00 hora local** (fin de turno regular) para minimizar impacto clínico. Duración esperada: 45-60 minutos.

### Orden exacto de pasos

#### Paso 1 — Freeze de escrituras en sistema legado (si aplica)

- [ ] Coordinar con equipo de IT bloquear acceso al HIS legado (o poner en modo lectura).
- [ ] Anunciar por megafonía: "Sistema HIS en proceso de actualización. Por favor usar formularios en papel hasta nuevo aviso."
- [ ] Tiempo estimado: 5 min.

#### Paso 2 — Snapshot Supabase pre-deploy

```bash
# Via Dashboard: Database → Backups → Create backup
# Label: "pre-deploy-golive-T0-YYYY-MM-DD"
```

- [ ] Snapshot completado. Timestamp anotado: `_______________________`.
- [ ] DEPLOYMENT_ID actual de Vercel anotado (para posible rollback):
  ```bash
  vercel ls his-avante --token=$VERCEL_TOKEN | head -5
  # Anotar: _______________________
  ```

#### Paso 3 — Vercel deploy a producción

```bash
# Opción A (merge a main dispara auto-deploy):
git push origin main

# Opción B (forzar deploy desde tag):
vercel --prod --token=$VERCEL_TOKEN
```

- [ ] Build iniciado en Vercel Dashboard.
- [ ] Build completado exitosamente (sin errores).
- [ ] Tiempo real de build anotado: `_______________________`.

#### Paso 4 — Seed de datos de producción

> Solo si es primera instancia. Si los datos del legado ya fueron migrados, saltar.

```bash
npm run db:seed
# Carga catálogos base: SLV, monedas, establecimientos
```

- [ ] Seed completado sin errores.
- [ ] Verificar tablas clave:
  ```sql
  SELECT COUNT(*) FROM public."Organization";
  SELECT COUNT(*) FROM public."Establishment";
  SELECT COUNT(*) FROM public."Drug" LIMIT 1;
  ```
  - [ ] Organization: ≥ 1 registro (Avante Complejo Hospitalario).
  - [ ] Establishment: ≥ 1 registro.

#### Paso 5 — Activar pg_cron

```sql
-- Verificar que el job existe y está activo:
SELECT jobid, jobname, schedule, active FROM cron.job;
-- Si no está activo:
UPDATE cron.job SET active = true WHERE jobname = 'expire_pharmacy_reservations';
```

- [ ] Job pg_cron activo y con schedule correcto.

#### Paso 6 — Smoke test post-deploy

```bash
# Health
curl -s https://his-avante.vercel.app/api/health | jq .

# Módulos críticos (autenticado — hacer manual en browser)
# 1. Login como admin
# 2. Navegar a /triage → página carga
# 3. Navegar a /admission → página carga
# 4. Navegar a /pharmacy → página carga
# 5. Crear paciente de prueba (nombre: "PACIENTE TEST GO-LIVE")
# 6. Iniciar triage con dicho paciente
# 7. Eliminar paciente de prueba
```

- [ ] `/api/health` retorna `{ "status": "ok" }`.
- [ ] Los 3 módulos críticos cargan sin errores 500.
- [ ] Flujo básico (login → paciente → triage) completado.
- [ ] Sentry: 0 errores nuevos en últimos 15 min.

#### Paso 7 — Habilitar tráfico

- [ ] Anunciar por megafonía: "Sistema HIS disponible. Por favor iniciar sesión."
- [ ] Publicar en WhatsApp "HIS Hipercuidado": "Sistema live. Turno de hipercuidado inicia."
- [ ] SRE on-call en posición (on-site o remoto con respuesta < 5 min).

#### Paso 8 — Registrar deployment

```bash
# En GitHub Issues, crear issue tipo "release" con:
# - Deployment ID de Vercel
# - Timestamp de cutover
# - SHA del commit deployado
# - Snapshot ID de Supabase
```

- [ ] Issue creado y asignado a SRE Lead.

---

## T+1h — Hipercuidado activo

**Propietario:** SRE on-call + Clinical Lead.

### Checklist hora 1

- [ ] Monitorear Vercel Analytics: error rate < 0.5%, p95 < 1.5s.
- [ ] Monitorear Sentry: 0 nuevos issues P1.
- [ ] Monitorear Supabase Dashboard: conexiones < 80% del pool, sin slow queries > 1s.
- [ ] Verificar que los primeros pacientes del turno se registran exitosamente.
- [ ] Verificar que el triaje Manchester funciona con al menos 1 caso real.
- [ ] Verificar que la farmacia puede dispensar con scan GS1 (si hay turno activo).
- [ ] Primer reporte a PO + Clinical Lead: semáforo verde/amarillo/rojo.

### KPIs hora 1

| KPI | Umbral OK | Valor real | Estado |
|---|---|---|---|
| Error rate API | < 0.5% | | |
| p95 latencia | < 1.5s | | |
| Sentry issues nuevos | 0 P1 | | |
| Tickets soporte | < 5 | | |
| DB connections | < 80% pool | | |

---

## T+24h — Review y decisión continuar/rollback

**Propietario:** PO + SRE Lead + Clinical Lead (quorum 2/3).

### Criterios para CONTINUAR

Todos deben cumplirse:

- [ ] Error rate < 0.1% sostenido 24h.
- [ ] p95 < 400ms (endpoints críticos: triage, admisión, farmacia).
- [ ] Tickets soporte: 0 P1, < 5 P2.
- [ ] Audit chain 100% íntegra.
- [ ] NPS informal de super-usuarios: ≥ "aceptable" (7/10).

### Criterios para ROLLBACK

Si **cualquiera** de los siguientes:

- Error rate > 1% sostenido por > 30 min.
- Pérdida o corrupción de datos clínicos confirmada.
- Brecha de seguridad activa.
- > 3 módulos críticos degradados simultáneamente.

### Decisión

- [ ] Decision anotada (CONTINUAR / ROLLBACK): `_______________________`
- [ ] Firmantes: `_______________________`
- [ ] Timestamp: `_______________________`

---

## Plan de rollback

> Activar si se cumplen los criterios de §T+24h o en cualquier momento durante hipercuidado.

### Rollback de aplicación (≤ 10 min)

```bash
# 1. Identificar deployment anterior estable (anotado en Paso 2 de T-0)
PREV_DEPLOYMENT_ID="<DEPLOYMENT_ID_anotado>"

# 2. Activar maintenance mode
vercel env add MAINTENANCE_MODE production <<< "true"
vercel --prod --token=$VERCEL_TOKEN

# 3. Promover deployment anterior
vercel promote $PREV_DEPLOYMENT_ID --token=$VERCEL_TOKEN

# 4. Verificar
curl -s https://his-avante.vercel.app/api/health | jq .

# 5. Desactivar maintenance mode
vercel env rm MAINTENANCE_MODE production --yes
vercel --prod --token=$VERCEL_TOKEN
```

### Rollback con restore de BD (si hay corrupción de datos, RTO ≤ 4h)

1. Maintenance mode ON (paso 2 arriba).
2. Rollback de aplicación a deployment compatible con schema anterior.
3. Supabase Dashboard → Database → Backups → PITR al timestamp pre-deploy.
4. Validar conteos post-restore:
   ```sql
   SELECT 'Patient' AS tabla, COUNT(*) FROM public."Patient"
   UNION ALL
   SELECT 'Encounter', COUNT(*) FROM public."Encounter"
   UNION ALL
   SELECT 'PharmacyOrder', COUNT(*) FROM public."PharmacyOrder";
   ```
5. Smoke test completo.
6. Maintenance mode OFF.
7. Comunicar reanudación + documentar gap.

### Scripts SQL de rollback (schema)

No aplican migraciones destructivas en este go-live — el schema es aditivo. Si hubiera que revertir un `ALTER TABLE`:

```sql
-- Template (rellenar según migración aplicada):
-- ALTER TABLE public."<Tabla>" DROP COLUMN IF EXISTS "<columna>";
-- DROP TABLE IF EXISTS public."<TablaNueva>";
```

### Comunicación de rollback a stakeholders

| Audiencia | Canal | Mensaje base |
|---|---|---|
| Personal clínico | Megafonía + WhatsApp líderes de servicio | "Sistema HIS en mantenimiento de emergencia. Usar formularios en papel. Aviso de retorno en < 30 min." |
| Dirección médica | Email + llamada | "Incidente técnico HIS. Rollback activado. RTO estimado: < 4h. Siguiente actualización en 1h." |
| Pacientes en espera | Personal de admisión comunica directamente | "El sistema está temporalmente fuera de servicio. Continuamos atendiendo con registro manual." |

---

## Referencias

- `docs/15_production_runbook.md` — Operación diaria, env vars, rollback detallado.
- `docs/17_hipercuidado_runbook.md` — Protocolo completo 14 días post go-live.
- `docs/go-live/01_uat_scenarios.md` — Escenarios UAT ejecutados antes del go-live.
- `docs/go-live/04_carry_over_manual.md` — Items pendientes aplicar antes del deploy.
- `scripts/golive-checklist.sh` — Script automatizado de verificación (cuando esté listo).

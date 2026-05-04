# Runbook de Hipercuidado Post Go-Live (US-9.2)

**Equipo:** Uniform — E9 Onboarding y Go-Live
**Duración:** 14 días corridos contados desde T+0 (cutover)
**Owner rotativo:** SRE on-call + Dev on-call (turnos 12h)
**Canales:** WhatsApp grupo "HIS Hipercuidado" + Slack `#his-hipercuidado` + correo `oncall@avante.com`

---

## 1. Objetivo

Acompañar a los usuarios y al sistema durante las 2 semanas posteriores al Go-Live, con foco en:

1. Tiempo de respuesta < 15 min para incidentes P1.
2. Cero pérdida de datos clínicos.
3. Estabilización de KPIs operativos (ver §4).
4. Transferencia gradual de soporte al equipo BAU al día 14.

## 2. Estructura del equipo

| Rol | Cantidad | Modalidad | Horario |
|---|---|---|---|
| SRE on-call | 2 (lead + backup) | On-site primeros 3 días, luego remoto | 24/7 con rotación |
| Dev on-call (full-stack) | 2 | Remoto | 24/7 con rotación |
| Clinical Lead | 1 | On-site | L-V 7-19, S-D on-call |
| Ops Lead (admisión/facturación) | 1 | On-site | L-V 7-19 |
| Super-usuarios certificados | ≥ 1 por turno y servicio | On-site | 24/7 |
| PO | 1 | Mixto | L-V 8-18 |

## 3. Matriz de escalación L1 / L2 / L3

| Nivel | Quién | Responde | Escala a L+1 si |
|---|---|---|---|
| **L1** | Super-usuario de servicio | Dudas de uso, reset visual, reintentos triviales | > 10 min sin resolución o impacto clínico |
| **L2** | Soporte funcional (Ops/Clinical Lead) | Errores funcionales, datos incorrectos, configuración | > 30 min, error técnico, múltiples usuarios afectados |
| **L3** | SRE / Dev on-call | Errores 5xx, caída de servicio, integridad de datos, seguridad | Incidente P1 → War Room |

**SLA respuesta:**
- P1 (caída total / pérdida datos / brecha seguridad): **< 15 min**.
- P2 (módulo crítico degradado): **< 1 h**.
- P3 (funcionalidad menor): **< 4 h**.
- P4 (cosmético / consulta): **< 24 h**.

## 4. KPIs monitoreados diariamente

Reportados en daily stand-up de 8:00 AM y posteados en `#his-hipercuidado`.

| KPI | Fuente | Umbral verde | Umbral amarillo | Umbral rojo (acción) |
|---|---|---|---|---|
| Tasa de errores 5xx | Vercel + Sentry | < 0.1% | 0.1-0.5% | > 0.5% → war room |
| Latencia p95 endpoints API | OTel/Grafana | < 400 ms | 400-800 ms | > 800 ms |
| Latencia p99 críticos (admisión, triage) | OTel | < 1 s | 1-2 s | > 2 s |
| Tickets de soporte abiertos | Helpdesk | < 20/día | 20-50 | > 50 |
| Cumplimiento SLOs publicados | `docs/08_devops.md` | 100% | 99-100% | < 99% |
| Audit log integrity (cadena hash) | Job nocturno | 100% válida | — | Cualquier rotura → P1 |
| Backups exitosos | Supabase + storage | Diario OK | Falla 1 día | Falla > 1 día |
| Throughput admisiones | DB metrics | ≥ baseline -10% | -10 a -25% | < -25% |

## 5. Cadencia diaria

| Hora | Actividad | Asistentes |
|---|---|---|
| 07:30 | Preflight check (script `scripts/golive-checklist.sh`) | SRE on-call |
| 08:00 | **Daily stand-up** (15 min) | SRE + Dev + Clinical + Ops + PO |
| 12:00 | Snapshot KPIs mediodía | SRE |
| 18:00 | Cierre de día + reporte en Slack | SRE + Ops |
| 23:00 | Verificación backup + handoff turno noche | SRE noche |

**Agenda stand-up:**
1. KPIs últimas 24 h (semáforo).
2. Tickets P1/P2 abiertos.
3. Bloqueos clínicos.
4. Plan del día y dueños.
5. Riesgos próximas 24 h.

## 6. Plan de Rollback (incidente P1 crítico)

Activado por: pérdida de datos confirmada, caída total > 30 min sin solución a la vista, o brecha de seguridad.

**RTO objetivo: < 4 h**. **RPO objetivo: < 15 min** (último PITR snapshot).

### Pasos

1. **T+0 — Declaración** (decision-maker: PO + SRE Lead + Clinical Lead).
   - Anuncio en WhatsApp y `#his-hipercuidado`.
   - Activar contingencia clínica en papel (formularios pre-impresos en cada estación).
2. **T+5 min — Freeze**: deshabilitar escrituras vía feature flag `MAINTENANCE_MODE=true` en Vercel.
3. **T+10 min — Rollback de aplicación**:
   - `vercel rollback <previous-deployment-id> --yes` al último deploy READY conocido (registrado en `docs/18_golive_checklist.md` pre-flight).
4. **T+30 min — Restore de BD** (si aplica):
   - Snapshot Supabase PITR al momento más reciente previo al incidente.
   - Validar conteo de registros vs. último backup verificado.
5. **T+90 min — Smoke test**: ejecutar `scripts/golive-checklist.sh` + suite Playwright crítica.
6. **T+120 min — Comunicación de retorno**: avisar reanudación, documentar gap de datos manuales a re-ingresar.
7. **T+24 h — Post-mortem** (blameless): timeline, causa raíz, action items, RCA publicada.

### Comunicación durante incidente

- **Status page interna**: `https://status.his.avante.local` (actualizada cada 15 min).
- **WhatsApp**: alertas a líderes de servicio.
- **Slack `#his-hipercuidado`**: bitácora técnica detallada.
- **Megafonía hospitalaria**: solo si caída > 1h o impacto a triage.

## 7. Transferencia a BAU (Día 14)

- Reunión de cierre con KPIs consolidados de las 2 semanas.
- Catálogo de incidentes y soluciones publicado en wiki interna.
- Rotación on-call entregada al equipo SRE BAU según `docs/08_devops.md`.
- Backlog de mejoras priorizado y entregado a PO.
- Encuesta de satisfacción a usuarios clínicos (NPS).

## 8. Criterios de éxito del hipercuidado

- [ ] Cero incidentes P1 sin resolver.
- [ ] ≥ 99% cumplimiento SLOs durante 14 días.
- [ ] Tickets/día < 20 en últimos 3 días.
- [ ] NPS usuarios clínicos ≥ 30.
- [ ] Audit chain íntegra durante todo el periodo.

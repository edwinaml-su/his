# Checklist Técnico y Operativo de Go-Live (US-9.3)

**Equipo:** Uniform — E9 Onboarding y Go-Live
**Owner:** SRE Lead + PO + Clinical Lead
**Ventana de cutover prevista:** Día 0 — sábado 02:00 a 04:00 (2 horas)
**Ambiente objetivo:** Producción — Vercel + Supabase region `sa-east-1`

> El script `scripts/golive-checklist.sh` automatiza los ítems marcados con **[auto]**. Ejecutar antes de cada hito y adjuntar output al ticket de cambio.

---

## A. Pre-flight T-7d (revisión y ensayo)

### A.1 Infraestructura y datos
1. [ ] Backup completo de BD producción tomado y validado por restore en sandbox.
2. [ ] Snapshot del último deploy Vercel READY documentado: `DEPLOYMENT_ID = ___`.
3. [ ] PITR (Point-in-Time-Recovery) verificado en Supabase con prueba de restore < 4 h.
4. [ ] Storage de adjuntos clínicos: replicación cross-region activa.
5. [ ] DNS y certificados TLS válidos > 30 días.
6. [ ] Rate limits y quotas Vercel revisados con head-room +50%.
7. [ ] Alertas Sentry y Grafana enrutadas a PagerDuty.

### A.2 Aplicación
8. [ ] Pipeline CI verde en `main` (lint + tests + build + e2e).
9. [ ] Migraciones Prisma aplicadas en orden y reversibles documentadas (`packages/database/prisma/migrations/sql/`).
10. [ ] **[auto]** Smoke test producción: 12 endpoints críticos retornan 200 OK.
11. [ ] **[auto]** Variables de entorno críticas presentes en Vercel (DATABASE_URL, SUPABASE_*, NEXTAUTH_*, AUDIT_HASH_SECRET).
12. [ ] Flags de feature en estado correcto (lista en Vercel env).
13. [ ] **[auto]** Audit chain íntegra (verificación full-scan última semana).
14. [ ] **[auto]** Conexión BD: ping < 1 s desde región del compute.

### A.3 Operaciones y personal
15. [ ] ≥ 90% personal certificado (reporte LMS adjunto) — ver `docs/16_capacitacion_plan.md`.
16. [ ] Super-usuarios identificados en cada turno y servicio.
17. [ ] Plan de contingencia en papel impreso, distribuido y firmado.
18. [ ] Stakeholders notificados con T-7d, T-1d y T+0.
19. [ ] Mesas de ayuda L1/L2/L3 con horarios cubiertos por 14 días — ver `docs/17_hipercuidado_runbook.md`.
20. [ ] Ensayo simulacro completo (dry-run) ejecutado con éxito; retros incorporadas.

### A.4 Cumplimiento y seguridad
21. [ ] Revisión RLS y políticas ABAC: ver `docs/12_rls_validation.md`.
22. [ ] Pen-test reciente (≤ 90 días) sin findings críticos abiertos.
23. [ ] Evidencia de capacitación en privacidad/HABEAS DATA archivada.
24. [ ] Acuerdos de tratamiento con aseguradoras vigentes.
25. [ ] DPIA (Data Protection Impact Assessment) firmada.

## B. T-1d (víspera)

26. [ ] Code freeze declarado y comunicado (no merges a `main`).
27. [ ] Reporte final de cobertura de capacitación firmado por RRHH.
28. [ ] Confirmación de personal SRE/Dev on-site para cutover.
29. [ ] Calls de pre-go-live con cada servicio (15 min): Q&A, números de emergencia.
30. [ ] War room (Zoom + sala física) reservado para Día 0.
31. [ ] **[auto]** Re-ejecución completa de checklist automatizado: todo verde.

## C. Día 0 — Cutover (2 h)

32. [ ] T+0:00 — `MAINTENANCE_MODE=true` activado, banner mostrado.
33. [ ] T+0:05 — Backup final pre-cutover tomado (etiquetado `pre-golive-final`).
34. [ ] T+0:15 — Migración de datos legacy ejecutada (script idempotente, dry-run previo).
35. [ ] T+0:45 — Validación de conteos: pacientes, episodios, usuarios coinciden con origen ±0.
36. [ ] T+1:00 — Promoción del deploy: `vercel promote <id> --prod`.
37. [ ] T+1:10 — DNS warm-up + cache purge de CDN.
38. [ ] T+1:20 — **[auto]** `scripts/golive-checklist.sh` con todos los items en verde.
39. [ ] T+1:30 — Smoke test guiado por checklist clínica (Playwright + manual).
40. [ ] T+1:45 — `MAINTENANCE_MODE=false`, sistema abierto a usuarios.
41. [ ] T+1:50 — Comunicación de apertura a stakeholders y servicios.
42. [ ] T+2:00 — Cierre de ventana; war room queda en hipercuidado activo.

## D. Post Go-Live

### D.1 T+1h
43. [ ] **[auto]** Healthcheck completo (ver script).
44. [ ] Revisión Sentry: cero errores críticos nuevos.
45. [ ] Confirmación de admisión y triage en uso real (3 casos verificados con super-usuario).

### D.2 T+24h
46. [ ] **[auto]** Verificación integridad audit chain de las primeras 24 h.
47. [ ] Reporte KPIs día 1 — ver `docs/17_hipercuidado_runbook.md`.
48. [ ] Triage de tickets recibidos (categorización y priorización).
49. [ ] Backup post-golive verificado.

### D.3 T+1w (semana 1)
50. [ ] Primer reporte ejecutivo (KPIs, incidentes, lecciones aprendidas).
51. [ ] Decisión Go/No-Go para retirada parcial de hipercuidado en semana 2.

---

## Roles de decisión

| Decisión | Quién decide |
|---|---|
| Autorización de Go-Live | PO + Clinical Lead + SRE Lead (unanimidad) |
| Activación de rollback | Cualquiera de los 3 anteriores (mayoría 2/3) |
| Reapertura post-rollback | PO + Clinical Lead |

## Anexos

- Script automatizado: `scripts/golive-checklist.sh`
- Runbook hipercuidado: `docs/17_hipercuidado_runbook.md`
- Plan de capacitación: `docs/16_capacitacion_plan.md`
- DevOps base: `docs/08_devops.md`

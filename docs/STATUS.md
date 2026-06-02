# Estado del Proyecto — HIS Multipaís

> **Documento vivo.** Refleja el estado actual del desarrollo para el equipo y stakeholders.
> **Última actualización:** 2026-06-01 · **Mantener al cierre de cada sprint.**

---

## Resumen ejecutivo

**Estado: técnicamente Go-Live ready.** El sistema cubre ~100% del alcance del TDR en código (solo 2 módulos diferidos por push-back arquitectónico aprobado). Desplegado en producción (Vercel + Supabase). Lo pendiente es **operacional y de cumplimiento formal** (UAT, capacitación, carga de catálogos, pentest externo, acreditaciones), no de construcción.

---

## 1. Cobertura funcional (TDR — 30 módulos)

### Implementado ✅
Multi-entity · Seguridad (Auth/RBAC/ABAC/RLS/audit inmutable) · Catálogos maestros · MPI+ADT · Triage Manchester · Localización SV (DUI/NIT/NIE) · Ambulatorio · Hospitalización · Emergencia · Cirugía (+WHO checklist) · EHR (+49 routers ECE NTEC) · Farmacia · eMAR+BCMA · LIS · RIS · Inventario · Servicios/Equipos · Respiratorio · Nutrición · Contabilidad multi-libro · Aseguradoras · BI/reportería.

### Diferido 🟥 (push-back arquitectónico aprobado — no re-litigar)
| Módulo | Compromiso |
|---|---|
| §23 DTE Hacienda | Servicio DTE dedicado, fase posterior |
| §28 HL7/FHIR/DICOM nativos | Mirth Connect externo; patrón ya probado con Odoo + SRS READ-ONLY |

---

## 2. Funcionalidad destacada (más allá del TDR base)

- **Portal del Paciente** — login passwordless (magic-link) + TOTP, ARCO, resultados lab, citas
- **Workflow Designer NTEC** — editor WYSIWYG + grafo de dependencias + 30 fichas ECE + override por establecimiento
- **GS1 end-to-end** — GSRN (pacientes), GTIN/lote/serie (medicamentos), GLN (ubicaciones), EPCIS, 12+ routers
- **JCI / IPSG** — 6 metas de seguridad del paciente con enforcement + tests
- **WHO Surgical Safety Checklist** · **Manchester Triage** completo (5 niveles + wallboard)
- **Chat asistente** (copiloto context-aware)
- **Dashboard ejecutivo** — 36 KPIs + 7 reportes MINSAL + 41 centros de costo NTEC
- **Integraciones READ-ONLY** — Odoo (XML-RPC) + SRS El Salvador (registro sanitario)
- **Design System v2.0** — tokens OKLCH, Shadcn sidebar, paleta de comandos (Ctrl+K), sparklines vitales, densidad cómoda/compacta, dark mode

---

## 3. Postura de seguridad (Beta.21 + Beta.22 + Sprint 5)

| Área | Estado |
|---|---|
| Multi-tenancy RLS por organización | ✅ |
| Cadena de auditoría criptográfica (SHA-256, 10 años) | ✅ |
| `anon` sin DML en tablas PHI (SQL 152) | ✅ |
| `search_path` fijo en 64 funciones SECDEF/trigger | ✅ |
| MFA TOTP + Vault para secretos de portal | ✅ |
| Rate-limit en endpoints auth (Postgres compartido) | ✅ |
| Security headers HTTP + CSP enforce (`unsafe-inline`) | ✅ |
| OWASP A06 (xlsx → write-excel-file) | ✅ |
| Reset password admin → Supabase Auth (login dual SSO+password) | ✅ |
| Sentry (observabilidad de errores + PII redact) | ✅ cableado — falta activar DSN en prod |
| Pentest externo — preparación (scope, RoE, evidencia) | ✅ docs listos; engagement pendiente |

---

## 4. Gaps conocidos

| Gap | Severidad | Nota |
|---|---|---|
| **GS1 traslados clínicos de paciente** | Media | `encounter-transfer` no emite eventos EPCIS (arriving/departing por GLN). GS1 sí está completo en pacientes, medicamentos y traslados de **inventario**. |
| **nonce-based CSP** | Baja | Intentado y revertido (rompe hidratación de páginas estáticas Next). Baseline = CSP `unsafe-inline`. Reintentar requiere `force-dynamic` (bajo ROI). |
| **TipTap v3 / tiptap-markdown 0.9** | Baja | Pin en 0.8.10 (estable). Migración analizada: NO recomendada por ahora (riesgo serialización, bajo valor). |

---

## 5. Pendiente para Go-Live

### Operacional (equipo Avante)
- [ ] UAT con personal médico real
- [ ] Capacitación + manuales de usuario final
- [ ] Carga inicial de catálogos (medicamentos, ISSS, MINSAL, CIE-10)
- [ ] Migración de pacientes legacy (si aplica)
- [ ] Hipercuidado post-deploy (primeros 7-14 días)

### Cumplimiento formal
- [ ] Pentest externo (preparación lista en `docs/pentest/`)
- [ ] Assessment LOPD/GDPR-equivalente
- [ ] Acreditación JCI (6 IPSG ya implementados)

### Acciones de configuración UI (no requieren código — ~20 min)
- [ ] Branch protection en `main` (GitHub Settings)
- [ ] Supabase: SSL enforce + allowlist de IP admin
- [ ] Activar `SENTRY_DSN` en Vercel + firmar DPA con Sentry (por PHI)
- [ ] Decisión gitleaks v3 (v2 funciona)

---

## 6. Métricas del proyecto

| Métrica | Valor |
|---|---|
| Módulos TDR cubiertos | 28/30 (2 diferidos) |
| Routers tRPC | ~145 |
| Tablas BD (4NF) | ~231 |
| Historias de usuario | ~580 (~1,005 SP) |
| Pruebas automatizadas | 2,500+ |
| PRs mergeados | 440+ |

---

## 7. Referencias

- Alcance detallado y push-backs: `docs/` numerados + `TDR_HIS_Multipais.md`
- Guía operativa para desarrolladores: `CLAUDE.md`
- Business case / valuación: `docs/business/business_case_comercializacion.md`
- Pentest engagement: `docs/pentest/`
- Auditorías de seguridad: `docs/audit/`

---

*Para actualizar este documento: editar al cierre de cada sprint con los cambios de cobertura, seguridad, gaps y pendientes. Mantener la fecha de "Última actualización".*

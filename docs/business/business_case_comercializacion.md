# Business Case — Comercialización HIS Multipaís

**Documento ejecutivo · Inversiones Avante — Unidad de Transformación Digital**
**Versión:** 1.0 · **Fecha:** 2026-06-01 · **Clasificación:** Confidencial — Interno
**Preparado para:** Comité Ejecutivo (CEO / CFO / COO / Dirección Médica)
**Autor:** @Orq (Orquestador de Transformación Digital)

---

> ⚠️ **Naturaleza del documento.** Todas las cifras son **estimaciones con rangos**, basadas en el alcance real construido y en tarifas de mercado 2026. No constituyen una cotización en firme. La precisión depende de composición de equipo, ubicación, retrabajo y profundidad de validación regulatoria.

---

## 1. Resumen ejecutivo

El HIS Multipaís es un **activo de software empresarial de salud, regulado y multi-tenant**, técnicamente listo para Go-Live. Este documento valúa el activo y evalúa su comercialización.

| Indicador clave | Valor |
|---|---|
| **Costo de reconstrucción (activo) — El Salvador** | **USD ~$400K – $650K** |
| **Costo de reconstrucción — nearshore LATAM** | USD ~$670K – $1.5M |
| **Costo de reconstrucción — onshore US** | USD ~$1.3M – $3.1M |
| **Esfuerzo equivalente** | 84 – 128 persona-mes (7–11 persona-años) |
| **Cronograma con equipo humano** | 18 – 30 meses |
| **Modelo comercial recomendado** | **SaaS por cama / por establecimiento** (multi-tenant ya construido) |
| **Valuación potencial del negocio** | 4× – 8× ARR (estándar SaaS salud) |

**Recomendación:** comercializar bajo modelo **SaaS recurrente** (no venta de licencia perpetua), capitalizando el multi-tenancy multipaís ya implementado. El valor del **activo** es su costo de reemplazo; el valor del **negocio** es un múltiplo de los ingresos recurrentes que capture.

---

## 2. Alcance del activo (qué se está valuando)

Sistema de información hospitalaria de extremo a extremo, construido sobre arquitectura moderna y con cumplimiento regulatorio incorporado.

| Dimensión | Magnitud |
|---|---|
| Tablas de base de datos (4NF) | ~231 |
| Endpoints de API (tRPC) | ~145 |
| Historias de usuario entregadas | ~580 (~1,005 story points) |
| Flujos clínicos NTEC modelados | 30 |
| Módulos funcionales | ~30 |
| Pruebas automatizadas | 2,500+ (unit/integration + E2E + accesibilidad) |
| Páginas de aplicación | ~100 |

**Capacidades diferenciadoras (no replicables trivialmente):**
- Multi-tenancy real por **Row Level Security** (multipaís/multi-establecimiento).
- **Cadena de auditoría criptográfica** (hash chain, retención 10 años) — cumplimiento legal.
- **Motor de workflow clínico data-driven** (catálogo NTEC en BD, no hardcoded).
- Estándares **GS1** (trazabilidad de medicación/paciente), **Manchester Triage**, cumplimiento **JCI/IPSG** (6 metas de seguridad del paciente).
- Portal del paciente, firma electrónica, MFA, integraciones (Odoo, registro sanitario SRS).
- Dashboard ejecutivo (36 KPIs) + reportería MINSAL.

---

## 3. Valuación del activo — costo de reconstrucción

Método: dimensionado por artefactos y story points, **cargado** (incluye diseño, QA, gestión, retrabajo y tiempos de espera de CI/revisiones/UAT).

### 3.1 Esfuerzo por área

| Área | Persona-mes |
|---|---|
| Modelo de datos + RLS + cadena de auditoría | 10 – 14 |
| Backend (API, contratos, motor workflow) | 18 – 26 |
| Frontend (Next.js, ~100 páginas, design system) | 16 – 24 |
| Dominio clínico (30 flujos NTEC, GS1, Manchester, JCI) | 12 – 18 |
| Integraciones (Odoo, SRS, Auth, Vault) | 6 – 10 |
| Seguridad + cumplimiento (OWASP, JCI, pentest, hardening) | 8 – 14 |
| QA (2,500+ pruebas, E2E, accesibilidad, performance) | 8 – 12 |
| DevOps/CI-CD + arquitectura + documentación | 6 – 10 |
| **Total** | **84 – 128 persona-mes** |

### 3.2 Costo según mercado (FTE-mes cargado — el "tiempo de espera" ya está incluido)

| Mercado | USD / FTE-mes cargado | Costo de reconstrucción |
|---|---|---|
| **El Salvador / Centroamérica** | ~$3,500 – $6,000 | **$295K – $770K** |
| LATAM nearshore (facturación USD) | ~$8,000 – $12,000 | $670K – $1.5M |
| US / Europa onshore | ~$16,000 – $24,000 | $1.3M – $3.1M |

> **Cifra de referencia (contexto Avante, SV): ≈ $400K – $650K USD.**

### 3.3 Cronograma de reconstrucción

Equipo de 5 (1 arquitecto/lead, 2–3 desarrolladores, 1 QA, ~0.5 PM):
- Desarrollo puro: **17 – 26 meses**.
- Con overhead regulatorio (UAT, validación NTEC/JCI, hardening, pentest): **18 – 30 meses**.

---

## 4. Modelos de comercialización

El multi-tenancy ya construido habilita venta como **producto/SaaS**, no solo como desarrollo a medida.

| Modelo | Referencia de mercado (HIS regional) | Recurrencia | Recomendación |
|---|---|---|---|
| **SaaS por cama/mes** | $15 – $60 USD por cama ocupable/mes | Alta | ⭐ Preferido |
| **SaaS por establecimiento/mes** | $2K – $10K USD/mes según tamaño | Alta | ⭐ Alternativo |
| Licencia por establecimiento | $40K – $150K setup + 18–22%/año mantenimiento | Media | Para clientes que exigen on-premise |
| Implementación + datos + capacitación | +40–80% sobre la licencia (one-time) | Una vez | Complemento obligatorio |

**Recomendación:** **SaaS por cama** como métrica primaria (escala con el valor que recibe el cliente) + cargo de implementación inicial.

---

## 5. Proyección financiera (ilustrativa)

**Supuestos** (conservadores, ajustables):
- Precio promedio: **$30 USD / cama / mes**.
- Establecimiento promedio: **120 camas** → ~$3,600/mes ≈ $43K ARR por establecimiento.
- Costo de implementación inicial: ~$25K por establecimiento (one-time).
- Rampa de adopción regional (SV/CA): 2 → 6 → 12 → 20 establecimientos.

| Año | Establecimientos | ARR recurrente | Ingreso implementación (one-time) | Ingreso total año |
|---|---|---|---|---|
| 1 | 2 | ~$86K | ~$50K | ~$136K |
| 2 | 6 | ~$258K | ~$100K | ~$358K |
| 3 | 12 | ~$516K | ~$150K | ~$666K |
| 4 | 20 | ~$860K | ~$200K | ~$1.06M |

> Cifras ilustrativas para mostrar el orden de magnitud y la curva. El ARR del Año 4 (~$860K) implica una **valuación del negocio de ~$3.4M – $6.9M** (4×–8× ARR).

---

## 6. Costo total de propiedad (TCO operativo anual)

Lo que cuesta **mantener y operar** el sistema en producción (independiente del costo de construcción).

| Componente | USD / año (SV/CA) |
|---|---|
| Equipo de mantenimiento (1 Dev Senior + 1 QA + fracción SRE/PM) | $90K – $150K |
| Infraestructura cloud (Vercel + Supabase, escala media) | $12K – $40K |
| Observabilidad / seguridad (Sentry, escaneo, pentest anual) | $10K – $30K |
| Cumplimiento (auditorías JCI/MINSAL, DPA, legal) | $15K – $40K |
| **TCO operativo anual** | **~$130K – $260K** |

> El TCO se diluye conforme crece la base de clientes (modelo SaaS: costo marginal por cliente decreciente gracias al multi-tenancy).

---

## 7. Valuación del negocio y ROI

- **Valor del activo (hoy):** costo de reemplazo ≈ **$400K – $650K** (SV).
- **Valor del negocio (a futuro):** función del ARR capturado. A 4×–8× ARR:
  - Año 2 (~$258K ARR) → ~$1.0M – $2.1M
  - Año 4 (~$860K ARR) → ~$3.4M – $6.9M
- **Punto de equilibrio operativo:** se alcanza al superar el TCO anual (~$130K–$260K) con ARR — proyectado entre **Año 2 y Año 3**.

---

## 8. Riesgos y supuestos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Validación regulatoria por país (cada mercado tiene su normativa) | Alto | Multi-tenancy multipaís ya construido; adaptar catálogos, no el core |
| Dependencia de equipo senior para mantener invariantes (RLS, audit) | Medio | Documentación viva (CLAUDE.md) + onboarding + review obligatorio |
| Ciclo de venta largo en salud (compliance, compras) | Medio | Implementación + capacitación como ingreso puente |
| Egress de datos a terceros (Sentry, etc.) con PHI | Medio | DPA + redacción de PII ya implementada |
| Acciones de hardening pendientes (branch protection, IP allowlist) | Bajo | UI-only, ~20 min de configuración |

**Supuestos clave:** tarifas de mercado 2026; equipo competente sin retrabajo mayor; alcance congelado al actual; adopción regional según rampa ilustrativa.

---

## 9. Recomendación ejecutiva

1. **Valuar el activo en ≈ $400K – $650K** (costo de reemplazo, base SV) para fines contables / due diligence.
2. **Comercializar como SaaS por cama** + cargo de implementación inicial — capitaliza el multi-tenancy y genera ingreso recurrente.
3. **Cerrar las acciones de hardening pendientes** (branch protection, IP allowlist Supabase, DPA Sentry) antes de salir a mercado — bajo esfuerzo, alto valor de confianza.
4. **Proteger el activo** con un equipo de mantenimiento mínimo (1 Dev Senior + 1 QA) y la disciplina de cumplimiento documentada.
5. Evaluar **expansión regional** apalancando la arquitectura multipaís ya pagada.

---

*Documento generado por la Unidad de Transformación Digital. Las cifras son estimaciones de planeación, no una oferta vinculante.*

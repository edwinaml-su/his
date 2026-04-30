# 01 — Arquitectura Empresarial — HIS Multipaís

**Autor:** @AE — Arquitecto Empresarial (TOGAF 10 + ITIL 4)
**Cliente:** Inversiones Avante
**Fecha:** 2026-04-30
**Versión:** 1.0 (Iniciación — Fase 0)
**Insumo base:** `TDR_HIS_Multipais.md` (1923 líneas, 30 módulos, 20-22 meses)
**Stack obligatorio:** Node.js + Next.js 14 (App Router) + Prisma + Tailwind + Shadcn/ui + Supabase (Auth/Storage/RLS) + tRPC + Zod + Lucide React. Modelo relacional **4NF**.

---

## 1. Análisis de Impacto

### 1.1 Riesgos Regulatorios
- **DTE (Ministerio de Hacienda SV):** una falla en la firma electrónica o el formato JSON de los documentos tributarios bloquea la facturación legal del hospital. Impacto financiero directo y reputacional.
- **MINSAL / CSSP:** incumplir notificación obligatoria de enfermedades, mortalidad materna o PAI puede gatillar sanciones y suspensión de habilitación.
- **Ley de Protección de Datos Personales SV + HIPAA-equivalente:** los datos clínicos son categoría especial; una fuga implica multas y acción civil.
- **LEPINA / LEIV:** flujos específicos para menores y víctimas de violencia con confidencialidad reforzada — no son "feature opcional", son obligación legal.
- **Ley de Medicamentos / Drogas (DNM):** trazabilidad de psicotrópicos y estupefacientes con auditoría a nivel de dosis administrada (eMAR).

### 1.2 Riesgos Clínicos
- **Triage Manchester mal calibrado:** sub-triage de un paciente nivel 1 (rojo) puede causar daño grave o muerte. Requiere validación clínica formal antes de go-live.
- **eMAR sin doble verificación de medicamentos de alto riesgo:** error de dosis es la primera causa de incidente prevenible en hospitales.
- **MPI con duplicados:** pacientes duplicados conllevan pérdida de antecedentes, alergias y diagnósticos críticos.
- **Disponibilidad < 99.9%:** un HIS caído en emergencias es un riesgo asistencial directo.

### 1.3 Riesgos Financieros
- Multi-libro mal configurado → reportes IFRS / fiscal local divergentes → reproceso contable y eventual hallazgo de auditoría externa.
- Errores en convenios / tarifarios → pérdida directa por sub-facturación o rechazos masivos de aseguradoras.
- Cambio de tasa BTC (Ley Bitcoin) y posible derogatoria → exige tasa histórica conservada y configuración por bandera.

---

## 2. Alineación Estratégica

| Objetivo Corporativo Avante | Capacidad HIS que lo habilita | Métrica de éxito |
|---|---|---|
| Eficiencia operativa hospitalaria | Automatización ADT + HCE + eMAR + cuentas hospitalarias | Reducción ≥ 30% en tiempo de admisión y de cierre de cuenta |
| Escalabilidad regional (multi-país) | Núcleo multi-entidad (país / org / moneda / libro) desde Fase 1 | Tiempo de onboarding de nueva organización ≤ 30 días |
| Cumplimiento normativo SV | Tropicalización (DTE, MINSAL, ISSS, JVPM, DUI/NIT) | 100% de reportes regulatorios automatizados |
| Calidad asistencial y seguridad del paciente | Triage Manchester, eMAR con doble verificación, lista OMS quirúrgica | Reducción de eventos adversos medicables |
| Inteligencia de negocio para dirección | BI multi-libro y multi-org con tableros gerenciales | Cierre contable mensual ≤ 5 días hábiles |
| Interoperabilidad regional | HL7 v2 + FHIR R4 + DICOM + IHE | Integración exitosa con MINSAL, ISSS y aseguradoras |

**Conclusión de alineación:** el TDR está alineado con los objetivos corporativos. El núcleo multi-entidad (Fase 1) es el habilitador no negociable de la estrategia regional.

---

## 3. Matriz de Cumplimiento Normativo (TDR §27.1)

Prioridad: **MVP** = Fase 0+1, **F2-F5** = fases asistenciales y financieras, **F6+** = optimización.

| # | Norma / Estándar | Aplicación principal | Prioridad |
|---|---|---|---|
| 1 | Ley de Protección de Datos Personales SV | RBAC/ABAC, RLS Supabase, cifrado, consentimientos | **MVP** |
| 2 | HIPAA-equivalente | Auditoría completa, cifrado AES-256, TLS 1.3 | **MVP** |
| 3 | Ley de Firma Electrónica | Firma de notas clínicas, recetas y DTE | **MVP** (firma) / F5 (DTE) |
| 4 | Código de Salud + Reglamento | Estructura clínica, expediente, alta | **MVP** marco / F2-F4 detalle |
| 5 | Ley SNIS | Catálogos MINSAL, niveles de atención | **MVP** catálogos |
| 6 | Constitución de la República | Derechos del paciente, consentimiento | **MVP** |
| 7 | Normativa MINSAL — habilitación / acreditación | Estructura de establecimientos, profesionales | **MVP** |
| 8 | LEPINA | Flujo pediátrico con tutor legal | F2 |
| 9 | LEIV / Violencia Intrafamiliar | Notificación obligatoria, confidencialidad | F2 |
| 10 | Normativa CSSP / JVPM | Validación de profesionales | **MVP** catálogo |
| 11 | Ley de Medicamentos (DNM) | Catálogo de medicamentos, lote, vencimiento | F4 |
| 12 | Ley de Drogas — psicotrópicos | Trazabilidad reforzada, libro de estupefacientes | F4 |
| 13 | Programas verticales MINSAL (PAI, TB, VIH, ITS, materno-infantil, salud mental, bucal) | Reportes y formularios | F2-F6 |
| 14 | Código Tributario / IVA / ISR / Renta | Cálculo fiscal en cuentas | F5 |
| 15 | Facturación Electrónica DTE | Emisión, firma, contingencia, anulación | F5 |
| 16 | Ley de Integración Monetaria (USD) | Moneda base | **MVP** |
| 17 | Ley Bitcoin (vigente / configurable) | BTC con tasa histórica → USD | F5 (bandera) |
| 18 | Ley LACAP (sector público) | Compras / proveedores | F5 si aplica |
| 19 | Ley Aduanera | Importación de insumos / equipos | Fuera del MVP |
| 20 | ISO 27001 / SOC 2 | Gobierno de seguridad | Transversal — F1 inicia, certificación post go-live |

> **Push back @AE:** marcar 20 normas como "MVP" rompería el cronograma. El MVP debe cubrir el **marco de cumplimiento estructural** (datos, seguridad, identidad, catálogos, auditoría) y dejar la materia normativa específica (DTE, LEIV, LEPINA, programas verticales) a sus fases asistencial/financiera correspondientes. Este desfase debe quedar **explícito en el contrato y aceptado por el sponsor**.

---

## 4. Modelo de Gobernanza TI / RACI

**Convención:** R = Responsable (ejecuta), A = Aprobador (rinde cuentas), C = Consultado, I = Informado.

| Actividad | @Orq | @AE | @AS | @AT | @PO | @Dev | @DBA | @UIUX | @QA | @QAF | @SRE | @BIA | @BID | @DA | @DE |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Estrategia y alineación | A | R | C | C | C | I | I | I | I | I | I | I | I | C | I |
| Arquitectura de software (bounded contexts, DDD) | I | C | R/A | C | C | C | C | I | I | I | C | I | I | I | I |
| Arquitectura de solución (cloud, integraciones) | I | C | C | R/A | I | I | C | I | I | I | C | I | I | C | C |
| Backlog y priorización | A | C | C | I | R | I | I | C | I | C | I | C | I | I | I |
| Diseño UI/UX | I | I | C | I | C | C | I | R/A | I | C | I | I | I | I | I |
| Modelo de datos (4NF) y RLS | I | C | C | C | I | C | R/A | I | I | I | I | C | C | C | C |
| Implementación (Next.js / tRPC / Prisma) | I | I | C | I | C | R | C | C | I | I | C | I | I | I | I |
| QA automatizado (Playwright/Jest) | I | I | I | I | C | C | I | I | R/A | C | C | I | I | I | I |
| QA funcional / BDD (Gherkin) | I | I | I | I | C | I | I | I | C | R/A | I | I | I | I | I |
| Plataforma, IaC y observabilidad | I | I | C | C | I | C | C | I | C | I | R/A | I | I | C | C |
| Plataforma de datos y MDM | I | C | C | C | I | I | C | I | I | I | C | C | C | R/A | C |
| Pipelines analíticos / ETL | I | I | I | C | I | I | C | I | I | I | C | C | C | C | R/A |
| Capa semántica BI / métricas | I | I | I | I | C | I | C | I | I | I | I | C | R/A | C | C |
| Análisis exploratorio / KPIs ejecutivos | I | C | I | I | C | I | I | I | I | I | I | R/A | C | C | C |
| Cumplimiento normativo (DTE, MINSAL, ISSS) | A | R | C | C | C | C | C | I | C | C | C | I | I | C | I |
| Gestión de incidentes (ITIL) | A | C | C | C | I | C | C | I | C | C | R | I | I | I | I |
| Gestión de cambios (CAB) | A | R | C | C | C | I | C | I | C | I | C | I | I | I | I |

**Foros de gobierno (cadencia mínima):**
- Comité de arquitectura: quincenal (@AE, @AS, @AT, @DA, @SRE).
- Refinement / Sprint planning: semanal (@PO, @Dev, @QAF, @UIUX).
- Comité de cumplimiento: mensual (@AE, @PO, sponsor, asesor legal externo).
- CAB de cambios productivos: bajo demanda, post Fase 7.

---

## 5. KPIs del Proyecto

### 5.1 Entrega
| KPI | Umbral verde | Amarillo | Rojo |
|---|---|---|---|
| Cumplimiento de hitos por fase | ≥ 95% | 85-94% | < 85% |
| Velocity estable (sprint) | ±10% | ±20% | > ±20% |
| Lead time de feature (idea → prod) | ≤ 4 sem | 4-8 sem | > 8 sem |

### 5.2 Calidad
| KPI | Verde | Amarillo | Rojo |
|---|---|---|---|
| Cobertura de pruebas automatizadas | ≥ 80% (TDR §29.6) | 70-79% | < 70% |
| Defectos críticos en producción / mes | 0 | 1-2 | ≥ 3 |
| Pruebas de aceptación críticas | 100% OK | 95-99% | < 95% |
| Disponibilidad mensual | ≥ 99.9% | 99.5-99.9% | < 99.5% |
| RPO / RTO probados | ≤ 15 min / ≤ 4 h | leve desvío | desvío material |
| p95 tiempo de respuesta | ≤ 1.5 s | 1.5-2.5 s | > 2.5 s |

### 5.3 Cumplimiento
| KPI | Verde | Rojo |
|---|---|---|
| Reportes regulatorios MINSAL automatizados | 100% | falta cualquiera |
| DTE emitidos sin rechazo | ≥ 99.5% | < 99% |
| Hallazgos de auditoría externa (críticos) | 0 | ≥ 1 |
| Pentest anual sin findings críticos abiertos > 30 días | 100% | cualquiera abierto |
| Revisión semestral de privilegios (TDR §29.8) | ejecutada | omitida |

---

## 6. Top-10 Riesgos y Mitigación

| # | Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|---|
| R01 | Cambio normativo DTE (versión / esquema JSON) | Alto | Alta | Adaptador fiscal aislado + contrato de mantenimiento normativo + bandera de versión |
| R02 | Fuga / acceso indebido a datos clínicos | Crítico | Media | RLS Supabase + RBAC/ABAC + cifrado AES-256 + auditoría inmutable + pentest anual |
| R03 | Triage Manchester mal calibrado (riesgo clínico) | Crítico | Media | Validación por comité clínico + simulación previa + auditoría continua de re-triage |
| R04 | Resistencia al cambio del personal asistencial | Alto | Alta | Super-usuarios por servicio + capacitación práctica + hipercuidado go-live (TDR §30.4) |
| R05 | Calidad de datos legados | Alto | Alta | Plan de saneamiento previo + reglas de migración + conciliaciones dobles |
| R06 | Sub-estimación del MVP (alcance no negociado) | Alto | Alta | Alcance MVP firmado por sponsor (ver §7) + control de cambios formal |
| R07 | Disponibilidad < 99.9% en producción | Crítico | Media | Multi-AZ + DRP probado anualmente + observabilidad nativa + SLO con presupuesto de error |
| R08 | Acoplamiento del monolito modular impide extracción a microservicios | Medio | Media | Bounded contexts DDD desde Fase 1 + contratos tRPC tipados + eventos de dominio |
| R09 | Integraciones HL7/FHIR/DICOM con equipos heterogéneos | Alto | Alta | Bus de integración + mapeos parametrizables + ambiente de pruebas con simuladores |
| R10 | Cambio en Ley Bitcoin durante el proyecto | Medio | Media | Tasa histórica preservada + soporte BTC tras bandera de configuración |

---

## 7. Recomendación Ejecutiva sobre Alcance MVP

**Recomendación @AE:** Mantener el MVP **estrictamente limitado a Fase 0 + Fase 1** del TDR §30.2.

**Alcance MVP recomendado (firme):**
1. Núcleo multi-entidad: país, organización, moneda, libro contable.
2. Seguridad: RBAC + ABAC + RLS Supabase + auditoría completa + Supabase Auth.
3. Catálogos maestros y parametrización (incluye catálogos locales SV: 14 departamentos, municipios, JVPM, MINSAL).
4. MPI / ADT (admisión, altas, traslados) con DUI/NIT/NIE validados.
5. Triage de Manchester con sus 5 niveles (parametrizable, validado clínicamente).
6. Marco de cumplimiento estructural: trazabilidad, consentimientos, cifrado, observabilidad.

**Push back explícito:**
- **NO incluir en MVP:** DTE, eMAR, contabilidad multi-libro, BI gerencial, programas verticales MINSAL. Cada uno tiene complejidad regulatoria/clínica suficiente para justificar su propia fase.
- **NO comprometer 99.9% de disponibilidad** hasta Fase 7 (estabilización). En MVP el SLO razonable es 99.5%.
- **NO firmar 100% de las 20 normas** como cobertura MVP. Solo las marcadas como **MVP** en §3.

**Condiciones de éxito del MVP (definition of done):**
- 23 módulos restantes documentados como **blueprints** (responsabilidad de @AS) antes de cerrar Fase 1.
- Modelo de datos en 4NF revisado y aprobado por @DBA y @AE.
- Pruebas automatizadas ≥ 80% en módulos del núcleo.
- Pentest inicial sin hallazgos críticos abiertos.
- Aceptación formal del sponsor con criterios del TDR §30.3.

**Riesgo de no seguir esta recomendación:** ampliar el MVP a fases asistenciales y financieras antes de consolidar el núcleo multi-entidad genera deuda de arquitectura imposible de revertir sin reescritura, comprometiendo la estrategia regional de Avante.

---

**Fin del documento — listo para revisión por @Orq y sponsor.**

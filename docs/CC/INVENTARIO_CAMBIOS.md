# Inventario de Cambios — HIS Multipaís (Inversiones Avante)

> Resumen **funcional** de todo lo construido en la aplicación con asistencia de Claude (SDLC autónomo @Orq).
> Documento vivo. Agrupa por capacidad de negocio, no PR por PR.

| Campo | Valor |
|---|---|
| Producto | HIS Multipaís — Sistema de Información Hospitalaria (NTEC / ISSS / TDR El Salvador) |
| Repositorio | `edwinaml-su/his` (trunk-based, PRs cortos contra `main`) |
| Rango de trabajo | 2026-05-04 (cierre G0) → 2026-06-25 |
| Numeración de PRs | hasta **#481** (todos mergeados); 368 merges en el historial git local (desde #54), los #1–#53 registrados en bitácora de sesiones |
| Stack | Turborepo + npm workspaces · Next.js 14 (App Router) · tRPC v11 · Prisma 5 · PostgreSQL 17 (Supabase) · Tailwind/Shadcn |
| Despliegue | Vercel (auto-deploy a merge en `main`) + Supabase · imagen Docker/GHCR + spec K8s nube privada |
| Tamaño actual | ~291 rutas de página · 99 routers tRPC raíz + 44 routers ECE · 207 archivos SQL (numerados hasta 181) |

---

## 1. Resumen ejecutivo

El HIS pasó de esqueleto a un sistema hospitalario **técnicamente listo para Go-Live**: registro e identidad de pacientes, expediente clínico electrónico (ECE) conforme a la norma NTEC, motor de flujos clínicos data-driven, órdenes de laboratorio y medicación con trazabilidad GS1, facturación y analítica ejecutiva, portal del paciente, e integraciones externas (Odoo, registro sanitario SRS, catálogo CIE-11 de la OMS). Todo bajo multi-tenancy con Row Level Security, auditoría criptográfica inmutable y endurecimiento de seguridad validado por pentest + cumplimiento JCI.

**Pendientes conocidos:** UAT, capacitación, carga de catálogos productivos, cierre de pentest/JCI compliance. **Diferidos por push-back arquitectónico:** facturación electrónica DTE Hacienda (TDR §23) e interoperabilidad HL7/FHIR/DICOM (TDR §28).

---

## 2. Línea de tiempo de hitos

| Fecha | Hito | PRs |
|---|---|---|
| 2026-05-04 | Cierre G0 (Sprint 0): typecheck/lint/build/test/RLS en verde; gaps RLS y FK documentados | — |
| 2026-05-07 | Sprint 3: cableado de 9 routers, RLS con demote de rol en runtime, E2E reescritos | #3 |
| 2026-05-12 | Waves 6–8: esqueletos de módulos clínicos y administrativos (Fase 2 MVP) | #6–#8 |
| 2026-05-13 | Fase 5+6: schema/RLS/auditoría a Supabase, fix de build Vercel, documentación | #9–#20 |
| 2026-05-13 | Beta hardening 1–13 | #21–#42 |
| 2026-05-18 | GS1 Bedside (15 streams) + **cierre de Fase 2** (~905 SP) + Workflow Designer | #125, #134, #139, #149 |
| 2026-05-19 | Auditoría masiva y remediación (271 hallazgos, 52 P0; sprints S0–S8) | #160–#210 |
| 2026-05-22 | Workflow-designer completo (6 fases): 30 fichas NTEC, seed BD, WYSIWYG+grafo, enforcement, wizard, overrides DIR | #211–#218 |
| 2026-05-24 | Finanzas + dashboard de KPIs ejecutivos | #242–#254 |
| 2026-05-25 | Integración Odoo (XML-RPC, solo lectura) | #255 |
| 2026-05-25 | Integración SRS (registro sanitario El Salvador) | #256 |
| 2026-05-26 | Portal del paciente (tablas + RLS en producción) | — |
| 2026-05-30 | **Beta.21** — Pentest + cumplimiento JCI (17 P0 + 4 P1 cerrados; SQL 149–162; 44 Gherkin JCI) | #374–#424 |
| 2026-06-01 | **Beta.22 + Sprint 5 + Design System v2** (rediseño visual, Sentry, CSP, Vault MFA, rate-limit Postgres) | #356–#445 |
| 2026-06-02 | Landing ECE (admisiones por área) + corrección de drift de queries | #460–#462 |
| 2026-06-03 | Tab "Admisiones" con histórico del paciente en `/patients/[id]` | #463 |
| 2026-06-10 | Detalle de admisión ambulatoria `/ece/admision/[id]` | #464 |
| 2026-06-11 | Remediación masiva de drift schema↔SQL en ECE + harness de integración | #470 |
| 2026-06-16 | Cumplimiento GS1 El Salvador — MDM en 3 niveles | #471 |
| 2026-06-23 | **CC-0001** — Rediseño de historia clínica Avante (CIE-11, Destino, antecedentes, signos vitales) | #473 |
| 2026-06-24 | **CC-0002** — Expediente único de paciente + cuentas y servicios | #474 |
| 2026-06-24 | **CC-0003** — Menú de navegación táctil (kioskos/tablets) + kiosko como landing | #475, #477 |
| 2026-06-24 | Empaque Docker/GHCR + spec K8s nube privada | #476, #478 |
| 2026-06-24 | **CC-0004** — Evolución médica SOAP a flujo vertical orientado a problemas | #479 |
| 2026-06-24 | **CC-0005** — Orden de ingreso por documento + diagnóstico CIE-11 | #480 |
| 2026-06-25 | Cierre de deuda de accesibilidad de Orden de Ingreso (labels, combobox CIE-11, dead code) | #481 |
| 2026-06-25 | **CC-0006** — Evolución médica SOAP: rebuild dirigido por modales + autosave Supabase + inmutabilidad post-firma (SQL 181); ajustes Avante: "problema sindrómico", signos en sección propia sobre Objetivo, todos los campos obligatorios para firmar | #484 |

---

## 3. Inventario por dominio funcional

### 3.1 Identidad del paciente y expediente
- **Registro y MPI** de pacientes con validadores salvadoreños (DUI/NIT/NIE) con paridad TS↔SQL.
- **Expediente único** con identificador inmutable `{PAÍS}{AA}{NNNNN}` y **deduplicación por documento** de identidad (CC-0002).
- **Cuentas y servicios** del paciente (`PatientAccount` / `Service`) para soporte clínico-administrativo.
- **Histórico de admisiones** del paciente: tab "Admisiones" en la ficha y detalle por admisión ambulatoria/hospitalaria.
- **Resolución por documento**: la captura de paciente en formularios usa tipo+número de documento (DUI, carnet de residencia, pasaporte, DUI de responsable) en lugar de UUID manual (CC-0005).

### 3.2 Atención clínica — Expediente Clínico Electrónico (ECE)
44 routers ECE. Capacidades clínicas principales:
- **Triage Manchester** (legacy extendido, con puente a `ece.hoja_triaje`).
- **Encuentros y episodios** hospitalarios y ambulatorios; landing de admisiones por área.
- **Historia clínica** rediseñada al modelo Avante: diagnósticos **CIE-11**, sección de Destino, análisis clínico, antecedentes y signos vitales (CC-0001).
- **Evolución médica (SOAP)**: flujo vertical orientado a problemas (CC-0004), reconstruido a un modelo **dirigido por modales** con autosave a Supabase (sin localStorage), agrupación de problemas bajo un "problema sindrómico", **signos vitales en sección propia (sobre Objetivo)** con alertas críticas, Plan ítem a ítem, **todos los campos obligatorios para firmar** e inmutabilidad post-firma (CC-0006).
- **Orden de ingreso**: identificación por documento + diagnósticos CIE-11 (1 principal obligatorio + secundarios), firma electrónica (CC-0005).
- **Consentimientos informados NTEC** (hospitalización, quirúrgico; doble firma, inmutables post-firma).
- **Defunción** (CIE estructurada), **epicrisis**, **URPA**, **indicaciones médicas**, **bitácora ECE**, ficha de identificación, rectificación.
- **Signos vitales** como módulo compartido reutilizado por varios documentos.

### 3.3 Motor de workflow clínico (data-driven NTEC)
- Catálogo en BD: **31 tipos de documento**, estados y transiciones, dependencias entre documentos.
- **30 fichas de flujo** NTEC (metadata, dependencias, roles, eventos) como fuente de verdad.
- **Workflow Designer** administrativo: lista, **grafo de dependencias** (ReactFlow) y **editor WYSIWYG** (TipTap).
- **Enforcement** de dependencias firmadas (trigger BEFORE INSERT en BD + capa TS).
- **Overrides por establecimiento** (rol DIR): obligatoriedad y dependencias configurables por sede.
- **Wizard "próximos documentos"** en el episodio hospitalario.

### 3.4 Órdenes, laboratorio y medicación
- **Órdenes de laboratorio / LIS** con valores críticos, rangos de referencia y reglas reflex.
- **Prescripciones y administración de medicación** con verificación a pie de cama (**BCMA**).

### 3.5 Trazabilidad GS1
- **Bedside scanning** y modos especiales de captura GS1.
- **Cumplimiento GS1 El Salvador**: MDM en 3 niveles, catálogo canónico de GTIN (`ece.gs1_gtin`).
- Base para **EPCIS** (eventos de trazabilidad; cobertura parcial, traslados clínicos pendientes).

### 3.6 Finanzas y analítica
- **Facturación**: `Invoice` / `Item` / `Payment` / `Claim`.
- **41 centros de costo** NTEC y tarifario.
- **Dashboard ejecutivo** con 36 KPIs, sparklines y vista financiera.
- **7 reportes MINSAL**.

### 3.7 Portal del paciente
- Registro, login y **MFA**; cuentas de portal con secreto MFA en **Supabase Vault**.

### 3.8 Experiencia de usuario
- **Design System v2**: paleta OKLCH, sidebar Shadcn, **command palette**, sparklines, control de densidad, View Transitions.
- **Navegación táctil** derivada para kioskos/tablets, con kiosko como landing en tablets y atajo fijo en desktop (CC-0003).

---

## 4. Integraciones externas (lectura por defecto)

| Integración | Propósito | Modo |
|---|---|---|
| **Odoo** (XML-RPC) | ERP corporativo de Avante | **Solo lectura** (escritura cancelada por decisión de negocio) |
| **SRS** | Padrón de registro sanitario de El Salvador → catálogo de medicamentos | Lectura + caché local + cron de revalidación |
| **WHO ICD-11** | Búsqueda de diagnósticos CIE-11 (MMS) | Lectura (credenciales en Vercel) |

---

## 5. Plataforma, seguridad y cumplimiento

- **Multi-tenancy con Row Level Security** (`withTenantContext`: demote a rol `authenticated` dentro de transacción; `organization_id` + JWT).
- **Auditoría con cadena de hash** (SHA-256 encadenado, inmutabilidad criptográfica, retención 10 años).
- **Endurecimiento de seguridad** (Beta.21/22): Supabase Vault para secretos de portal, `search_path` fijo en funciones, revocación de DML a `anon`, **rate limiting** compartido en Postgres, CSP, reset de contraseña contra Supabase Auth (login dual SSO+password), Sentry con redacción de PII.
- **Pentest + cumplimiento JCI**: 17 P0 + 4 P1 cerrados; 44 escenarios Gherkin JCI (read-back, SBAR, doble identificación de laboratorio).
- **CI/CD**: pipelines de typecheck/lint/test/build/axe, E2E nightly (Playwright), migraciones controladas y escaneo de seguridad semanal (npm audit + gitleaks).

---

## 6. Controles de cambio (CC)

Proceso formal de cambios bajo `docs/CC/NNNN/`. Estado:

| CC | Requerimiento | Entrega | Estado |
|---|---|---|---|
| **CC-0001** | Rediseño historia clínica Avante (CIE-11, Destino, análisis, antecedentes, signos vitales) | #473 | Mergeado |
| **CC-0002** | Expediente único + cuentas y servicios; dedup por documento | #474 | Mergeado (SQL 176–178 en prod) |
| **CC-0003** | Menú de navegación táctil para kioskos/tablets | #475 | Mergeado |
| **CC-0004** | Evolución médica SOAP — flujo vertical orientado a problemas | #479 | Mergeado |
| **CC-0005** | Orden de ingreso por documento + diagnóstico CIE-11 | #480 | Mergeado (SQL 179–180 en prod) |
| CC-0005 (deuda) | Accesibilidad de Orden de Ingreso (labels, combobox CIE-11, limpieza) | #481 | Mergeado |
| **CC-0006** | Evolución médica SOAP — rebuild dirigido por modales (S + signos en sección propia + O/A, Plan ítem a ítem), agrupación bajo "problema sindrómico", todos los campos obligatorios para firmar, autosave a Supabase (sin localStorage), inmutabilidad post-firma; corrige el `create` roto de #479; **supersede la UI grid POMR de #482** | #484 | PR abierto — SQL 181 en prod |

---

## 7. Estado actual

- **Técnicamente Go-Live ready.** De los 18 módulos originalmente fuera del MVP, 16 quedaron implementados; 2 diferidos (DTE Hacienda §23, HL7/FHIR/DICOM §28).
- **Producción**: aplicación en Vercel + Supabase (`ejacvsgbewcerxtjtwto`); migraciones SQL aplicadas hasta la 181.
- **Pendiente operativo**: UAT, capacitación, carga de catálogos productivos, cierre de pentest/JCI.

---

## 8. Esfuerzo equivalente: equipo tradicional vs. CTO fraccionado + IA

> Estimación de **orden de magnitud** para dirección/negocio. Compara construir el mismo alcance con un **equipo tradicional + CTO fraccionado** frente a lo realmente ejecutado: **CTO fraccionado (tú) orquestando agentes de IA** bajo el framework @Orq. Cifras en USD; supuestos explícitos en §8.3 y ajustables.

### 8.1 Equipo tradicional equivalente (mapa a roles SDLC)

| Rol SDLC | Función | FTE equiv. |
|---|---|---|
| @AE / @AS / @AT | Arquitectura empresarial, software y cloud | 1.5 |
| @Dev | Desarrollo full-stack (Next.js/tRPC/Prisma) | 5.0 |
| @DBA / @DA | Modelado de datos, RLS, migraciones, MDM | 1.5 |
| @UIUX | Interfaz, design system, accesibilidad | 1.0 |
| @QA / @QAF | Automatización, E2E, BDD/Gherkin, cobertura | 2.0 |
| @SRE | CI/CD, Vercel/Supabase, Docker/K8s, observabilidad | 1.0 |
| @PO | Backlog (~580 historias de usuario), priorización | 1.0 |
| @DE / @BIA / @BID | Pipelines de datos y analítica/BI | 1.0 |
| **CTO fraccionado (tú)** | Gobierno, arquitectura, criterios y validación | 0.5 |
| **Total** | | **~13.5 FTE** |

### 8.2 Comparativa (tiempo · esfuerzo · dinero)

| Dimensión | Equipo tradicional + CTO | Real: CTO fraccionado + IA (@Orq) | Diferencia |
|---|---|---|---|
| **Tiempo calendario** | ~12–15 meses (paralelizado) | ~1.8 meses (7.5 semanas) | **~7–8× más rápido** |
| **Esfuerzo humano** | ~110 persona-mes (~9 persona-años) · ~13 personas | ~2–3 persona-mes · 1 persona | **~40× menos** |
| **Costo equipo de desarrollo** | ~$660K (110 PM × ~$6K/PM) | sustituido por IA | — |
| **Costo CTO fraccionado** | ~$100K (~13 meses) | ~$25K (~2 meses) | — |
| **Herramientas IA + infra** | n/a | ~$5K | — |
| **Costo total** | **~$0.75M** (rango ~$0.6M–$1.0M) | **~$30K** | **~96% menos (~25×)** |

### 8.3 Supuestos
- **Alcance comparado** = lo entregado a la fecha (≈481 PRs, ~580 historias, estado "Go-Live ready") — **no** un sistema 100% certificado en producción (faltan UAT, capacitación, carga de catálogos y cierre pentest/JCI en **ambos** escenarios).
- **Costo por persona-mes** totalmente cargado (salario + cargas + overhead), blended nearshore/LATAM: **$5,000–$7,000/PM**. A tarifas US/EU el costo del equipo tradicional se multiplica ~2–3×.
- **CTO fraccionado** valuado ~$10K/mes a medio tiempo; en el escenario real concentrado en ~2 meses de orquestación intensiva.
- El tiempo del equipo tradicional asume paralelización realista con su overhead de coordinación y ramp-up; los 12 meses son el extremo optimista.

### 8.4 Lecturas para dirección
- **Compresión de time-to-market ~7–8×**: el mismo alcance funcional disponible en ~2 meses en lugar de ~1 año — el valor clínico/operativo se captura casi un año antes.
- **Reducción de costo ~25×** (~$0.7M evitados) manteniendo al CTO como punto único de gobierno, decisión y validación.
- **El factor humano sigue siendo crítico**: el resultado depende de la dirección experta del CTO (requerimientos, arquitectura, criterios de aceptación, *trust-but-verify* sobre el output de los agentes). La IA **amplifica** al CTO, no lo reemplaza.

---

> **Gobierno SDLC:** todo el trabajo siguió el framework autónomo @Orq (14 agentes, 6 fases, gates G0–G8). @Orq orquesta y no codifica; @Dev implementa; @QA/@QAF validan; @SRE opera. La declaración formal de "Project Completed" corresponde solo a @Orq tras el gate G8. Este inventario es descriptivo de avance, no una declaración de cierre de proyecto.

> **Trazabilidad fina:** el detalle PR por PR vive en el historial de `git log` (`main`) y en la bitácora de sesiones; los flujos NTEC en `docs/flujos/{CÓDIGO}.md` y `docs/31_flujos_operativos_consolidado.md`; el modelo de datos en `docs/04_modelo_datos.md`.

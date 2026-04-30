# 05 — Backlog Scrum del MVP (Fase 0 + Fase 1)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Autor:** @PO — Chief Product Officer
**Versión:** 1.0 — 2026-04-30
**Marco:** Scrum + SAFe-lite, MoSCoW, Fibonacci, ITIL v4
**Referencia:** `TDR_HIS_Multipais.md` §5–§9, §27, §30; `docs/01_…04_…md`; `packages/database/prisma/schema.prisma`
**Alcance MVP:** Fase 0 (Iniciación, ~1 mes) + Fase 1 (Núcleo y Multi-Entidad, ~3 meses)

---

## 1. Visión del Producto

> **Para** las organizaciones de salud del grupo Inversiones Avante en El Salvador y la región,
> **que** requieren un sistema único, gobernado y trazable para gestionar la atención clínica y administrativa,
> **el** HIS Multipaís **es** una plataforma SaaS hospitalaria
> **que** unifica la identidad del paciente (MPI), la admisión (ADT), el triage Manchester y los catálogos maestros bajo una arquitectura multi-país, multi-organización, multi-moneda y multi-libro contable, tropicalizada para El Salvador.
> **A diferencia de** los HIS legados monolíticos y los SaaS extranjeros sin tropicalización fiscal/regulatoria,
> **nuestro producto** entrega una base de plataforma extensible (FHIR-ready, HL7 v2, DICOM-ready), auditable de extremo a extremo, lista para crecer hacia ambulatorio, hospitalización, diagnóstico, financiero y BI.

**Elevator pitch (30 s):** "Un HIS regional que arranca con lo crítico —identificar pacientes sin duplicidad, admitirlos rápido y triarlos según Manchester— sobre cimientos multi-país y seguridad de grado clínico, listo para escalar a 30 módulos sin reescribir."

---

## 2. Personas / Usuarios Principales

| # | Persona | Objetivo principal | Frustración actual |
|---|---------|-------------------|--------------------|
| **P1** | **Médico general / especialista** | Acceder rápido al expediente, registrar evolución, firmar notas | Tiempo perdido buscando datos, duplicados, copia/pega |
| **P2** | **Enfermería (asistencial)** | Ejecutar plan de cuidados, registrar signos vitales, identificar paciente con pulsera | Doble registro en papel y sistema |
| **P3** | **Personal de admisión** | Registrar pacientes en < 3 min, evitar duplicados, asignar cama y cuenta | DUI mal capturado, dos expedientes para una misma persona |
| **P4** | **Triador (enfermera/o de emergencia)** | Clasificar por Manchester en < 5 min con criterios objetivos | Subjetividad, falta de cronómetro, sin tablero realtime |
| **P5** | **Farmacéutico** | Validar prescripciones, controlar lotes y vencimientos *(post-MVP, presente para impacto downstream)* | Recetas ilegibles, sin alertas de interacción |
| **P6** | **Jefe de servicio / Coordinador clínico** | Ver indicadores de su unidad (ocupación, tiempos, LWBS) | Reportes manuales en Excel |
| **P7** | **Administrador clínico** | Mantener catálogos (CIE-10, especialidades, flujogramas Manchester) sin tickets a TI | Dependencia total del proveedor para cualquier cambio |
| **P8** | **Super-admin TI / SRE** | Gestionar países, organizaciones, usuarios, MFA, auditoría | Logs dispersos, sin trazabilidad firmada |
| **P9** | **Paciente** *(visibilidad MVP, portal en Fase 7)* | Recibir atención sin repetir datos, consentir uso de información | Volver a explicar alergias en cada visita |

---

## 3. Épicas del MVP (10 épicas alineadas a bounded contexts)

| ID | Épica | Bounded Context | Módulo TDR | Story Points | MoSCoW |
|----|-------|-----------------|------------|--------------|--------|
| **E0** | **Plataforma base y DevEx** (Fase 0) | platform | §4, §29 | 34 | **Must** |
| **E1** | **Multi-Entidad** (país, organización, establecimiento, moneda, libro) | identity | §5 | 55 | **Must** |
| **E2** | **Seguridad, AuthN/AuthZ, Auditoría** | security | §6 | 55 | **Must** |
| **E3** | **Catálogos Maestros (núcleo MVP)** | catalog | §7 | 47 | **Must** |
| **E4** | **MPI — Identificación Única del Paciente** | adt | §8.1 | 42 | **Must** |
| **E5** | **ADT — Admisión, Traslados, Altas, Censo** | adt | §8.2–§8.7 | 55 | **Must** |
| **E6** | **Triage Manchester (52 flujogramas + retriage)** | triage | §9 | 47 | **Must** |
| **E7** | **Localización SV (DUI/NIT, geo, JVPM, MINSAL est.)** | localization-sv | §27 | 21 | **Must** |
| **E8** | **Observabilidad, SRE y Cumplimiento** | platform | §29 | 21 | **Should** |
| **E9** | **Onboarding, capacitación y go-live MVP** | change-mgmt | §30 | 13 | **Should** |
| | **TOTAL MVP** | | | **390 SP** | |

---

## 4. User Stories Detalladas por Épica

> **Convención:**
> - **SP** = story points (Fibonacci 1, 2, 3, 5, 8, 13).
> - **MoSCoW:** Must / Should / Could / Won't (en MVP).
> - Criterios de aceptación en **Gherkin** cuando aportan; checklist cuando son verificables binariamente.
> - Toda story respeta DoR/DoD (sección 5).

---

### E0 — Plataforma base y DevEx (34 SP) · Sprint 0

#### US-0.1 · Monorepo Turborepo con apps/web, packages/{ui,domain,database,api} (Must · 5 SP)

**Como** @Dev / @SRE
**quiero** un monorepo con paquetes preconfigurados (TypeScript strict, ESLint, Prettier, Vitest)
**para** que cualquier desarrollador pueda clonar, instalar y correr `dev` en ≤ 10 min.

**Criterios de aceptación**
- `pnpm install && pnpm dev` levanta la app web en `localhost:3000` sin errores.
- `pnpm build` produce artefactos de las 4 apps/packages sin warnings de TS.
- `.cursorrules` / `CLAUDE.md` documenta convenciones.

#### US-0.2 · Provisión Supabase (Postgres + Auth + Storage + Realtime) (Must · 5 SP)

**Como** @SRE
**quiero** dos proyectos Supabase aislados (dev, prod) con RLS habilitado por defecto
**para** garantizar separación de entornos y cumplimiento de privacidad desde el día 1.

**Criterios de aceptación**
- RLS activo en todas las tablas; políticas mínimas documentadas.
- Backups diarios habilitados con retención 30 días.
- Variables de entorno gestionadas en Vercel + Doppler.

#### US-0.3 · Pipeline CI/CD GitHub Actions → Vercel (Must · 5 SP)

```gherkin
Dado un PR abierto contra main
Cuando se ejecuta el pipeline
Entonces corre lint + typecheck + test unitario + build
Y publica preview de Vercel automáticamente
Y bloquea merge si cualquier check falla.
```

#### US-0.4 · Esquema Prisma base + migraciones iniciales (Must · 8 SP)

**Como** @DBA
**quiero** que el schema 4NF (`schema.prisma`, 58 modelos) se aplique con migraciones versionadas
**para** que todo cambio de modelo de datos sea auditable y reversible.

**Criterios**
- `prisma migrate deploy` aplica limpio en DB vacía.
- Seed mínimo: 1 país (SV), 1 organización demo, 1 establecimiento.
- Convenciones snake_case validadas con linter.

#### US-0.5 · Inngest (workers + outbox) y Sentry (Must · 5 SP)

- Outbox pattern: `domain_events` con worker que publica a Inngest.
- Sentry capturando errores frontend y backend; alertas a Slack.

#### US-0.6 · Design System base (Tailwind + shadcn/ui + tokens Avante) (Must · 3 SP)

- Componentes base: Button, Input, Select, Table, Dialog, Toast, FormField.
- Storybook con 100% de componentes documentados.
- Modo claro/oscuro y prefijo i18n (es-SV por defecto).

#### US-0.7 · Plantilla de testing E2E con Playwright (Should · 3 SP)

- Smoke test "login → dashboard" verde en CI.

---

### E1 — Multi-Entidad (55 SP)

#### US-1.1 · Crear y administrar Países (Must · 5 SP)

**Como** Super-admin TI (P8)
**quiero** dar de alta países (ISO 3166-1 alpha-3) con timezone, idioma y moneda funcional
**para** habilitar la operación regional.

```gherkin
Dado que soy super-admin
Cuando creo el país "SV" con timezone "America/El_Salvador" y moneda "USD"
Entonces el país queda activo y disponible para asociar organizaciones
Y se publica el evento CountryActivated en outbox.
```

**Criterios**
- Validación ISO 3166-1 alpha-3 / 4217.
- No se puede desactivar un país con organizaciones activas.

#### US-1.2 · Jerarquía Holding → Empresa → Establecimiento → Sede → Servicio (Must · 8 SP)

- 4 niveles obligatorios + servicio opcional.
- Cada nodo hereda atributos del padre salvo override explícito.
- UI de árbol con drag-and-drop (admin).

#### US-1.3 · Multi-moneda con tasas de cambio (Must · 8 SP)

- Tipos de tasa: compra, venta, promedio, oficial, fiscal.
- Carga manual + endpoint de importación BCR/feed regional.
- Histórico inmutable; cambios versionados.

#### US-1.4 · Multi-libro contable (fiscal, IFRS, gerencial, presupuestal) (Must · 13 SP)

- Activación/desactivación de libros por organización.
- Cada libro con su plan de cuentas (los datos contables vienen en Fase 5; aquí solo el cimiento).
- Política de redondeo por libro/moneda.

#### US-1.5 · Selector de contexto multi-entidad en header (Must · 5 SP)

```gherkin
Dado que el usuario tiene acceso a 3 establecimientos
Cuando entra al sistema
Entonces ve un selector establecimiento/sede/servicio
Y todos los datos en pantalla se filtran por la selección
Y la selección se persiste por sesión.
```

#### US-1.6 · Configuración de moneda funcional y de presentación por organización (Must · 5 SP)

#### US-1.7 · Aislamiento por org_id en RLS (Must · 8 SP)

- Toda tabla con `organization_id` aplica RLS.
- Test: usuario de org A no puede leer datos de org B (test E2E + unit).

#### US-1.8 · Auditoría de cambios en estructura organizativa (Should · 3 SP)

---

### E2 — Seguridad, AuthN/AuthZ y Auditoría (55 SP)

#### US-2.1 · Login email + contraseña con políticas (Must · 3 SP)

- Política configurable: longitud, complejidad, expiración, historial.
- Bloqueo tras N intentos fallidos.

#### US-2.2 · MFA TOTP obligatorio para roles privilegiados (Must · 5 SP)

```gherkin
Dado un usuario con rol "admin_clinico" o "super_admin"
Cuando inicia sesión
Entonces se le exige código TOTP además de contraseña
Y los códigos de respaldo se entregan en el primer enrolamiento.
```

#### US-2.3 · RBAC con catálogo de permisos por módulo (Must · 8 SP)

- Roles base: super_admin, admin_clinico, admision, triador, enfermeria, medico, jefe_servicio, lectura.
- UI de gestión de roles y permisos.

#### US-2.4 · ABAC por servicio/sede/turno (Must · 5 SP)

- Reglas de atributos: usuario X solo ve pacientes de servicio Y en turno Z.

#### US-2.5 · SSO SAML/OIDC (WorkOS) (Should · 5 SP)

#### US-2.6 · Sesión segura con expiración y revocación (Must · 3 SP)

- Idle timeout 15 min (parametrizable).
- Cerrar todas las sesiones desde panel admin.

#### US-2.7 · Break-glass (acceso de emergencia) auditado (Must · 5 SP)

```gherkin
Dado un médico de emergencias sin permiso normal sobre el paciente
Cuando activa "break-glass" con justificación obligatoria
Entonces accede al expediente
Y se notifica al jefe de servicio en < 5 min
Y queda registrado en audit_log inmutable.
```

#### US-2.8 · Audit log append-only con encadenamiento hash (Must · 8 SP)

- Cada entrada lleva hash del previo (cadena tipo blockchain ligero).
- Alerta `AuditChainBroken` si verificación nocturna falla.
- Exportable a SIEM externo (formato JSON/CEF).

#### US-2.9 · Consentimiento informado de tratamiento de datos (Must · 5 SP)

- Versionado del texto de consentimiento por país.
- Token de consentimiento por paciente con timestamp y firma.

#### US-2.10 · Política de contraseñas y gestión de cuentas (Must · 3 SP)

#### US-2.11 · Cifrado en reposo (Postgres) y en tránsito (TLS 1.3) (Must · 5 SP)

---

### E3 — Catálogos Maestros núcleo MVP (47 SP)

> Solo catálogos críticos para Fase 1: geo, doc-id, especialidades, servicios, CIE-10, tipos de paciente.

#### US-3.1 · Catálogo Geográfico (país, depto/estado, municipio, distrito) (Must · 5 SP)

- Pre-cargado SV: 14 departamentos, 44 municipios (post-reforma 2024) + alias 262 legacy.
- Versionado por fecha de vigencia.

#### US-3.2 · Tipos de documento de identidad por país (Must · 3 SP)

- SV: DUI, NIT, NIE, pasaporte, partida de nacimiento.
- Validador de formato + dígito verificador (DUI).

#### US-3.3 · CIE-10 con búsqueda full-text (Must · 8 SP)

```gherkin
Dado un médico buscando "neumonía"
Cuando escribe ≥ 3 caracteres
Entonces ve resultados de CIE-10 ordenados por relevancia
En menos de 200 ms para 14 000 códigos.
```

- Importador de catálogo OMS oficial (XML/JSON).
- Soporta CIE-11 lista para futuro.

#### US-3.4 · Catálogo de Especialidades médicas (Must · 3 SP)

#### US-3.5 · Catálogo de Servicios y Sedes clínicas (Must · 5 SP)

#### US-3.6 · Tipos de paciente, categoría, clase de edad (Must · 3 SP)

#### US-3.7 · Editor sin código de catálogos para administrador clínico (Must · 8 SP)

- Crear, editar, deprecar elementos.
- Vigencia desde/hasta.
- Multi-idioma (es, en mínimo).

#### US-3.8 · Versionado y trazabilidad de cambios en catálogos (Must · 5 SP)

#### US-3.9 · Importador masivo CSV/Excel con validación previa (Should · 5 SP)

#### US-3.10 · Reglas de negocio parametrizables (motor mínimo) (Could · 2 SP)

---

### E4 — MPI: Identificación Única del Paciente (42 SP)

#### US-4.1 · Registrar paciente con datos demográficos completos (Must · 5 SP)

- Nombres, apellidos, FN, sexo biológico, identidad de género, dirección, contactos, alergias, grupo sanguíneo.

#### US-4.2 · Validación DUI con dígito verificador (Must · 3 SP)

```gherkin
Dado el DUI "12345678-9"
Cuando se valida
Entonces el sistema calcula el dígito verificador (módulo)
Y rechaza el documento si no coincide
Mostrando mensaje claro al usuario.
```

#### US-4.3 · Búsqueda de paciente multi-criterio (Must · 5 SP)

- Por DUI/NIT, nombre, fecha nacimiento, teléfono, expediente.
- Resultados en < 300 ms para 1 M de pacientes (índices apropiados).

#### US-4.4 · Detección de duplicados (determinista + probabilística) (Must · 13 SP)

- Determinista: match exacto por DUI/NIT.
- Probabilística: Levenshtein nombres + DOB + sexo, score umbral configurable.
- Worker async genera lista de "posibles duplicados" para revisión manual.

#### US-4.5 · Fusión (merge) de expedientes duplicados con auditoría (Must · 8 SP)

- Solo rol `admin_clinico` o `super_admin`.
- Conserva historial completo y reversibilidad por 30 días.
- Evento `PatientsMerged`.

#### US-4.6 · Registro de paciente NN (desconocido) (Must · 3 SP)

- ID temporal `NN-AAAAMMDD-NNN`.
- Fusionable cuando se identifique.

#### US-4.7 · Vinculación madre-recién nacido (Must · 3 SP)

#### US-4.8 · Captura de alergias con severidad codificada (Must · 2 SP)

---

### E5 — ADT: Admisión, Traslados, Altas, Censo (55 SP)

#### US-5.1 · Pre-admisión electiva (Must · 5 SP)

#### US-5.2 · Admisión (emergencia, programada, traslado, parto, RN) (Must · 8 SP)

- Crea `Encounter` + `HospitalAccount`.
- Asigna pulsera con código de barras / QR.
- Captura consentimientos.

#### US-5.3 · Asignación de cama con disponibilidad realtime (Must · 8 SP)

- Estados: libre, ocupada, sucia, bloqueada, reservada, mantenimiento.
- Validación de aislamiento (cohorte).
- Realtime con Supabase Realtime.

#### US-5.4 · Traslado interno (cambio servicio/cama/nivel) (Must · 5 SP)

```gherkin
Dado un paciente en cama 201 (Medicina Interna)
Cuando enfermería solicita traslado a cama 305 (UCI)
Entonces el sistema valida disponibilidad y aislamiento
Y notifica al servicio receptor
Y actualiza el censo en tiempo real
Y emite Transferred event.
```

#### US-5.5 · Alta médica con epicrisis firmada electrónicamente (Must · 8 SP)

- Tipos de alta: médica, voluntaria, traslado, fuga, fallecimiento, contra opinión médica.
- Cierre de cuenta hospitalaria (en MVP solo marca, facturación detallada en Fase 5).

#### US-5.6 · Tablero de Censo y Ocupación realtime (Must · 8 SP)

- Mapa de camas por sede/servicio.
- KPIs: % ocupación, giro cama, estancia promedio, egresos del día.
- Filtros por servicio, tipo de paciente.

#### US-5.7 · Defunción + certificado médico digital (Must · 5 SP)

- Causas básica/intermedia/directa codificadas CIE-10.
- Cierre de cuenta + manejo de cadáver (registro morgue).
- Notificación a registro civil (stub para futuro).

#### US-5.8 · Impresión de pulseras con barcode/QR (Must · 3 SP)

#### US-5.9 · Captura biométrica opcional (foto, huella) (Should · 3 SP)

#### US-5.10 · Listas operativas (ingresos día, egresos día, traslados, programados) (Must · 2 SP)

---

### E6 — Triage Manchester (47 SP)

#### US-6.1 · Recepción rápida en emergencias (Must · 3 SP)

- Si paciente está en MPI: recuperación inmediata.
- Si no: registro mínimo (nombre, sexo, edad estimada).

#### US-6.2 · Captura de signos vitales + escalas (Glasgow, dolor) (Must · 5 SP)

- TA, FC, FR, SpO₂, temperatura, glicemia capilar, dolor, Glasgow.
- Validación de rangos por edad.

#### US-6.3 · Selección de flujograma de presentación (52 estándar) (Must · 5 SP)

- Catálogo precargado de los 52 flujogramas Manchester oficiales.
- Búsqueda y filtros (cardio, neuro, trauma, gineco, pediátrico).

#### US-6.4 · Aplicación de discriminadores y asignación automática de nivel (Must · 8 SP)

```gherkin
Dado un paciente con flujograma "dolor torácico"
Cuando el triador marca "dolor severo" como discriminador
Entonces el sistema asigna nivel "Naranja" (muy urgente, 10 min)
Y inicia cronómetro
Y emite LevelAssigned event.
```

#### US-6.5 · Sobreescritura del nivel con justificación obligatoria (Must · 3 SP)

- Auditado en `audit_log` y evento `LevelOverridden`.

#### US-6.6 · Cronómetro de tiempo máximo de espera por nivel (Must · 5 SP)

- Alerta visual + push cuando se aproxima al umbral (80%).
- Evento `MaxWaitExceeded` cuando se incumple.

#### US-6.7 · Tablero realtime de emergencia (Must · 8 SP)

- Cola por nivel con cronómetros vivos.
- Asignación a sala/box.
- Visible en pantalla mural.

#### US-6.8 · Re-triage automático y manual (Must · 5 SP)

- Trigger: cambio significativo de signos vitales, expiración de umbral.
- Conserva historial de niveles.

#### US-6.9 · Variantes pediátricas (TEP, FLACC, Wong-Baker) (Must · 3 SP)

#### US-6.10 · Indicadores de triage (puerta-triage, distribución, LWBS) (Should · 2 SP)

---

### E7 — Localización SV (21 SP)

#### US-7.1 · Pack de localización SV activable por organización (Must · 5 SP)

#### US-7.2 · Validador DUI/NIT/NIE con algoritmos oficiales (Must · 3 SP)

#### US-7.3 · Catálogo de feriados oficiales SV (Must · 2 SP)

#### US-7.4 · Códigos MINSAL de establecimientos (Must · 3 SP)

#### US-7.5 · Registro JVPM (médicos) y CSSP (centros) (Must · 5 SP)

- Validación de número de junta vigente al firmar nota.

#### US-7.6 · Soporte i18n base (es-SV; inglés stub) (Should · 3 SP)

---

### E8 — Observabilidad, SRE y Cumplimiento (21 SP)

#### US-8.1 · SLOs definidos (disponibilidad 99.5%, p95 latencia API < 500 ms) (Must · 3 SP)

#### US-8.2 · Dashboard Grafana / Vercel Analytics + Sentry (Must · 5 SP)

#### US-8.3 · Backups + restore probado (Must · 5 SP)

- RPO ≤ 1 h, RTO ≤ 4 h en Fase 1.
- Drill mensual documentado.

#### US-8.4 · Logs centralizados con retención 1 año (auditoría 7 años) (Must · 3 SP)

#### US-8.5 · Política de privacidad y aviso legal SV (Must · 2 SP)

#### US-8.6 · Documento de cumplimiento HIPAA-equiv. + Ley SV (Should · 3 SP)

---

### E9 — Onboarding, Capacitación y Go-Live MVP (13 SP)

#### US-9.1 · Manual de usuario por rol (admisión, triador, médico, admin) (Must · 5 SP)

#### US-9.2 · Plan de capacitación + super-usuarios por servicio (Must · 3 SP)

#### US-9.3 · Datos demo cargados para entrenamiento (Must · 2 SP)

#### US-9.4 · Plan de hipercuidado go-live (2 semanas) (Should · 3 SP)

---

## 5. Definition of Ready (DoR) y Definition of Done (DoD)

### Definition of Ready — antes de entrar al Sprint

Una user story está **Ready** cuando:

- [ ] Tiene formato "Como… quiero… para…" claro y persona identificada.
- [ ] Tiene criterios de aceptación verificables (Gherkin o checklist).
- [ ] Está estimada en story points por el equipo (planning poker).
- [ ] Está priorizada con MoSCoW por el PO.
- [ ] Sus dependencias (otras stories, infra, integraciones, permisos) están identificadas y resueltas o planificadas.
- [ ] Tiene wireframe / mock de UX si introduce UI nueva (@UIUX).
- [ ] No requiere decisiones arquitectónicas pendientes (@AS las firmó).
- [ ] El equipo entiende la story (refinamiento previo).

### Definition of Done — antes de cerrar la story

Una user story está **Done** cuando:

- [ ] Código en `main` mergeado vía PR aprobado por ≥ 1 reviewer.
- [ ] Cobertura de tests unitarios ≥ 80 % en código nuevo.
- [ ] Test de integración / E2E (Playwright) cubre al menos el happy path.
- [ ] Linter, typecheck y formateo verdes.
- [ ] Migraciones Prisma versionadas y aplicadas en dev.
- [ ] Eventos de dominio publicados a outbox cuando aplique.
- [ ] RLS y permisos verificados con caso negativo.
- [ ] Audit log emite registros para acciones sensibles.
- [ ] Documentación actualizada (README del módulo + API docs OpenAPI).
- [ ] Accesibilidad: WCAG AA en componentes UI nuevos (@UIUX revisa).
- [ ] i18n: keys en es-SV; sin strings hard-coded.
- [ ] Demo mostrada al PO en Sprint Review y aceptada.
- [ ] Métricas de producto instrumentadas (analytics) si la story las define.

---

## 6. Roadmap de Sprints del MVP

> 6 sprints de 2 semanas + Sprint 0 de 2 semanas = **14 semanas (~3.5 meses)**.
> Velocidad estimada inicial: **55–70 SP por sprint** (ajustable tras Sprint 1).
> Total backlog: **390 SP**. Margen de buffer ~10 % para imprevistos.

| Sprint | Semanas | Foco | Épicas | Stories clave | SP |
|--------|---------|------|--------|---------------|----|
| **S0** | 1–2 | Cimientos técnicos | E0 | Monorepo, Supabase, CI/CD, schema base, design system | **34** |
| **S1** | 3–4 | Multi-Entidad + AuthN | E1, E2 (parte) | Países, jerarquía, login, MFA, RBAC base | **60** |
| **S2** | 5–6 | Seguridad completa + Catálogos núcleo | E2, E3 | Audit log, ABAC, break-glass, geo, doc-id, CIE-10 | **66** |
| **S3** | 7–8 | MPI + Localización SV | E4, E7 | Registro paciente, validación DUI, dedupe, merge, pack SV | **63** |
| **S4** | 9–10 | ADT (admisión, camas, traslados) | E5 (parte) | Admisión, asignación cama, traslado, censo realtime | **45** |
| **S5** | 11–12 | ADT (altas, defunción) + Triage parte 1 | E5, E6 (parte) | Alta, epicrisis, defunción, recepción triage, signos vitales, flujogramas | **55** |
| **S6** | 13–14 | Triage parte 2 + Observabilidad + Go-live | E6, E8, E9 | Discriminadores, cronómetro, tablero, SLOs, capacitación, hipercuidado | **67** |
| | | | | **TOTAL** | **390** |

### Hitos / Milestones

- **M0 (fin S0):** plataforma desplegable con login dummy.
- **M1 (fin S2):** seguridad y catálogos listos; primer demo a stakeholders.
- **M2 (fin S3):** MPI funcional con dedupe — demo en una clínica piloto.
- **M3 (fin S5):** flujo ADT extremo a extremo en piloto controlado.
- **M4 (fin S6):** **Go-live MVP** en establecimiento piloto + 2 semanas hipercuidado.

---

## 7. Métricas de Producto del MVP

### 7.1 Adopción

| Métrica | Objetivo MVP |
|---------|--------------|
| Usuarios activos diarios (DAU) en piloto | ≥ 80 % del personal de admisión + triage del establecimiento piloto |
| Tasa de retención semanal | ≥ 95 % |
| % admisiones registradas en HIS vs papel | ≥ 90 % a las 4 semanas post go-live |

### 7.2 Calidad / Error rate

| Métrica | Objetivo |
|---------|----------|
| Tasa de duplicados en MPI | < 1 % |
| Errores 5xx (Sentry) | < 0.5 % de requests |
| Tasa de override de triage | < 10 % (mayor sugiere problema de flujogramas) |
| Audit chain integrity | 100 % verificada cada noche |

### 7.3 Satisfacción

| Métrica | Objetivo |
|---------|----------|
| CSAT super-usuarios al final S6 | ≥ 4 / 5 |
| NPS personal asistencial a 30 días post go-live | ≥ +20 |

### 7.4 Eficiencia / Tiempos por flujo

| Flujo | Objetivo MVP |
|-------|--------------|
| Tiempo de admisión (paciente identificado) | ≤ 3 min |
| Tiempo de admisión (paciente nuevo) | ≤ 5 min |
| Tiempo de triage Manchester (signos + flujograma + nivel) | ≤ 5 min |
| Búsqueda de paciente en MPI | < 300 ms |
| Búsqueda CIE-10 | < 200 ms |
| p95 latencia API críticas | < 500 ms |
| Disponibilidad MVP | ≥ 99.5 % |

### 7.5 Negocio (ROI)

- **Ahorro** estimado: reducción de tiempo administrativo por admisión × volumen mensual.
- **Calidad clínica:** reducción esperada de ≥ 30 % en LWBS tras 60 días.
- **Cumplimiento:** 100 % de auditorías regulatorias internas pasadas en MVP.

---

## 8. Trazabilidad TDR ↔ Backlog

| Sección TDR | Épica MVP | Cobertura |
|-------------|-----------|-----------|
| §5 Multi-Entidad | E1 | 100 % |
| §6 Seguridad | E2 | 100 % |
| §7 Catálogos | E3 | Núcleo (geo, doc-id, especialidades, CIE-10, servicios). Resto Fases 2–4. |
| §8 ADT + MPI | E4, E5 | 100 % |
| §9 Triage Manchester | E6 | 100 % |
| §27 Tropicalización SV | E7 | Núcleo SV. DTE/libros IVA en Fase 5. |
| §29 No funcionales | E8 | SLOs + observabilidad + backups |
| §30 Cronograma | E9 | Plan capacitación + hipercuidado |

**Stories totales:** 67 user stories + 7 stories de Sprint 0 = **74 stories**.

---

**Aprobado por:**
- @PO — Chief Product Officer (autor)
- @Orq — Orquestador (delega backlog ya aceptado)
- Pendiente: @AS, @AT, @SRE, @QA confirman factibilidad y estimaciones en planning del Sprint 0.

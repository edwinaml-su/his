# 47 — Matriz de completitud TDR (métrica objetiva, sin UAT)

| Campo | Valor |
|---|---|
| Fecha | 2026-09-28 |
| Autor | @QA + @PO |
| Objetivo | Reemplazar la estimación subjetiva "35–40%" del assessment Code Castle (`docs/44_plan_remediacion_sprints.md` §5) por una métrica reproducible basada en evidencia de repo, no en juicio de experto ni en UAT clínico |
| Fuentes | `TDR_HIS_Multipais.md` (30 módulos, vía la descomposición ya publicada en `docs/03_blueprints_modulos.md`), `docs/31_flujos_operativos_consolidado.md` + `docs/flujos/*.md`, código en `packages/trpc/src/routers/`, `apps/web/src/app/`, tests unitarios (`**/__tests__/*.test.ts`), specs E2E en `apps/web/e2e/` y su resultado en la corrida local `e2e-final` (2026-09-27/28) |

---

## 1. Metodología

### 1.1 Taxonomía de 30 módulos

El TDR (1923 líneas) no enumera sus módulos como una lista plana de 30 — los organiza en 24 secciones numeradas (§5–§28) más 6 sub-bounded-contexts que menciona pero no separa (`docs/03_blueprints_modulos.md` §25, ya usado como referencia de arquitectura en `docs/01_arquitectura_empresarial.md` y `docs/26_trazabilidad_matrix.md`). Se reutiliza esa descomposición porque:
- Ya es la fuente de verdad citada por otros documentos del repo para "30 módulos".
- Evita inventar una segmentación nueva y no reproducible.

### 1.2 Niveles de madurez por módulo (0–4)

| Nivel | Criterio | Verificable con |
|---|---|---|
| **0** | No existe código de producto (ni router tRPC ni página) para el módulo | `find`/`grep` en `packages/trpc/src/routers/` y `apps/web/src/app/` |
| **1** | Código (router y/o página) existe, sin test unitario que lo ejercite | Ausencia de archivo `*.test.ts` con nombre correspondiente |
| **2** | Tiene test(s) unitario(s)/integración (Vitest) que lo cubren, pero sin spec E2E verde, o con spec E2E que no llegó a pasar (todo skip / todo fail / mezcla sin un camino feliz limpio) | `grep` sobre `**/__tests__/*.test.ts` + tabla "POR SPEC" de `e2e-final.json` |
| **3** | Al menos un spec E2E de camino feliz **verde** (0 failed en esa spec, ≥1 passed) para el flujo central del módulo | Columna `passed`/`failed` de `e2e-final.json` por spec |
| **4** | Nivel 3 **y además** un spec E2E negativo / hard-stop verde (DoD Code Castle, `docs/46_gobierno_de_producto.md`) para el mismo módulo | Igual que nivel 3, identificando el spec negativo explícitamente |

`% módulo = nivel / 4 × 100`.

### 1.3 Qué mide y qué NO mide esta matriz

**Mide:** existencia de código, existencia de test automatizado, y si la última corrida E2E local pasó. Es una métrica de **madurez de ingeniería verificable en el repo**, reproducible por cualquiera que corra los mismos comandos.

**NO mide (y no debe citarse como si lo hiciera):**
- **Aceptación clínica** — que un médico/enfermera valide que el flujo es correcto y seguro en uso real. Eso es UAT, no está hecho (`docs/44_plan_remediacion_sprints.md` P2-6, pendiente).
- **Datos reales / volumen de producción** — los fixtures E2E son sintéticos; un módulo en nivel 4 aquí puede fallar con datos reales heterogéneos.
- **Usabilidad** — un flujo puede pasar E2E y ser inutilizable en la práctica (ver hallazgo de `patient-identification.spec.ts` abajo: el E2E prueba el flujo, el flujo real tiene un bug de producto).
- **Cumplimiento regulatorio integral** — NTEC exige firma, inmutabilidad, retención a 10 años; esta matriz no verifica eso módulo por módulo, solo si hay código+test+E2E.

Un nivel alto aquí es **condición necesaria, no suficiente**, para decir que un módulo está listo para producción. La estimación "35-40%" de Code Castle respondía a una pregunta distinta (madurez percibida tras walkthrough funcional) y **no se refuta ni se confirma** con esta matriz — son métricas de naturaleza diferente y no deben promediarse ni compararse directamente.

### 1.4 Snapshot E2E usado (no está en el repo — se transcriben los números aquí)

Corrida local `e2e-final`, 2026-09-27/28, contra Postgres + GoTrue + gateway nginx efímeros (`docker-compose.test.yml`), primera vez que estas specs corrieron contra auth real (antes de esto, `@smoke` llevaba 10/10 runs cancelados por timeout — ver `docs/runbooks/e2e-gotrue-auth.md`). Los archivos de resultado (`e2e-final.json`, `e2e-final.md`, `e2e-baseline.*`) viven en un scratchpad de sesión, no en el repo — por eso se copian los números por spec en la tabla §3 en vez de solo enlazarlos.

**Totales:** 483 tests · 238 passed / 121 failed / 116 skipped(*) / 8 did-not-run.

(*) El JSON de la corrida reporta 124 skipped porque agrupa 8 "did-not-run" dentro de `skipped`; `e2e-final.md` los separa. Se usa aquí el desglose de `e2e-final.md` (116 + 8) porque es el que trae contexto por spec.

Además de esa corrida, una sesión posterior (misma fecha) ejecutó `apps/web/e2e/dod/farmacia-circuito.spec.ts` (tag `@dod`, no incluido en los 483 anteriores) contra el mismo stack: **4 passed / 2 failed**, sin skips condicionales — cubre el DoD de farmacia de `docs/46_gobierno_de_producto.md` §5 (prescribe→firma→farmacia valida lote/stock→dispensa→enfermería identifica→escanea→administra→eMAR→auditoría, con 1 negativo hard-stop).

---

## 2. Hallazgos que afectan más de un módulo (léase antes de la tabla)

1. **`ece-signos-vitales.spec.ts`: 0 passed / 6 failed** y **`ece-historia-clinica.spec.ts`: 0 passed / 4 failed** — el núcleo de HCE (historia clínica + signos vitales) no tiene un solo camino feliz verde en E2E, pese a tener routers y tests unitarios. Esto pesa fuerte en el módulo 10 (HCE) y en el circuito crítico "HCE core" (§4).
2. **Bug bloqueante real en el circuito de farmacia** (documentado en `e2e-final.md` sesión 2, no corregido, reportado a @PO/@Orq para @DBA): `bedside.router.ts` (`runValidate5Correctos`, paso "medicamento correcto") compara el GTIN escaneado contra `ece.indicacion_item.descripcion` (texto libre), nunca contra `drug_id` (que sí existe estructurado). El CPOE real (`modal-medicamento.tsx`) nunca rellena `descripcion` con un GTIN — por tanto **ninguna indicación prescrita por el flujo real puede pasar el paso 3 de BCMA hoy**. Las specs `fase2/bedside-*` que aparecen en verde lo están porque sus fixtures siembran `descripcion = GTIN` directo por SQL, un atajo que ningún flujo de producción produce (confirmado línea por línea contra `seed-e2e-fixtures.mjs`). Esto degrada el nivel real de eMAR/BCMA (módulo 12) y del circuito de farmacia (§4) aunque las specs individuales muestren passed.
3. **RLS multi-tenant con señal mixta**: `ece/ece-rls-cross-tenant.spec.ts` (5 passed/0 failed) da evidencia positiva de aislamiento, pero `fase2/ece-rls-enforcement.spec.ts` (0 passed/3 failed) — spec cuyo propósito explícito es verificar el enforcement de RLS — está en rojo. No se puede afirmar aislamiento multi-tenant verde de forma consistente.
4. **`patient-identification.spec.ts` (MPI, módulo ADT)**: 1 passed/2 failed — el fallo ya no es de infraestructura de test (se corrigió una ambigüedad de locator) sino un **bug de producto evidenciado**: el input queda `readOnly` sin mecanismo de escaneo, documentado en el propio spec.

---

## 3. Matriz por módulo (30 módulos TDR)

| # | Módulo (TDR) | Router(es) tRPC | Página(s) | Tests unitarios | Evidencia E2E (spec: passed/failed/skipped) | Nivel | % |
|---|---|---|---|---|---|---|---|
| 1 | Multi-Entidad: país/organización/moneda/libro contable (§5) | `country`, `currency`, `organization`, `exchange-rate`, `establishment`, `ledger` | `(admin)/countries`, `exchange-rates`, `organizations`, `ledgers` | Sí (`country.router.test.ts`, `currency.router.test.ts`, `establishment.router.test.ts`, `exchange.test.ts`, `organization-fiscal-identity.test.ts`, `org-locale.test.ts`, `ledger.router.test.ts`) | Ninguna spec E2E dedicada | 2 | 50% |
| 2 | Seguridad, Auditoría y Control de Acceso (§6) | `rbac`, `abac`, `audit`, `audit-integrity`, `break-glass`, `mfa`, `user-admin`, `sso-provider-config` | `(admin)/rbac`, `audit`, `users`, `sso-config`, `(auth)/mfa` | Sí, extenso (`rbac-engine.test.ts`, `permission.test.ts`, `abac.router.test.ts`, `rls-context*.test.ts`, `break-glass.router.test.ts`, `mfa.router.test.ts`, `audit-integrity.router.test.ts`, etc.) | `auth.spec.ts` 4/0/0; `audit-dashboard.spec.ts` 7/0/0; `audit-trail.spec.ts` 1/0/0; `pin-lockout.spec.ts` 2/0/2; `scope/nivel-a-sidebar-scope.spec.ts` 3/0/0; `scope/nivel-b-data-scope.spec.ts` 3/0/0; `ece/ece-roles-permisos.spec.ts` 5/0/0. Negativo mixto: `ece/ece-rls-cross-tenant.spec.ts` 5/0/1 (verde) vs `fase2/ece-rls-enforcement.spec.ts` 0/3/0 (rojo, ver §2.3) | 3 | 75% |
| 3 | Catálogos Maestros y Parametrización (§7) | `catalog`, `cie11`, `drug-classifier`, `calculadoras`, `medico-afiliado`, `service-price-list`, `tipo-cuenta` | `(admin)/catalogs`, `catalogs/laboratorio`, `calculadoras`, `finance/price-lists`, `finance/tipos-cuenta` | Sí (`catalog.router.test.ts`, `cie11.router.test.ts`, `drug-classifier.router.test.ts`, `calculadoras.router.test.ts`, `service-price-list.router.test.ts`, `tipo-cuenta.router.test.ts`) | `icd10-cierre.spec.ts` 0/0/6 — **todo skip**, sin evidencia de verde real | 2 | 50% |
| 4 | Admisión, Altas y Traslados + MPI (§8) | `patient`, `patient-identification`, `patient-dedup`, `patient-history`, `encounter`, `encounter-transfer`, `encounter-discharge`, `bed`, `census`, `room`, `ece/bridge-admision`, `ece/episodio-hospitalario`, `ece/orden-ingreso` | `admission`, `beds`, `census`, `encounters`, `patients`, `patient-id`, `ece/admision`, `ece/episodio-hospitalario`, `ece/orden-ingreso`, `deaths` | Sí, extenso | `admission-discharge.spec.ts` 3/0/0 (verde); `bed-map.spec.ts` 2/0/0 (verde); `ece-bridge-admision.spec.ts` 5/0/2 (verde); pero `beds-ece-integration.spec.ts` 1/2/1, `ece-episodio-hospitalario.spec.ts` 4/4 (50% rojo), `ece-hoja-ingreso.spec.ts` 2/6 (75% rojo), `patient-identification.spec.ts` 1/2/4 con **bug de producto real** (§2.4), `patient-mpi.spec.ts` 0/0/5 (todo skip) | 2 | 50% |
| 5 | Triage de Manchester (§9) | `triage`, `triage-dashboard`, `triage-flowchart`, `ece/triaje-ece`, `ece/bridge-triage` | `triage`, `triage-config` | Sí | `triage-manchester.spec.ts` 2/0/0 (verde, camino feliz). Sin spec negativo/hard-stop dedicado localizado | 3 | 75% |
| 6 | Atención Ambulatoria (§10) | `outpatient`, `agenda`, `consultorio`, `turno` | `outpatient`, `historia-clinica-ambulatoria`, `(admin)/agendas`, `consultorios`, `turnos` | Sí (`outpatient.router.test.ts`, `outpatient-agenda-operacion.router.test.ts`, `agenda.router.test.ts`, `consultorio.router.test.ts`, `turno.router.test.ts`, `cita-estimado.test.ts`) | `outpatient/double-booking-prevention.spec.ts` 3/0/0 (verde — incluye el rechazo de doble-booking, pero no se confirmó en detalle si separa camino feliz de negativo en tests distintos) | 3 | 75% |
| 7 | Hospitalización / Atención No Ambulatoria (§11) | `inpatient`, `ece/indicaciones-medicas`, `ece/registro-enfermeria`, `ece/valoracion-inicial-enfermeria`, `ece/signos-vitales` | `inpatient`, `ece/indicaciones`, `ece/registro-enfermeria`, `ece/valoracion-inicial-enfermeria`, `ece/signos-vitales` | Sí, extenso | `ece-indicaciones.spec.ts` 2/3; `ece-registro-enfermeria.spec.ts` 2/3; `ece-valoracion-inicial-enfermeria.spec.ts` 3/3; `ece-signos-vitales.spec.ts` **0/6** (todo rojo); `ece/ece-flujo-hospitalario-completo.spec.ts` 0/0/17 (todo skip) — sin camino feliz limpio en el flujo integral | 2 | 50% |
| 8 | Emergencias (§12) | `emergency`, `ece/atencion-emergencia` | `emergency`, `ece/atencion-emergencia` | Sí (`emergency.router.test.ts`, `atencion-emergencia.router.test.ts`) | `emergency/disposition-state-machine.spec.ts` 3/0/0 (verde); `ece-atencion-emergencia.spec.ts` 2/2 (50% rojo) | 3 | 75% |
| 9 | Salas de Operaciones / Quirófanos (§13) | `surgery`, `ece/acto-quirurgico`, `ece/preop-checklist`, `ece/registro-anestesico`, `ece/urpa-recovery`, `ece/who-checklist` | `surgery`, `ece/quirofano`, `ece/urpa`, `ece/registro-anestesico` | Sí, extenso (incl. `quirofano-conflicto.test.ts`, `quirofano-reserva-cargo.test.ts`, `who-checklist.test.ts`) | `who-checklist.spec.ts` 5/0/0 (verde); `ece-preop-checklist.spec.ts` 4/0/1 (verde); `ece-quirofano-dashboard.spec.ts` 3/1 | 3 | 75% |
| 10 | Historia Clínica Electrónica — HCE (§14) | `ece/historia-clinica`, `evolucion-medica`, `ece/signos-vitales`, `firma-electronica`, `ehr-notes` | `historia-clinica-ambulatoria`, `ece/historia-clinica`, `ece/evolucion`, `ece/signos-vitales` | Sí, extenso | **`ece-historia-clinica.spec.ts` 0/4** (todo rojo); **`ece-signos-vitales.spec.ts` 0/6** (todo rojo); `ece-evolucion.spec.ts` 1/3 (75% rojo) — núcleo de HCE sin camino feliz verde (ver §2.1) | 2 | 50% |
| 11 | Farmacia y Gestión de Medicamentos (§15) | `pharmacy`, `gs1-medication`, `gs1-lote-trace`, `farmacovigilancia` | `pharmacy`, `gs1/medicamentos`, `gs1/lote`, `farmacovigilancia` | Sí, extenso | `dod/farmacia-circuito.spec.ts` 4/2 — prescribir+firmar y validar/dispensar lote-stock **verdes**, incluido 1 hard-stop real (stock=0) **verde**; pero el circuito completo se bloquea en BCMA (§2.2, bug real no corregido). `fase2/pharmacy-cart.spec.ts` 3/2; `fase2/pharmacy-picking.spec.ts` 3/1; `gs1-lot-trace.spec.ts` 1/5 (mayormente rojo); `gs1-catalogos.spec.ts` 11/4 | 2 | 50% |
| 12 | Administración de Medicamentos — eMAR (§16) | `medication-admin`, `bedside`, `medication-window` | `emar`, `bedside`, `bedside/ronda` | Sí, extenso | Specs individuales en verde (`fase2/bedside-flow.spec.ts` 9/0; `fase2/bedside-window-alert.spec.ts` 9/0; `bedside-ronda.spec.ts` 3/0; `bedside-stat.spec.ts` 6/0) **pero** el hallazgo de `dod/farmacia-circuito.spec.ts` (§2.2) demuestra que ese verde depende de un atajo de fixture (`descripcion = GTIN`) que ningún flujo real produce — el paso 3 de BCMA (medicamento correcto) fallaría al 100% contra datos reales del CPOE. Se degrada el nivel por esa evidencia, pese a los passed nominales | 2 | 50% |
| 13 | Laboratorio Clínico — LIS (§17) | `lis` | `lis`, `lis/orders`, `lis/results` | Sí (`lis.router.test.ts`) | Sin evidencia E2E — ninguna spec localizada | 2 | 50% |
| 14 | Imágenes Diagnósticas — RIS/PACS (§18) | `imaging`, `imaging-request` | `imaging`, `imaging/new` | Sí (`imaging.router.test.ts`, `imaging-request.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 15 | Insumos y Almacén Hospitalario (§19) | `inventory` | `inventory`, `inventory/alertas`, `inventory/new` | Sí (`inventory.router.test.ts`) | `inventory/fefo-pick.spec.ts` 3/0/0 (verde, incluye lógica FEFO) | 3 | 75% |
| 16 | Servicios Hospitalarios, Usos y Equipos (§20) | `services-equipment`, `room` | `equipment`, `equipment/[id]`, `equipment/new` | Sí (`services-equipment.router.test.ts`, `room.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 17 | Terapia Respiratoria (§21) | `respiratory` | `respiratory`, `respiratory/new` | Sí (`respiratory.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 18 | Nutrición y Alimentación (§22) | `nutrition` | `nutrition`, `nutrition/new` | Sí (`nutrition.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 19 | Cuentas Hospitalarias y Facturación (§23) | `patient-account`, `invoice`, `account-receivable`, `conciliacion-cargos` | `finance/invoices`, `finance/cuentas-por-cobrar`, `finance/conciliacion` | Sí (`patient-account.router.test.ts`, `invoice.router.test.ts`, `account-receivable.router.test.ts`, `conciliacion-cargos.router.test.ts`, `charge-capture.test.ts`) | `cargos-rn-bot-001.spec.ts` 4/4 (50% rojo) — sin camino feliz limpio | 2 | 50% |
| 20 | Contabilidad y Finanzas Multi-Libro (§24) | `accounting`, `ledger` | `ledgers`, `ledgers/[id]` (accounting sin página propia identificada — posible gap de UI, no verificado a fondo) | Sí (`accounting.test.ts`, `ledger.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 21 | Convenios y Aseguradoras (§25) | `insurance`, `insurance-out-of-network` | `insurance`, `insurance/plans`, `insurance/polizas`, `insurance/formularios` | Sí (`insurance.router.test.ts`, `insurance-out-of-network.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 22 | Reportería e Inteligencia de Negocios (§26) | `finance-reports`, `finance-overview`, `audit-outlier`, `chat-analytics` | `(admin)/analytics`, `finance/reportes` | **Parcial** — solo `MetabaseEmbed.test.tsx` (componente UI); `finance-reports.router.ts` y `finance-overview.router.ts` sin test unitario localizado; `packages/bi` (dbt/cube) sin tests | Sin evidencia E2E | 1 | 25% |
| 23 | Tropicalización para El Salvador (§27) | Validadores `validateDUI`/`validateNIT`/`validateNIE` (`packages/contracts`), `locale` | `(admin)/sv-localization`, `sv-localization/holidays` | Sí (`packages/contracts/src/validators/__tests__/*`, `locale.router.test.ts`, `org-locale.test.ts`) | Sin spec E2E dedicada (el uso de DUI en `patient-identification.spec.ts` está en rojo, ver §2.4, pero es un módulo distinto — ADT) | 2 | 50% |
| 24 | Integraciones e Interoperabilidad (§28) | Ninguno localizado (sin router de bus/HL7/FHIR/Mirth) | Ninguna | No aplica | No aplica | 0 | 0% |
| 25.1 | Banco de Sangre (sub-BC LIS, §17.7) | `blood-bank` | Sin página dedicada localizada | Sí (`blood-bank.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 25.2 | Anatomía Patológica (sub-BC LIS) | `pathology` | `pathology` | Sí (`pathology.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 25.3 | Esterilización CEYE (sub-BC surgery, §13.7) | Ninguno localizado | Ninguna | No aplica | No aplica | 0 | 0% |
| 25.4 | Vacunación PAI (sub-BC HCE, §14.5) | `vaccination` | `patients/[id]/vaccinations`, `(portal)/portal/vacunacion` | Sí (`vaccination.router.test.ts`) | Sin evidencia E2E | 2 | 50% |
| 25.5 | Notificación de Defunción y Nacimiento (sub-BC ADT, §8.7/§11.6) | `death-certificate`, `newborn`, `ece/certificado-defuncion`, `ece/atencion-rn` | `deaths`, `ece/defuncion`, `ece/atencion-rn` | Sí, extenso | `deaths-ece-integration.spec.ts` 8/3 (73% verde); `ece-defuncion.spec.ts` 7/2 (78% verde) — mayoría de casos verdes, sin negativo hard-stop dedicado confirmado | 3 | 75% |
| 25.6 | Portal del Paciente (extensión, §3.4) | `portal`, `portal-arco`, `portal-hce` | `(portal)/portal` | Sí (`portal.router.test.ts`, `portal-arco.router.test.ts`, `portal-hce.router.test.ts`) | `portal-arco.spec.ts` 4/0/4 (verde en lo ejecutado, 4 casos skip sin ejercitar) | 3 | 75% |

**Suma de niveles: 63 / 120 posibles → promedio global = 52.5%**

Distribución de niveles (30 módulos):

| Nivel | Significado | # módulos | % de módulos |
|---|---|---|---|
| 0 | No existe | 2 (Integraciones/Interop, CEYE) | 6.7% |
| 1 | Código sin test | 1 (Reportería/BI) | 3.3% |
| 2 | Unit tests, sin E2E verde confiable | 19 | 63.3% |
| 3 | E2E feliz verde | 8 | 26.7% |
| 4 | E2E feliz + negativo hard-stop verde | 0 | 0% |

---

## 4. Circuitos críticos (evaluados aparte)

`docs/31_flujos_operativos_consolidado.md` y `docs/46_gobierno_de_producto.md` §5 identifican procesos donde una falla afecta directamente la seguridad del paciente o la integridad del expediente. Se evalúan aparte porque promediarlos con los 30 módulos (muchos de ellos sin E2E por no ser aún prioridad, p. ej. terapia respiratoria) diluiría la señal que más importa para un Go/No-Go clínico.

| Circuito crítico | Evidencia | Nivel | % |
|---|---|---|---|
| Triaje Manchester | `triage-manchester.spec.ts` 2/0/0 verde; sin negativo dedicado | 3 | 75% |
| Admisión–Alta + identificación de paciente (MPI) | `admission-discharge.spec.ts` verde, pero `patient-identification.spec.ts` con bug de producto real (§2.4) y `patient-mpi.spec.ts` 100% skip | 2 | 50% |
| Farmacia end-to-end (prescribe→firma→valida→dispensa→BCMA→eMAR→auditoría) | `dod/farmacia-circuito.spec.ts` 4/2 — prescripción/firma/dispensación/hard-stop de stock verdes; **bloqueado en BCMA por bug real** (§2.2), eMAR nunca refleja la administración | 2 | 50% |
| Quirúrgico (checklist OMS + preoperatorio) | `who-checklist.spec.ts` 5/0/0 verde; `ece-preop-checklist.spec.ts` 4/0/1 verde | 3 | 75% |
| Obstétrico (parto/periodo expulsivo/RN) | `ece-periodo-expulsivo.spec.ts` 1/1/3 (mixto); `ece-maternidad-dashboard.spec.ts` 1/6 (mayormente rojo); flujo integral `ece/ece-flujo-obstetrico-completo.spec.ts` 0/0/9 (todo skip) | 2 | 50% |
| Defunción / notificación | `deaths-ece-integration.spec.ts` 8/3 verde mayoritario; `ece-defuncion.spec.ts` 7/2 verde mayoritario | 3 | 75% |
| Aislamiento multi-tenant (RLS) | `ece/ece-rls-cross-tenant.spec.ts` 5/0/1 verde vs `fase2/ece-rls-enforcement.spec.ts` 0/3/0 rojo — señal contradictoria (§2.3) | 2 | 50% |
| HCE core (historia clínica + evolución + signos vitales) | `ece-historia-clinica.spec.ts` 0/4 rojo total; `ece-signos-vitales.spec.ts` 0/6 rojo total; `ece-evolucion.spec.ts` 1/3 | 2 | 50% |

**Suma: 19 / 32 posibles → promedio circuitos críticos = 59.4%**

Ningún circuito crítico alcanza nivel 4 (E2E feliz + negativo hard-stop, ambos verdes, sin bloqueos aguas abajo). El único con un negativo hard-stop real y verde documentado es farmacia (stock=0 en `dod/farmacia-circuito.spec.ts`), pero el circuito completo no cierra por el bug de BCMA — por eso se mantiene en nivel 2, no 3 ni 4, pese a tener el negativo más riguroso de toda la matriz.

---

## 5. Resumen ejecutivo (números a citar)

- **% global (30 módulos TDR):** 52.5% (63/120)
- **% circuitos críticos (8 circuitos):** 59.4% (19/32)
- **Distribución global:** 2 módulos en nivel 0, 1 en nivel 1, 19 en nivel 2, 8 en nivel 3, 0 en nivel 4
- **Ningún módulo ni circuito crítico alcanza el nivel 4 completo** (DoD Code Castle: feliz + negativo hard-stop verdes sin bloqueos posteriores)
- Esta cifra **no confirma ni refuta** el "35–40%" de Code Castle — mide otra cosa (madurez de ingeniería verificable en repo, no aceptación clínica) y las dos no deben promediarse ni citarse como equivalentes.
- Pendiente de acción, no de medición: `docs/plan/PLAN-REMEDIACION-2026-09.md` y `docs/audit/2026-09-15_cobertura/` (fuera del alcance de este documento).

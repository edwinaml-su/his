# Plan de remediación de pendientes — 2026-09-19

**Solicitado por:** Edwin Martinez. **Elaborado por:** @Orq (consolidando las auditorías del 2026-09-15 —cobertura—, 2026-09-18 —cableado UI→BD y drift— y 2026-09-18 —multi-tenant/país/moneda/libro—).

## Principio rector: la carga de datos es una fase, no un obstáculo del desarrollo

Aclaración de Edwin (2026-09-19): **la carga/migración de datos SÍ se hará — en su momento, cuando todo esté funcional, para habilitar las pruebas de UAT.** Es decir: la carga es la puerta de entrada al UAT, no un requisito intercalado en el desarrollo. El plan lo honra así:

1. **Durante el desarrollo, ningún ítem espera datos**: toda funcionalidad opera con defaults sensatos mientras su parametrización no está cargada (precedentes: SLA por defecto en `lab-sla.ts`, cargo `PENDIENTE_TARIFA` en vez de $0, rol `RESP_THERAPIST` inerte) — así las olas R1–R4 avanzan completas sin bloquearse entre sí ni esperar la carga.
2. **Migraciones de schema autocontenidas**: todo SQL numerado incluye su propio backfill idempotente; ninguno depende de una carga externa previa.
3. **La Fase de Carga pre-UAT (abajo) tiene checklist propio**: cuando el desarrollo esté funcional, se ejecuta la carga completa de una vez, con inventario cerrado — y ahí sí es requisito: **sin carga no hay UAT**.
4. **Sync automático donde reduzca la carga manual**: R1.1 (`ece.personal_salud` desde `User`+roles) no sustituye la fase de carga — la achica y evita que ese catálogo se desactualice después del go-live.

## En vuelo ahora (no forman parte del plan, son contexto)

| Ítem | Estado |
|---|---|
| PR #691 CC-0042 terapia respiratoria (S1) | CI verde — espera UAT Edwin |
| PR #692 remediación P0 cableado (SV historial + IPSG-2 UI) | CI verde — espera review Edwin |
| PR #693 CC-B (7 routers ece sin BYPASSRLS + roles corporativos, SQL 256 aplicado) | CI en curso |
| CC-A multipaís/moneda (tasa real, DPI, IVA por país, formatCurrency) | correcciones de revisión en curso; SQL 255 pendiente de aplicar |

## Ola R1 — Seguridad y activación de circuitos (sin dependencia de datos)

| # | Ítem | Diseño anti-bloqueo | Esfuerzo |
|---|---|---|---|
| R1.1 | **Sync automático `ece.personal_salud` ← `User`+roles** (cierra R03). Trigger o job idempotente que materializa el perfil ECE de todo usuario clínico con `his_user_id` poblado. **Sigue pendiente — es el bloqueador de fondo.** `ece.personal_salud` tiene 0 filas en prod hoy; R03 (abajo) cerró la capa de LECTURA (`identity-resolver.ts`) que consumirá ese catálogo en cuanto exista, pero sin esta sincronización todo sigue inerte (IPSG-2, cola de certificación, firmas ECE, LabReferenceRange de P1-13). | Convierte el data-blocker en código: activa de una vez IPSG-2 (emisión LIS de valores críticos), re-migración RLS de `certificacion.listCola`, y el pareo firma/asignaciones ECE. | M |
| R1.2 | **~11 routers ece "mixtos" → `withEceContext`** (los 7 puros cerraron en CC-B). Avance 2026-09-28 (R02 residual, ver abajo): `epcis-query.router.ts` migrado a `withTenantContext` (gap de IDOR cross-org cerrado); `portal.router.ts` (mfa enable/verify, logout) a `withPortalContext`. | Solo código; el patrón y las trampas (AuditLog, policies) ya están documentados por CC-B. | M |
| R1.3 | **Barrido `where:{id}` sin org en routers legacy** — patrón del gap confirmado en `patient.update` (se cierra en CC-A); auditar los demás procedures de patient y los routers hermanos de la misma época. | Solo código + tests. | M |
| R1.4 | **SSO-config real o retiro**: hoy guarda a localStorage y el login lee mocks de env. Decisión binaria: tabla parametrizable por org, o retirar la página y dejar la config en env documentada. | Solo código. **Decisión Edwin requerida.** | S–M |
| R1.5 | **Capa BI sql/48-49 a prod** (rol `bi_reader` no existe). | Son roles/grants — no toca datos. | S |

## Ola R2 — Multipaís restante (todo con fallback SV)

| # | Ítem | Diseño anti-bloqueo | Esfuerzo |
|---|---|---|---|
| R2.1 | **TZ/locale por organización**: helper central que resuelve `Country.defaultTzId`/`defaultLocale` de la org (ya modelados y sembrados) con fallback `America/El_Salvador`/`es-SV`. Barrido primero en trpc (`abac/atributos`, `turno` UTC-6, `audit-outlier`, `imaging-request`), luego web por módulos (294 ocurrencias — en olas, no big-bang). | Fallback = comportamiento actual exacto; ningún dato nuevo requerido. | L (por olas) |
| R2.2 | **`locale.currentLocale` lee `Country` real** (hoy retorna SV/USD estático). | Fallback SV si org sin país. | S |
| R2.3 | **`PatientAccountService.currencyId` explícito** (hoy implícito por lista): columna nullable + escritura en `capturarCargo` + backfill en el propio SQL desde la lista de precios. | Nullable + backfill autocontenido ⇒ cero dependencia de carga. | S |
| R2.4 | **Feed de tasas** (BCR stub / Banguat TODO): se mantiene **manual** vía `/admin/exchange-rates` — CC-A ya hace que el runtime exija tasa vigente (fail-closed). El feed automático es mejora, no bloqueo. | La UI manual ya existe. | Diferible |

## Ola R3 — Drift de páginas y deuda de producto

| # | Ítem | Nota | Esfuerzo |
|---|---|---|---|
| R3.1 | Consolidar `/ece/rectificacion` → `/ece/rectificaciones` (redirect, precedente /ece/triaje). | Solo código. | S |
| R3.2 | `/historia-clinica-ambulatoria`: sidebar + quitar casts `(trpc as any)` stale (router ya mergeado). | Solo código. | S |
| R3.3 | Huérfanas cableadas sin entrada (`/pathology`, `/audit-dashboard`, `/ece/comite`, `/ece/calidad-documental`, `/ece/registro-retroactivo`): dar entrada en sidebar o retirar. | **Decisión @PO/Edwin por página.** | S |
| R3.4 | Portal paciente: dashboard real (las secciones citas/recetas/resultados ya existen). | Solo código. | M |
| R3.5 | `Drug.srs*` al schema.prisma (declarar 20 columnas que YA existen en prod — es sincronizar el modelo, no migrar data). | Cero DDL. | S |
| R3.6 | Enum/SQL de reconstrucción: barrido de scripts sql/ legacy cuya definición difiere de prod (patrón sql/89 CONFIRMED) — solo cabeceras/notas, sin tocar prod. | Documental. | S |

## Derivados de la ejecución de R1 (hallazgos de las revisiones, para CC/olas posteriores)

| # | Hallazgo | Origen | Destino |
|---|---|---|---|
| D1 | `FK_REASSIGN_TABLES` de `mergePatients` cubre 9 de ~38 relaciones a `Patient` (PatientAccount, RespiratoryOrder, ImagingRequest, CareTask, Invoice, Prescription, ece.*… quedan fuera) — el historial del paciente perdedor queda huérfano apuntando al soft-deleted. Preexistente; además hay un SEGUNDO motor de merge (`patient-dedup.router.ts` ECE) con su propia lista. | Revisión R1C | **CC propio: merge de pacientes completo** (unificar motores + lista generada desde schema) |
| D2 | `patient-dedup.router.ts:519` (ECE): `auditLog.create` dentro de contexto demotado — mismo bug latente que el P0 corregido en R1C (permission denied en prod). | Revisión R1C | R1.3 bis (fix quirúrgico patrón death-certificate R02) |
| D3 | Default privileges de `public` otorgan DML completo a `anon` en TODA tabla nueva (contradice SQL 152); mitigado por RLS pero sistémico. SQL 261 barre las 3 SLA configs + SsoProviderConfig; la raíz (`ALTER DEFAULT PRIVILEGES`) merece SQL propio con revisión de impacto. **sql/267 ya diseñado, probado (solo lectura contra prod) y documentado — ⚠️ NO APLICADO, pendiente de aprobación explícita de Edwin.** Riesgos residuales que sql/267 deja fuera de alcance a propósito y que quedan como seguimiento explícito para @SRE/@Orq: (1) el segundo default ACL de `public` es propiedad de `supabase_admin`, no de `postgres` — `postgres` no es superusuario ni miembro de `supabase_admin`, así que no puede revocarlo (§2 de sql/267); (2) el default ACL de `public` también da a `anon` privilegios por defecto sobre SEQUENCES y FUNCTIONS, y hay 5 funciones SECURITY DEFINER en `public` hoy ejecutables por `anon` (`current_org_id_or_ece_context`, `fn_cita_no_show`, `fn_medico_de_turno`, `fn_next_contrato_arrendamiento`, `fn_next_liquidacion`) — sql/267 solo cubre tablas. | Revisión R1C + revisión 2026-09-28 | SQL de hardening en R4 (sql/267, pendiente de aplicar); riesgos residuales (1) y (2) a triage de @SRE/@Orq |
| D4 | `personal-salud.router.ts` usa columna inexistente `jvpm_o_jvp`; `/profesionales-salud` no permite editar `documentoIdentidad` (necesario para corregir centinelas `PENDIENTE-DUI-*` del sync R1.1). | @Dev R1A (chips ya creados) | Fixes cortos R3 |
| D5 | Keyset de `certificacion.listCola` inconsistente con su ORDER BY (paginación puede saltar/duplicar). Preexistente. | Revisión R1A | **CERRADO 2026-09-28** — `certificacion.router.ts` ahora desempata `(sortColumn, id)` coherente con el ORDER BY (`creado_en`/`actualizado_en` según modo) y valida `cursor` inválido/no-visible con `BAD_REQUEST` en vez de cortar la página en silencio. Efecto colateral corregido en la misma revisión: `ultimoCambioEn` pasó de reflejar `creado_en` (fecha errónea para el semáforo DIR) a `COALESCE(dih.ejecutado_en, di.creado_en)` (última validación real). Tests en `ece-certificacion.router.test.ts` (18/18 verdes). |
| P1-13/B29 | Flag automático de valor crítico de laboratorio (`result.enter`, `lis.router.ts`) ignoraba `LabReferenceRange` (estratificado edad/sexo) y usaba heurística ±50% sobre `LabTest.refRangeLow/High` (`docs/audit/2026-09-15_cobertura/02-hc-farmacia-lab-imagen.md` B29). | Auditoría cobertura 2026-09-15 | **CERRADO a nivel de código 2026-09-28, INERTE en prod.** `result.enter` ahora consulta `LabReferenceRange` (filtro edad-a-la-fecha-de-ingreso + sexo, ranking sexo-específico+bracket > un solo eje > BOTH/sin edad) y solo prefiere una fila estratificada si aplica al paciente; sin fila aplicable conserva el fallback Wave 1 exacto. Corrección de revisión: el payload de `lab.criticalValue`/`critical_result_notification` ya no mezcla `low` de `LabTest` con `high` de la fila estratificada cuando ésta es un rango abierto (`minValue`/`maxValue` null). **`LabReferenceRange` tiene 0 filas en prod hoy** (verificado solo-lectura, `ejacvsgbewcerxtjtwto`) — la lógica queda construida y probada pero sin efecto real hasta que se cargue el catálogo (edad de cálculo usa "al ingresar el resultado", no "a la toma de muestra" — deuda documentada en el código, no resuelta). Decisión pendiente de @DrHIS/@PO: qué tests priorizar y de qué fuente (LOINC/guías locales). |

## R02 residual (18 routers sin contexto RLS) — cerrado 2026-09-28

Auditoría externa había señalado 18 routers tRPC leyendo/escribiendo sin `withTenantContext`/`withPortalContext`/`withEceContext`. Verificado uno por uno contra RLS/policies reales en prod (solo lectura, `ejacvsgbewcerxtjtwto`) antes de decidir:

- **Migrados a contexto real:** `epcis-query.router.ts` (4 queries `ece.epcis_event_equipment` — antes BYPASSRLS sin filtro de org, un DIR/ARCH/ADMIN de una org podía leer trazabilidad de equipos de OTRA org) y `portal.router.ts` (mfa enable/verify, logout — a `withPortalContext`; las RPC a Supabase Vault quedan fuera del contexto a propósito, `authenticated` no tiene EXECUTE sobre ellas).
- **Privilegio mantenido con justificación documentada** (11 routers): `audit-integrity` (rompería la verificación de cadena completa), catálogos globales sin policy de escritura para `authenticated` (`country`/`currency`/`exchange-rate`/`locale`/`drug-classifier`/los 7 `workflow-*.router.ts`), y en `portal.router.ts` los procedures pre-sesión (register/verifyEmail/requestLogin/verifyLogin) y `guardian.list`.
- **Hallazgo de proceso:** `ece/critical-result.router.ts` ya usaba `applyTenantContext` (la primitiva de bajo nivel) en sus 4 procedures — un grep literal lo había marcado como "sin contexto" por error. **Precisión post-revisión:** de esas 4, solo `pending` demota realmente a `authenticated`; `emit`/`confirmReadback`/`escalate` corren con `demoteRole:false` (deliberado — `audit."AuditLog"` no tiene policy de INSERT para `authenticated`) — queda como **residual abierto**, no como "ya cumple", hasta que exista el GRANT+policy correspondiente.
- **Gap latente sin cerrar, documentado en `packages/database/sql/268_r02_policies_routers_residuales.sql` (NO aplicado):** `expedienteRouter.getMiExpediente`/`hce.labResults.get` ya usan `withPortalContext` en prod y leen `"Patient"`, pero esa tabla solo tiene policy por `organizationId = current_org_id()` (GUC que el portal no setea) — nunca verificado contra RLS realmente forzado; podría devolver 0 filas en silencio. Requiere policy nueva de SELECT (propio paciente + ward bajo tutela activa) — decisión de @SRE/@Orq antes de aplicar.
- Detalle completo (router → tablas → tenant/global → decisión → razón) en `docs/12_rls_validation.md` §9.

## R03 (identity-resolver: `his_user_id` → `ece.personal_salud`) — capa de lectura cerrada, dato de fondo sigue en R1.1

Cierra el residual de que cada router ECE reimplementaba su propio `SELECT id FROM ece.personal_salud WHERE his_user_id = $1` (algunos sin filtrar `activo`, algunos sin manejar el caso 0-filas de forma consistente). Dos etapas, ambas completadas 2026-09-28:

- **Stage 1 + 2:** 39 routers migrados a `resolvePersonalSalud`/`requirePersonalSalud` (`packages/trpc/src/lib/identity-resolver.ts`). Nuevo test de arquitectura (`identity-resolver-arch.test.ts`) escanea el código y falla si aparece un `his_user_id` fuera de una allowlist explícita — quedan 3 entradas justificadas: `critical-result.router.ts` (filtro de reporte opcional, no lookup de identidad), `firma-electronica.router.ts` (dirección inversa en `requestRecovery`/`completeRecovery`, publicProcedure pre-sesión que el resolver no cubre) y `personal-salud.router.ts` + su componente web (lado de ESCRITURA/alta del vínculo — cambio de producto, fuera de alcance de un refactor mecánico de lectura).
- **Hallazgo de revisión corregido:** `firma-electronica.router.ts#history` (bitácora de auditoría de firmas) había pasado a filtrar `activo=true` igual que el resto — pero para consultas de auditoría eso escondía el historial de personal YA DADO DE BAJA. Se agregó `resolvePersonalSalud(..., { includeInactive: true })` para ese caso puntual.
- **El bloqueador de fondo no se tocó a propósito:** `ece.personal_salud` tiene 0 filas en prod. Todo lo migrado queda correcto pero inerte hasta que R1.1 (sync automático) o una carga manual pueble esa tabla — ver R1.1 arriba.

## Roles operacionales (RBAC) — 7 routers sin `requireRole` cerrados 2026-09-28

`encounter`/`triage*`/`surgery`/`encounter-discharge`/`encounter-transfer`/`inpatient` corrían con `tenantProcedure` puro (0 control de rol); `bed`/`patient` solo gateaban 2 procedures. Nuevo `packages/trpc/src/rbac/operational-role-sets.ts` centraliza sets de rol por operación (lectura de PHI, escritura clínica, admisión, egreso, cirugía, apertura/gestión de cuentas, MDM de paciente), verificados 1:1 contra el catálogo real de roles en prod (28 códigos, incluidas las 21 orgs multi-org — precedente CC-0044: gatear solo con roles de la org piloto deja 20/21 orgs bloqueadas).

Hallazgo de revisión corregido: `PATIENTS_WORKLIST_READ_ROLES` (usado por `patientAccount.listarWorklist` — worklist de cobro CC-0008 — y por `patient.search/get/findByDocument/contextoCuenta`, base de `SelectorCuenta` y de la ficha `/patients/[id]`) no incluía `FACTURACION`/`GERENTE_FINANCIERO`, aunque esos roles ya son escritores de cuentas — facturación quedaba bloqueada en pantallas que ya usaba. Corregido antes de este merge.

**Deuda de catálogo, no de código (no resuelta a propósito):** `writerProc`/`facturacionDualProc`/`regularizar` en `patient-account.router.ts` y `actualizarContactoEmergencia` en `patient.router.ts` usan códigos de rol que **no existen** en el catálogo real de prod (`ACCOUNTANT`, `BILLING`, `MC`, `MT`) — ya tenían `requireRole` (fuera del alcance "solo procedures sin control de rol" de este workstream), pero en la práctica son ADMIN-only en 3 de 24 orgs. Igual `bed.router.ts` `adminProc=['ADMIN','DIR']`. Candidatos a un CC corto de "limpieza de códigos de rol muertos".

**Gap de catálogo confirmado, no resuelto (no es un bug de código):** no existe un código de rol de ENFERMERÍA en las 21 organizaciones multi-org — solo equivalente médico (`MEDICO_AFILIADO`/`JEFE_MEDICO_SEDE`). Triage/registro de enfermería en esas orgs hoy solo lo puede ejecutar un médico o `ADMIN_CLINICO`/`SUPER_ADMIN`. Requiere sembrar un rol de enfermería multi-org o mapear vía `RoleCodeAlias` — decisión de @PO/@DBA, no de código.

## Integración de workstreams 2026-09-28 (D3/D5/P1-13/R02/R03/roles)

Los 7 workstreams de arriba (D3, D5, P1-13/B29, R02 residual, R03, roles operacionales, más el spec DoD de farmacia de W1) se mergearon `--no-ff` en secuencia sobre un mismo árbol, sin conflictos reales (2 auto-merges limpios en `certificacion.router.ts`/`lis.router.ts`). Gate completo verde: `npm run -w @his/database generate`, `npm run typecheck` (7/7 workspaces), `npm run lint` (7/7, 0 errores), `npx turbo run test -- --coverage` (6/6 workspaces con tests, ~7000 tests, 0 fallos, sin romper thresholds). Regresión E2E parcial (22% del inventario, módulos de mayor riesgo — ver R4.4/§7 del runbook): 0 regresiones nuevas detectadas. Detalle completo en `docs/runbooks/e2e-gotrue-auth.md` §7.

## Ola R4 — Calidad e infraestructura

| # | Ítem | Diseño anti-bloqueo | Esfuerzo |
|---|---|---|---|
| R4.1 | **k6 contra stack efímero** (el mismo docker-compose de E2E con seed sintético determinista) — NO exige clonar datos de prod. Objetivo: validar el techo estimado de 40–80 usuarios concurrentes y medir la contención del audit hash chain bajo escritura concurrente. | Seed sintético ⇒ sin dependencia de data real. | M |
| R4.2 | Fijar región de Vercel junto a Supabase us-west-2 (1 línea en vercel.json). | Config. | XS |
| R4.3 | `packages/ui`: script `test` + verificación de que sus tests corren en CI; revisar `include` estrechos de vitest. | Solo config. | S |
| R4.4 | Triage de la suite E2E nightly (fallos conocidos acumulados) — por lotes, aprovechando el stack GoTrue ya verde en @smoke. | Sin data real: usa el seeder determinista. | M |
| R4.5 | MFA staff: **encender la política** (mecanismo ya cableado en layouts). | Config + UAT. **Decisión Edwin.** | S |

## Fase de Carga de datos — pre-UAT (se ejecuta cuando el desarrollo esté funcional)

No es prerrequisito de las olas R1–R4 (esas avanzan con fallbacks), pero **sí es prerrequisito del UAT**: cuando el desarrollo esté funcional, esta carga se ejecuta completa y habilita las pruebas. Inventario cerrado a hoy:

| Dato | Habilita | Fuente |
|---|---|---|
| `ece.personal_salud` (perfil ECE del personal clínico con `his_user_id`) | IPSG-2 valores críticos, cola de certificación con RLS, firmas/asignaciones ECE | Sync R1.1 (automático) o carga manual |
| Tasas de cambio (`ExchangeRate`) | Multimoneda real (hasta entonces USD funcional, fail-closed) | `/admin/exchange-rates` |
| SLA de lab/imágenes/TR (`*SlaConfig`) | SLAs institucionales en vez de defaults de código | Paneles de configuración ya entregados |
| GLN/precios pendientes (Code Castle) + listas de precios de países futuros | Trazabilidad GS1 completa y tarifarios | Importadores existentes / Odoo |
| Países/geo/feriados adicionales | Direcciones, agenda y feriados de orgs extranjeras (GT queda sembrado por SQL 255) | CRUD `/admin/countries` |
| Membresías de roles (CONTRALOR_CORP, DIR_PAIS, SUPER_ADMIN cross-org, 12+ roles CC-0036) | Visión corporativa/país y operación por rol | Asignación manual de Edwin |
| Usuarios/pacientes/inventarios reales del complejo | El UAT en sí | Migración desde sistemas actuales + Odoo |

**Gate:** checklist completo ⇒ arranca UAT formal (#687–#694 + olas mergeadas).

## CC propio derivado — Multi-libro operativo (motor de asientos en el HIS)

Aclaración de Edwin (2026-09-19): **el HIS SÍ necesita registrar las transacciones en multi-libro**; la diferencia es que esa información se **interfacea con el ERP** (hub de eventos) — el ERP recibe, no sustituye el registro. Esto reemplaza la exclusión anterior ("la contabilidad va al ERP"). Por su tamaño se planifica como CC propio, secuenciado después de R1 (puede correr en paralelo a R2–R4):

1. **Plan de cuentas y períodos por libro**: poblar `Account` por `Ledger` (IFRS + FISCAL por org; el modelo y el CRUD ya existen, hoy con 0 cuentas) + `AccountingPeriod` con apertura/cierre.
2. **Tabla de mapeo contable `origen → cuenta por libro`**: cierra el GAP documentado (ReglaHonorario.`cuentaContableCodigo` sin `ledgerId`; resumen por rubro con cuenta null para orígenes no-honorario). Parametrizable por org/libro desde `/admin/ledgers`.
3. **Motor de posting automático**: los eventos operativos que ya existen (cargos `PatientAccountService`, facturas/pagos, devengo de arrendamiento, liquidación de honorarios, cierre de cuenta) generan asientos de partida doble en **cada libro activo** de la org (el trigger de partida doble de sql/47 ya valida el balance). Fail-safe: sin mapeo de cuenta ⇒ asiento en cuenta puente parametrizable + alerta, nunca se pierde la transacción (mismo espíritu que PENDIENTE_TARIFA).
4. **Interfaz al ERP**: los asientos/resúmenes por rubro (centro de costo + cuenta contable) viajan por el hub de eventos (outbox ya emite `cuenta.resumen_rubros`) — el consumidor Odoo sigue siendo la fase de integración ya decidida (2026-09-16), sin escritura directa.

Los reportes de `/admin/finance` pasan a poder filtrar por libro cuando (3) esté activo. La carga del plan de cuentas entra al checklist de la **Fase de Carga pre-UAT**.

## Fuera de alcance deliberado (decisiones ya tomadas — no re-abrir sin CC)

- **Consumidor del hub de eventos → Odoo**: fase de integración propia (decisión 2026-09-16) — el CC de multi-libro produce los eventos; el consumidor no se adelanta.
- **DTE (§23)** y **HL7/FHIR/DICOM (§28)**: diferidos del MVP.
- **Workflow designer publish/rollback** al motor vivo: decisión Edwin 2026-08-28.
- **TR S2–S4**: fases del REQ-HIS-TR-001, se planifican como CC propio, no como remediación.

## Decisiones que solo Edwin puede destrabar

1. UAT de #691/#692/#693 (+ CC-A cuando abra).
2. R1.1 sync `personal_salud` — aprobar el diseño (es la llave de IPSG-2).
3. R1.4 SSO-config: tabla real vs retiro.
4. R3.3 destino de las 5 páginas huérfanas.
5. R4.5 encender MFA staff.
6. §15 honorarios — **parcialmente respondido por Edwin (2026-09-19): los honorarios médicos los define cada doctor DESPUÉS de sus intervenciones.** Implicación de diseño: el flujo necesita una captura post-intervención donde el médico declara su honorario (que se vuelve el cargo HONORARIO de la cuenta + ProduccionMedica), con el convenio/regla como tope o default, no como monto automático. Se planifica como CC de ajuste sobre CC-0036 Ola 5. Quedan abiertos los demás parámetros del §15 (cuota de servicios, participación de insumos, retención 10 %, variable de médicos de turno).

## Secuencia propuesta

**R1 → R2 → R3 → R4 → Fase de Carga → UAT.** R1.1 primero de todo: reduce la fase de carga y deja listo un circuito de seguridad del paciente (IPSG-2) construido de punta a punta. La fase de carga se ejecuta una sola vez, con el desarrollo funcional, e inaugura el UAT.

/**
 * CC (control de rol admisión/emergencia/hospitalización/quirófano) — sets de
 * códigos de rol reutilizados por `encounter`, `triage*`, `surgery`,
 * `encounter-discharge`, `encounter-transfer`, `inpatient`, `bed`, `patient` y
 * `patient-account` routers.
 *
 * Origen: docs/audit/2026-09-15_cobertura/01-admision-emergencia-hosp-quirofano.md
 * §2 (hallazgo: 0 `requireRole` en estos routers — corrían sobre
 * `tenantProcedure` puro, sólo sesión + organización activa).
 *
 * Catálogo real de roles en prod (verificado 2026-09-27, proyecto Supabase
 * `ejacvsgbewcerxtjtwto`, `select code, count(distinct "organizationId") from
 * "Role" group by code`):
 *   ADMIN(3), ADMIN_CLINICO(21), ADMIN_CONSULTORIOS(21), ADMISSION_CLERK(1),
 *   ANALISTA_HONORARIOS(21), ANEST(1), BODEGA(21), CALIDAD(21),
 *   CONTRALOR_CORP(21), DIR(1), DIR_PAIS(21), ENF_NRP(1), FACTURACION(21),
 *   GERENTE(21), GERENTE_FINANCIERO(21), GO(1), JEFE_MEDICO_SEDE(21),
 *   LAB_TECHNICIAN(21), MEDICO_AFILIADO(21), NURSE(1), PEDIA(1),
 *   PHARMACIST(1), PHYSICIAN(1), RAD_TECHNICIAN(21),
 *   SECRETARIA_MEDICO_AFILIADO(21), SUPER_ADMIN(21), TRIAGE_NURSE(1),
 *   WORKFLOW_DESIGNER(1).
 *
 * Lectura clave (lección CC-0044, `insurance.router.ts`): PHYSICIAN / NURSE /
 * TRIAGE_NURSE / DIR / ANEST / PEDIA / GO / ENF_NRP / ADMISSION_CLERK /
 * PHARMACIST sólo existen en la organización piloto (single-tenant MVP, 1
 * org). Las 21 organizaciones multi-org ("médicos afiliados") NO tienen esos
 * códigos sembrados — usan SUPER_ADMIN / ADMIN_CLINICO / DIR_PAIS /
 * JEFE_MEDICO_SEDE / MEDICO_AFILIADO / ADMIN_CONSULTORIOS /
 * SECRETARIA_MEDICO_AFILIADO / LAB_TECHNICIAN / RAD_TECHNICIAN /
 * FACTURACION / GERENTE_FINANCIERO / GERENTE / CALIDAD / etc. Gatear SOLO con
 * los códigos de la org piloto (como hacía el primer intento de CC-0044 con
 * "ADMISION"/"ACCOUNTANT"/"BILLING", que ni siquiera existen en prod) deja 20
 * de 21 organizaciones sin poder operar el flujo. Cada set de abajo mezcla
 * AMBOS catálogos.
 *
 * GAP REPORTADO (no se resuelve aquí — ver `decisions_needed` del PR que
 * introduce este archivo): no existe un código de rol de ENFERMERÍA en el
 * catálogo de las 21 organizaciones multi-org — sólo hay equivalente médico
 * (MEDICO_AFILIADO / JEFE_MEDICO_SEDE). Triage y registro de enfermería en
 * esas 21 orgs sólo puede ejecutarlos hoy un médico o un admin clínico. Es un
 * tema de carga de datos/catálogo (falta sembrar un rol de enfermería
 * multi-org), NO se resuelve aquí dando acceso a roles no asistenciales
 * (GERENTE, FACTURACION, BODEGA, CONTRALOR_CORP, etc.) a operaciones
 * clínicas.
 */

/** Supervisión administrativa transversal — puede leer/gestionar cualquier módulo. */
export const ADMIN_OVERSIGHT_ROLES = ["SUPER_ADMIN", "ADMIN", "DIR", "DIR_PAIS"] as const;

/** Administración clínica de sede — existe en las 21 orgs; opera/supervisa clínicamente sin ser médico de planta. */
export const CLINICAL_ADMIN_ROLES = ["ADMIN_CLINICO"] as const;

/** Roles médicos con licencia clínica — catálogo piloto (PHYSICIAN) + catálogo de las 21 orgs (MEDICO_AFILIADO/JEFE_MEDICO_SEDE). */
export const PHYSICIAN_EQUIVALENT_ROLES = [
  "PHYSICIAN",
  "MEDICO_AFILIADO",
  "JEFE_MEDICO_SEDE",
] as const;

/** Enfermería / triage asistencial. SOLO existe en la org piloto (1 org) — ver GAP reportado arriba. */
export const NURSING_ROLES = ["NURSE", "TRIAGE_NURSE", "ENF_NRP"] as const;

/**
 * Especialidades quirúrgicas/obstétricas con catálogo propio (org piloto, 1
 * org). Deliberadamente FUERA de `CLINICAL_WRITE_ROLES`/`DISCHARGE_WRITE_ROLES`
 * (quedan solo en `SURGERY_WRITE_ROLES`/`ACCOUNTS_OPEN_ROLES`): son
 * especialidades de bloque quirúrgico, no personal de piso/hospitalización.
 * Verificado en prod (2026-09-28, `UserOrganizationRole`/`Role` del proyecto
 * `ejacvsgbewcerxtjtwto`): los 3 usuarios con ANEST/GO/PEDIA activos también
 * tienen PHYSICIAN en las mismas organizaciones — hoy no pierden acceso a
 * `CLINICAL_WRITE_ROLES`/`DISCHARGE_WRITE_ROLES` porque ya entran por
 * `PHYSICIAN_EQUIVALENT_ROLES`. Si se siembra en el futuro un usuario
 * ANEST/GO/PEDIA SIN PHYSICIAN, re-evaluar este set.
 */
export const SURGICAL_SPECIALTY_ROLES = ["ANEST", "GO", "PEDIA"] as const;

/** Front-desk / admisión — ADMISSION_CLERK (org piloto) + equivalentes administrativos de las 21 orgs. */
export const ADMISSION_FRONT_DESK_ROLES = [
  "ADMISSION_CLERK",
  "ADMIN_CONSULTORIOS",
  "SECRETARIA_MEDICO_AFILIADO",
] as const;

/** Técnicos de apoyo diagnóstico/farmacia que abren cuentas de servicio desde sus propias pantallas de orden (imaging/lab/farmacia). */
export const ANCILLARY_SERVICE_ROLES = ["LAB_TECHNICIAN", "RAD_TECHNICIAN", "PHARMACIST"] as const;

/** Financiero — facturación/cobro. */
export const FINANCE_ROLES = ["FACTURACION", "GERENTE_FINANCIERO"] as const;

/**
 * Lectura general de PHI (listados/censo/búsqueda de pacientes) — todo el
 * personal asistencial + admisión + supervisión administrativa. Deliberado
 * "amplio pero no total": excluye roles puramente back-office sin contacto
 * con el paciente ni su cuenta (BODEGA, CONTRALOR_CORP, WORKFLOW_DESIGNER).
 */
export const PHI_READ_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  ...PHYSICIAN_EQUIVALENT_ROLES,
  ...NURSING_ROLES,
  ...SURGICAL_SPECIALTY_ROLES,
  ...ADMISSION_FRONT_DESK_ROLES,
  ...ANCILLARY_SERVICE_ROLES,
  "GERENTE",
  "CALIDAD",
] as const;

/** Escritura clínica general (evolución, vitales, kardex, planes de cuidado, discriminadores) — personal asistencial + admin clínico. Sin front-desk ni ancillary. */
export const CLINICAL_WRITE_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  ...PHYSICIAN_EQUIVALENT_ROLES,
  ...NURSING_ROLES,
] as const;

/** Configuración (catálogos, flowcharts, salas) — sólo administración, nunca operativo. */
export const CONFIG_ROLES = [...ADMIN_OVERSIGHT_ROLES, ...CLINICAL_ADMIN_ROLES] as const;

/**
 * Admisión de pacientes (crear/editar registro, crear encuentro, mover/
 * asignar cama, recibir traslado) — asistencial (ER admite sin front-desk
 * disponible) + front-desk dedicado.
 */
export const ADMISSION_WRITE_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  ...PHYSICIAN_EQUIVALENT_ROLES,
  ...NURSING_ROLES,
  ...ADMISSION_FRONT_DESK_ROLES,
] as const;

/** Egreso / epicrisis / transferencia definitiva a otra organización — decisión médica, con respaldo de admin clínico. */
export const DISCHARGE_WRITE_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  ...PHYSICIAN_EQUIVALENT_ROLES,
] as const;

/** Bloque quirúrgico: WHO checklist, transiciones de caso, anestesia — cirujano/anestesiólogo/enfermería circulante/admin clínico. */
export const SURGERY_WRITE_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  ...PHYSICIAN_EQUIVALENT_ROLES,
  ...NURSING_ROLES,
  ...SURGICAL_SPECIALTY_ROLES,
] as const;

/**
 * Apertura/consulta de cuentas de servicio (PatientAccount) desde pantallas
 * de orden clínica (imaging/lab/respiratorio/vitales/historia clínica) o
 * desde admisión/facturación — deliberadamente amplio: `selector-cuenta.tsx`
 * (componente compartido) es invocado desde imaging, lab, respiratorio,
 * signos vitales e historia clínica, así que crear/listar cuentas debe ser
 * accesible a cualquiera de esos roles operativos, no sólo a facturación.
 */
export const ACCOUNTS_OPEN_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  ...PHYSICIAN_EQUIVALENT_ROLES,
  ...NURSING_ROLES,
  ...SURGICAL_SPECIALTY_ROLES,
  ...ADMISSION_FRONT_DESK_ROLES,
  ...ANCILLARY_SERVICE_ROLES,
  ...FINANCE_ROLES,
] as const;

/**
 * `/patients` es a la vez el buscador general de pacientes (MPI, enlazado
 * desde el dashboard como "Buscar paciente") y el worklist de cobro
 * (CC-0008) — por eso extiende `PHI_READ_ROLES` con `FINANCE_ROLES` en vez
 * de restringirse a uno de los dos. `PHI_READ_ROLES` solo no basta: deja a
 * FACTURACION/GERENTE_FINANCIERO (ya escritores en `ACCOUNTS_OPEN_ROLES` /
 * `ACCOUNTS_MANAGE_ROLES` y en `insurance.router.ts`) sin poder llegar a la
 * cuenta desde `/patients` → `patient.search`/`patient.get` → `cuentas.tsx`.
 * Deliberadamente NO se agrega `FINANCE_ROLES` a `PHI_READ_ROLES` mismo: ese
 * set también gatea lecturas clínicas de piso (inpatient, triage, surgery,
 * bed, encounter*) donde facturación no tiene motivo de acceso.
 */
export const PATIENTS_WORKLIST_READ_ROLES = [...PHI_READ_ROLES, ...FINANCE_ROLES] as const;

/** Cierre/gestión financiera de una cuenta de paciente ya abierta — financiero + admin, sin acceso operativo ancillary/front-desk. */
export const ACCOUNTS_MANAGE_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  ...FINANCE_ROLES,
  "GERENTE",
] as const;

/**
 * Deduplicación/fusión de identidad de paciente (`findDuplicates`,
 * `mergePatients`, `unmerge`) — operación irreversible sobre PHI/historial
 * financiero de DOS pacientes a la vez; se restringe a gobierno de datos
 * maestros (administración + calidad), no al personal asistencial de piso.
 */
export const PATIENT_MDM_ROLES = [
  ...ADMIN_OVERSIGHT_ROLES,
  ...CLINICAL_ADMIN_ROLES,
  "CALIDAD",
] as const;

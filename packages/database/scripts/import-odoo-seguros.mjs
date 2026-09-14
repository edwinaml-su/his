#!/usr/bin/env node
/**
 * CC-0028 — Importador one-shot idempotente de seguros desde Odoo (read-only).
 *
 * Campos Odoo verificados vía `mcp__odoo__get_fields` (Odoo 18, solo lectura,
 * `yolo_mode.level = "read"`) el 2026-09-14:
 *   - hms.insurance.company: name, code, vat, phone, email, active (29 activas).
 *   - acs.insurance.plan: insurance_company_id, name, sequence, pricelist_id,
 *     allow_appointment_insurance + app_insurance_type(percentage|fix|
 *     percentage_with_max)/app_insurance_percentage/app_insurance_amount
 *     (copago)/app_insurance_limit, allow_pharmacy_insurance + pha_insurance_type
 *     (percentage|fix — SIN percentage_with_max)/pha_insurance_percentage/
 *     pha_insurance_amount/pha_insurance_limit, policy_rule_ids (o2m).
 *   - hms.patient.insurance: patient_id, insurance_company_id, insurance_plan_id,
 *     policy_number, carnet, contratante, validity (¡una sola fecha, NO rango!),
 *     pricelist_id, mismos campos app_* y pha_* que el plan (pueden overridear),
 *     policy_rule_ids.
 *   - acs.insurance.policy.rule: insurance_plan_id XOR insurance_policy_id,
 *     rule_on(product_category|product), product_category_id, product_id,
 *     rule_type(percentage|amount), percentage, amount, full_cover, sequence.
 *   - hms.patient: dui (para matching), name.
 *
 * Mapeo a SQL 235:
 *   - hms.insurance.company        -> Insurer (GLOBAL, organizationId=null —
 *     igual que el resto del catálogo de aseguradoras; match por NOMBRE
 *     normalizado, nunca por `code` de Odoo — puede estar vacío/inconsistente).
 *   - acs.insurance.plan            -> InsurancePlan (+ code = slug del nombre,
 *     Odoo no tiene un `code` corto) + InsurancePlanCoverage (CONSULTA si
 *     allow_appointment_insurance, FARMACIA si allow_pharmacy_insurance;
 *     GENERAL NO existe en Odoo — extensión propia del HIS, nunca se puebla
 *     desde aquí) + CoverageRule a nivel de plan (policy_rule_ids).
 *   - hms.patient.insurance          -> PatientCoverage (SOLO si el paciente
 *     matchea contra el HIS) + PatientCoverageOverride + CoverageRule a nivel
 *     de póliza. `validity` (fecha única) -> validFrom; validTo queda NULL
 *     (Odoo no modela vigencia con fin — decisión v1, documentada).
 *
 * Nota de diseño — CoverageRule.organizationId es NOT NULL (SQL 235) incluso
 * cuando el plan/insurer es global (a diferencia de InsurancePlanCoverage,
 * que se hereda sin columna propia). Es intencional: las reglas granulares
 * por producto/categoría son configuración financiera que cada organización
 * decide adoptar o no, aunque el catálogo de aseguradoras/planes sea
 * compartido. Este importador REPLICA cada regla de nivel-plan UNA VEZ POR
 * organización real (mismo patrón de multiplicación que
 * seed-tarifario-odoo.mjs con ServicePriceList) — no es un error, es el
 * costo de que las reglas sean opt-in por organización.
 *
 * Matching de pacientes: por `hms.patient.dui` normalizado (sin guiones)
 * contra `Patient.documentNumber` (cuando documentType=DUI). Si el paciente
 * de Odoo no tiene DUI, se intenta por nombre normalizado EXACTO
 * (firstName+lastName). Cualquier otro caso (0 matches o >1 match) se
 * reporta como AMBIGUO y NO se importa esa póliza — el HIS tiene ~107
 * pacientes hoy, se esperan pocas coincidencias; el script queda para
 * re-corridas futuras a medida que se registran más pacientes.
 *
 * Aseguradoras/planes/coberturas/reglas de PLAN se importan siempre
 * (catálogo, no dependen de pacientes). Pólizas/overrides/reglas de PÓLIZA
 * solo para pacientes matcheados.
 *
 * Uso:
 *   node --env-file=apps/web/.env.local packages/database/scripts/import-odoo-seguros.mjs            (dry-run, default)
 *   node --env-file=apps/web/.env.local packages/database/scripts/import-odoo-seguros.mjs --dry-run   (explícito)
 *   node --env-file=apps/web/.env.local packages/database/scripts/import-odoo-seguros.mjs --apply     (escribe)
 *
 * Requiere ODOO_URL/ODOO_DB/ODOO_USER/ODOO_PASSWORD (apps/web/.env.local) y
 * DATABASE_URL válido contra el proyecto Supabase HIS (el password bueno
 * está en el .env.local de la RAÍZ, no en apps/web — ver memoria de sesión).
 *
 * IMPORTANTE (igual que seed-tarifario-odoo.mjs): el agente que generó este
 * script (@Dev) SOLO está autorizado a correr --dry-run. La corrida --apply
 * la decide @Orq/Edwin con el reporte de dry-run en mano.
 *
 * Política del proyecto: la integración con Odoo es SOLO LECTURA — este
 * script nunca escribe en Odoo, solo en el HIS.
 */

import { connect } from "./lib/odoo-xmlrpc.mjs";
import { slugify } from "./lib/odoo-tarifario-sql.mjs";

const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------------------
// Helpers puros (testeables sin BD ni red).
// ---------------------------------------------------------------------------

/** Normaliza un nombre para comparación tolerante a acentos/mayúsculas/espacios. */
export function normalizarNombre(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Normaliza un DUI/documento quitando todo lo que no sea dígito. */
export function normalizarDui(s) {
  return String(s ?? "").replace(/\D/g, "");
}

/** APP_INSURANCE_TYPE / PHA_INSURANCE_TYPE de Odoo -> coverageType del HIS. */
const ODOO_TIPO_A_COVERAGE_TYPE = {
  percentage: "PORCENTAJE",
  fix: "MONTO_FIJO",
  percentage_with_max: "PORCENTAJE_CON_TOPE",
};

/** acs.insurance.policy.rule.rule_type -> ruleType del HIS. */
const ODOO_RULE_TYPE = { percentage: "PORCENTAJE", amount: "MONTO" };

/**
 * Deriva un code corto (<=40) del nombre del producto Odoo cuando no hay
 * default_code — mismo criterio de fallback que resolverCode() en
 * odoo-tarifario-parser.mjs (bracket [COD] o ODOO-{id}), adaptado a la
 * forma de product.template en vez de product.pricelist.item.
 */
export function resolverCodigoProducto({ defaultCode, nombre, productTmplId }) {
  if (defaultCode) return defaultCode.slice(0, 40);
  const match = /^\[([^\]]+)\]\s*/.exec(nombre ?? "");
  if (match?.[1]) return match[1].slice(0, 40);
  return `ODOO-${productTmplId}`.slice(0, 40);
}

/**
 * Config por ámbito (CONSULTA/FARMACIA) a partir de los campos app_* y pha_*
 * de un acs.insurance.plan o hms.patient.insurance. Devuelve null si el
 * ámbito está desactivado (`allow_*_insurance = false`).
 */
export function construirAmbitoConfig({ allow, tipo, percentage, amount, limit }) {
  if (!allow) return null;
  const coverageType = ODOO_TIPO_A_COVERAGE_TYPE[tipo];
  if (!coverageType) return null;
  return {
    coverageType,
    insuredPercentage: coverageType !== "MONTO_FIJO" ? (percentage ?? null) : null,
    copayAmount: amount || null,
    coverageLimit: coverageType === "PORCENTAJE_CON_TOPE" ? (limit ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Extracción desde Odoo (solo lectura).
// ---------------------------------------------------------------------------

async function extraerDeOdoo() {
  const { exec } = await connect();

  const companies = await exec(
    "hms.insurance.company",
    "search_read",
    [[["active", "=", true]]],
    { fields: ["id", "name", "code", "vat", "phone", "email"] },
  );

  const plans = await exec(
    "acs.insurance.plan",
    "search_read",
    [[]],
    {
      fields: [
        "id", "name", "insurance_company_id", "sequence", "pricelist_id",
        "allow_appointment_insurance", "app_insurance_type", "app_insurance_percentage",
        "app_insurance_amount", "app_insurance_limit",
        "allow_pharmacy_insurance", "pha_insurance_type", "pha_insurance_percentage",
        "pha_insurance_amount", "pha_insurance_limit", "policy_rule_ids", "active",
      ],
    },
  );

  const policies = await exec(
    "hms.patient.insurance",
    "search_read",
    [[]],
    {
      fields: [
        "id", "patient_id", "insurance_company_id", "insurance_plan_id",
        "policy_number", "carnet", "contratante", "validity",
        "allow_appointment_insurance", "app_insurance_type", "app_insurance_percentage",
        "app_insurance_amount", "app_insurance_limit",
        "allow_pharmacy_insurance", "pha_insurance_type", "pha_insurance_percentage",
        "pha_insurance_amount", "pha_insurance_limit", "policy_rule_ids", "active",
      ],
    },
  );

  const ruleIds = [...new Set([...plans, ...policies].flatMap((r) => r.policy_rule_ids ?? []))];
  const rules = ruleIds.length
    ? await exec("acs.insurance.policy.rule", "read", [ruleIds], {
        fields: [
          "id", "insurance_plan_id", "insurance_policy_id", "rule_on",
          "product_category_id", "product_id", "rule_type", "percentage",
          "amount", "full_cover", "sequence",
        ],
      })
    : [];

  const productIds = [...new Set(rules.filter((r) => r.product_id).map((r) => r.product_id[0]))];
  const products = productIds.length
    ? await exec("product.template", "read", [productIds], { fields: ["id", "default_code", "name"] })
    : [];

  const patientIds = [...new Set(policies.map((p) => p.patient_id?.[0]).filter(Boolean))];
  const patients = patientIds.length
    ? await exec("hms.patient", "read", [patientIds], { fields: ["id", "name", "dui"] })
    : [];

  return { companies, plans, policies, rules, products, patients };
}

// ---------------------------------------------------------------------------
// Reporte (dry-run y --apply comparten el mismo cálculo de "qué haría falta").
// ---------------------------------------------------------------------------

function indexarPorId(rows) {
  return new Map(rows.map((r) => [r.id, r]));
}

async function construirPlan(datos, prisma) {
  const { companies, plans, policies, rules, products, patients } = datos;
  const productsById = indexarPorId(products);
  const patientsById = indexarPorId(patients);
  const rulesById = indexarPorId(rules);

  const orgsReales = await prisma.organization.findMany({
    where: { NOT: { legalName: { startsWith: "RLS-Test" } } },
    select: { id: true, legalName: true },
  });

  // Nota: si el nombre normalizado matchea un Insurer TENANT-scoped en vez de
  // uno global, el plan importado hereda esa tenancy (queda invisible para
  // otros tenants) — no se resuelve aquí a propósito (dataset chico, revisar
  // el reporte de dry-run antes de --apply). Insurer nuevos se crean GLOBALES.
  const insurersHis = await prisma.insurer.findMany({ select: { id: true, name: true, organizationId: true } });
  const insurerPorNombre = new Map(insurersHis.map((i) => [normalizarNombre(i.name), i]));

  // "ServiceCategory" (CC-0021, sql/204) no tiene modelo Prisma — raw SQL,
  // mismo patrón que su uso en price-resolver.ts.
  const categoriasHis = await prisma.$queryRawUnsafe(
    `SELECT id, "odooCategId" FROM "ServiceCategory" WHERE "odooCategId" IS NOT NULL`,
  );
  const categoriaPorOdooId = new Map(categoriasHis.map((c) => [c.odooCategId, c.id]));

  const hisPatients = await prisma.patient.findMany({
    where: { organizationId: { in: orgsReales.map((o) => o.id) } },
    select: { id: true, organizationId: true, documentType: true, documentNumber: true, firstName: true, lastName: true },
  });
  // Solo documentType=DUI — el `dui` de Odoo es específicamente DUI/Cédula,
  // matchear contra NIT/pasaporte/etc. del HIS produciría falsos positivos.
  const patientPorDui = new Map(
    hisPatients
      .filter((p) => p.documentType === "DUI" && p.documentNumber)
      .map((p) => [normalizarDui(p.documentNumber), p]),
  );
  const patientsPorNombre = new Map();
  for (const p of hisPatients) {
    const key = normalizarNombre(`${p.firstName} ${p.lastName}`);
    patientsPorNombre.set(key, [...(patientsPorNombre.get(key) ?? []), p]);
  }

  const plan = {
    insurers: [], // { odooId, name, match: Insurer|null }
    plans: [], // { odooId, name, code, insurerName, ambitos: [...], rules: [...] }
    policies: [], // { odooId, policyNumber, patientMatch: {status, patient?}, ... }
    ambiguos: [],
    omitidos: [],
  };

  for (const c of companies) {
    const match = insurerPorNombre.get(normalizarNombre(c.name)) ?? null;
    plan.insurers.push({ odooId: c.id, name: c.name, vat: c.vat, match });
  }

  function codigoDeProducto(productId) {
    if (!productId) return null;
    const p = productsById.get(productId[0]);
    return resolverCodigoProducto({
      defaultCode: p?.default_code ?? null,
      nombre: p?.name ?? productId[1],
      productTmplId: productId[0],
    });
  }

  function reglaAHis(rule) {
    if (rule.rule_on === "product_category") {
      const odooCategId = rule.product_category_id?.[0] ?? null;
      const serviceCategoryId = odooCategId != null ? (categoriaPorOdooId.get(odooCategId) ?? null) : null;
      return {
        ruleOn: "CATEGORIA",
        serviceCategoryId,
        code: null,
        odooCategoriaSinMatch: odooCategId != null && serviceCategoryId == null,
        ruleType: ODOO_RULE_TYPE[rule.rule_type] ?? "PORCENTAJE",
        percentage: rule.percentage || null,
        amount: rule.amount || null,
        fullCover: !!rule.full_cover,
        sequence: rule.sequence ?? 0,
      };
    }
    return {
      ruleOn: "CODIGO",
      serviceCategoryId: null,
      code: codigoDeProducto(rule.product_id),
      odooCategoriaSinMatch: false,
      ruleType: ODOO_RULE_TYPE[rule.rule_type] ?? "PORCENTAJE",
      percentage: rule.percentage || null,
      amount: rule.amount || null,
      fullCover: !!rule.full_cover,
      sequence: rule.sequence ?? 0,
    };
  }

  for (const p of plans) {
    const insurerName = p.insurance_company_id?.[1] ?? null;
    const insurerMatch = insurerName ? (insurerPorNombre.get(normalizarNombre(insurerName)) ?? null) : null;
    const ambitos = [];
    const consulta = construirAmbitoConfig({
      allow: p.allow_appointment_insurance,
      tipo: p.app_insurance_type,
      percentage: p.app_insurance_percentage,
      amount: p.app_insurance_amount,
      limit: p.app_insurance_limit,
    });
    if (consulta) ambitos.push({ ambito: "CONSULTA", ...consulta });
    const farmacia = construirAmbitoConfig({
      allow: p.allow_pharmacy_insurance,
      tipo: p.pha_insurance_type,
      percentage: p.pha_insurance_percentage,
      amount: p.pha_insurance_amount,
      limit: p.pha_insurance_limit,
    });
    if (farmacia) ambitos.push({ ambito: "FARMACIA", ...farmacia });

    const rules_ = (p.policy_rule_ids ?? []).map((id) => rulesById.get(id)).filter(Boolean).map(reglaAHis);

    plan.plans.push({
      odooId: p.id,
      name: p.name,
      code: slugify(p.name).toUpperCase().slice(0, 40) || `PLAN-${p.id}`,
      insurerName,
      insurerMatch,
      ambitos,
      rules: rules_,
      // reglas de nivel-plan se replican por cada org real (ver docstring).
      orgsAReplicar: orgsReales.map((o) => o.id),
    });
  }

  for (const pol of policies) {
    const odooPatient = pol.patient_id ? patientsById.get(pol.patient_id[0]) : null;
    let patientMatch = { status: "SIN_PACIENTE_ODOO" };

    if (odooPatient) {
      const dui = normalizarDui(odooPatient.dui);
      if (dui && patientPorDui.has(dui)) {
        patientMatch = { status: "OK", patient: patientPorDui.get(dui), via: "DUI" };
      } else {
        const nombreKey = normalizarNombre(odooPatient.name);
        const candidatos = patientsPorNombre.get(nombreKey) ?? [];
        if (candidatos.length === 1) {
          patientMatch = { status: "OK", patient: candidatos[0], via: "NOMBRE" };
        } else if (candidatos.length > 1) {
          patientMatch = { status: "AMBIGUO", motivo: `${candidatos.length} pacientes HIS con nombre "${odooPatient.name}"` };
        } else {
          patientMatch = { status: "SIN_MATCH", motivo: `sin DUI y sin match de nombre para "${odooPatient.name}"` };
        }
      }
    }

    const insurerName = pol.insurance_company_id?.[1] ?? null;
    const planOdooId = pol.insurance_plan_id?.[0] ?? null;

    const overrides = [];
    const consulta = construirAmbitoConfig({
      allow: pol.allow_appointment_insurance,
      tipo: pol.app_insurance_type,
      percentage: pol.app_insurance_percentage,
      amount: pol.app_insurance_amount,
      limit: pol.app_insurance_limit,
    });
    if (consulta) overrides.push({ ambito: "CONSULTA", ...consulta });
    const farmacia = construirAmbitoConfig({
      allow: pol.allow_pharmacy_insurance,
      tipo: pol.pha_insurance_type,
      percentage: pol.pha_insurance_percentage,
      amount: pol.pha_insurance_amount,
      limit: pol.pha_insurance_limit,
    });
    if (farmacia) overrides.push({ ambito: "FARMACIA", ...farmacia });

    const rules_ = (pol.policy_rule_ids ?? []).map((id) => rulesById.get(id)).filter(Boolean).map(reglaAHis);

    const entry = {
      odooId: pol.id,
      policyNumber: pol.policy_number,
      carnet: pol.carnet || null,
      contratante: pol.contratante || null,
      validFrom: pol.validity || null,
      insurerName,
      planOdooId,
      patientMatch,
      overrides,
      rules: rules_,
    };

    if (patientMatch.status === "OK") plan.policies.push(entry);
    else plan.ambiguos.push({ ...entry, razon: patientMatch.status, detalle: patientMatch.motivo });
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Aplicación (--apply) — idempotente vía upsert por llave natural.
// ---------------------------------------------------------------------------

/**
 * `CoverageRule` (SQL 235) no tiene ningún UNIQUE — a diferencia de
 * `InsurancePlanCoverage`/`PatientCoverageOverride` (que sí lo tienen vía
 * `upsert`), una regla se busca por su llave natural completa antes de
 * crearla, para que una segunda corrida de `--apply` sea idempotente en vez
 * de duplicar filas.
 */
async function crearReglaSiNoExiste(prisma, data) {
  const existing = await prisma.coverageRule.findFirst({ where: data });
  if (existing) return { record: existing, creada: false };
  const record = await prisma.coverageRule.create({ data });
  return { record, creada: true };
}

async function aplicar(plan, prisma) {
  const contadores = {
    insurersCreados: 0, insurersExistentes: 0,
    planesCreados: 0, planesActualizados: 0,
    ambitosPlan: 0, reglasPlan: 0,
    polizasCreadas: 0, overridesPoliza: 0, reglasPoliza: 0,
  };

  // La única llave que comparten insurers/plans/policies es el NOMBRE de la
  // aseguradora (normalizado) — Odoo no expone el id de company en `plan`
  // como algo distinto del propio nombre resuelto por el many2one.
  const insurerIdPorNombre = new Map();
  for (const ins of plan.insurers) {
    if (ins.match) {
      insurerIdPorNombre.set(normalizarNombre(ins.name), ins.match.id);
      contadores.insurersExistentes++;
      continue;
    }
    const created = await prisma.insurer.create({
      data: { organizationId: null, code: slugify(ins.name).toUpperCase().slice(0, 40) || `ODOO-${ins.odooId}`, name: ins.name, taxId: ins.vat || null, kind: "PRIVATE" },
    });
    insurerIdPorNombre.set(normalizarNombre(ins.name), created.id);
    contadores.insurersCreados++;
  }

  const planIdByOdooId = new Map();
  for (const p of plan.plans) {
    const finalInsurerId = p.insurerMatch?.id ?? insurerIdPorNombre.get(normalizarNombre(p.insurerName)) ?? null;
    if (!finalInsurerId) continue; // no debería ocurrir: toda company se crea/matchea arriba.

    const existing = await prisma.insurancePlan.findFirst({ where: { insurerId: finalInsurerId, code: p.code } });
    const record = existing
      ? await prisma.insurancePlan.update({
          where: { id: existing.id },
          data: { name: p.name, sequence: p.sequence ?? 0 },
        })
      : await prisma.insurancePlan.create({
          data: { insurerId: finalInsurerId, code: p.code, name: p.name, sequence: 0 },
        });
    existing ? contadores.planesActualizados++ : contadores.planesCreados++;
    planIdByOdooId.set(p.odooId, record.id);

    for (const a of p.ambitos) {
      await prisma.insurancePlanCoverage.upsert({
        where: { planId_ambito: { planId: record.id, ambito: a.ambito } },
        create: { planId: record.id, ambito: a.ambito, coverageType: a.coverageType, insuredPercentage: a.insuredPercentage, copayAmount: a.copayAmount, coverageLimit: a.coverageLimit },
        update: { coverageType: a.coverageType, insuredPercentage: a.insuredPercentage, copayAmount: a.copayAmount, coverageLimit: a.coverageLimit, active: true },
      });
      contadores.ambitosPlan++;
    }

    for (const orgId of p.orgsAReplicar) {
      for (const r of p.rules) {
        if (r.ruleOn === "CATEGORIA" && !r.serviceCategoryId) continue; // sin match de categoría, se omite.
        const { creada } = await crearReglaSiNoExiste(prisma, {
          organizationId: orgId,
          planId: record.id,
          ruleOn: r.ruleOn,
          serviceCategoryId: r.serviceCategoryId,
          code: r.code,
          ruleType: r.ruleType,
          percentage: r.percentage,
          amount: r.amount,
          fullCover: r.fullCover,
          sequence: r.sequence,
        });
        if (creada) contadores.reglasPlan++;
      }
    }
  }

  for (const pol of plan.policies) {
    const planId = planIdByOdooId.get(pol.planOdooId);
    if (!planId) continue; // plan no importado (no debería pasar).
    const patient = pol.patientMatch.patient;

    // PatientCoverage tiene UNIQUE (organizationId, patientId, policyNumber)
    // — buscar antes de crear evita el P2002 (y aborta el script a medias)
    // en una segunda corrida de --apply.
    const existingCoverage = await prisma.patientCoverage.findFirst({
      where: { organizationId: patient.organizationId, patientId: patient.id, policyNumber: pol.policyNumber },
    });
    const coverage = existingCoverage
      ?? (await prisma.patientCoverage.create({
        data: {
          organizationId: patient.organizationId,
          patientId: patient.id,
          planId,
          policyNumber: pol.policyNumber,
          carnet: pol.carnet,
          contratante: pol.contratante,
          validFrom: pol.validFrom ? new Date(pol.validFrom) : new Date(),
          validTo: null,
        },
      }));
    if (!existingCoverage) contadores.polizasCreadas++;

    for (const o of pol.overrides) {
      await prisma.patientCoverageOverride.upsert({
        where: { coverageId_ambito: { coverageId: coverage.id, ambito: o.ambito } },
        create: { coverageId: coverage.id, ambito: o.ambito, coverageType: o.coverageType, insuredPercentage: o.insuredPercentage, copayAmount: o.copayAmount, coverageLimit: o.coverageLimit },
        update: { coverageType: o.coverageType, insuredPercentage: o.insuredPercentage, copayAmount: o.copayAmount, coverageLimit: o.coverageLimit, active: true },
      });
      contadores.overridesPoliza++;
    }

    for (const r of pol.rules) {
      if (r.ruleOn === "CATEGORIA" && !r.serviceCategoryId) continue;
      const { creada } = await crearReglaSiNoExiste(prisma, {
        organizationId: patient.organizationId,
        coverageId: coverage.id,
        ruleOn: r.ruleOn,
        serviceCategoryId: r.serviceCategoryId,
        code: r.code,
        ruleType: r.ruleType,
        percentage: r.percentage,
        amount: r.amount,
        fullCover: r.fullCover,
        sequence: r.sequence,
      });
      if (creada) contadores.reglasPoliza++;
    }
  }

  return contadores;
}

// ---------------------------------------------------------------------------
// Reporte de consola.
// ---------------------------------------------------------------------------

function imprimirReporte(plan) {
  console.log(`\n=== CC-0028 — Importador de seguros Odoo (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);

  const insurersNuevos = plan.insurers.filter((i) => !i.match).length;
  console.log(`Aseguradoras: ${plan.insurers.length} en Odoo — ${plan.insurers.length - insurersNuevos} ya existen en HIS (match por nombre), ${insurersNuevos} se crearían.`);

  const reglasSinCategoria = plan.plans.flatMap((p) => p.rules).filter((r) => r.odooCategoriaSinMatch).length;
  console.log(`Planes: ${plan.plans.length} en Odoo — ${plan.plans.reduce((n, p) => n + p.ambitos.length, 0)} filas de cobertura por ámbito, ${plan.plans.reduce((n, p) => n + p.rules.length, 0)} reglas de nivel-plan (se replican × org real).`);
  if (reglasSinCategoria > 0) {
    console.log(`  ⚠ ${reglasSinCategoria} regla(s) de categoría sin ServiceCategory.odooCategId matcheado en el HIS — se omitirían.`);
  }

  console.log(`Pólizas de paciente en Odoo: ${plan.policies.length + plan.ambiguos.length}.`);
  console.log(`  - Matcheadas contra el HIS (se importarían): ${plan.policies.length}`);
  console.log(`  - NO matcheadas / ambiguas (se omiten, reportadas abajo): ${plan.ambiguos.length}`);

  if (plan.ambiguos.length > 0) {
    console.log(`\nPólizas omitidas:`);
    for (const a of plan.ambiguos.slice(0, 50)) {
      console.log(`  · póliza Odoo #${a.odooId} (${a.policyNumber ?? "sin número"}) — ${a.razon}${a.detalle ? `: ${a.detalle}` : ""}`);
    }
    if (plan.ambiguos.length > 50) console.log(`  … y ${plan.ambiguos.length - 50} más.`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  // @prisma/client directo (NO "@his/database": su main es src/index.ts TS
  // con imports sin extensión — irresoluble bajo `node` puro; mismo patrón
  // que seed-tarifario-odoo.mjs).
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const datos = await extraerDeOdoo();
    const plan = await construirPlan(datos, prisma);
    imprimirReporte(plan);

    if (!APPLY) {
      console.log("Dry-run — no se escribió nada. Corre con --apply para aplicar (autorización de @Orq/Edwin).");
      return;
    }

    const contadores = await aplicar(plan, prisma);
    console.log("=== Resultado --apply ===");
    console.log(contadores);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

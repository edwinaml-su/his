/**
 * @his/database — Seed base del MVP.
 * TDR §5–§9 / blueprints. Idempotente: usar upsert por clave natural.
 *
 * Ejecutar:  npm run db:seed
 */
import { PrismaClient, TriageColor } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[seed] Inicio");

  // ───────────────────────────── Country (SLV) ─────────────────────────────
  const country = await prisma.country.upsert({
    where: { isoAlpha3: "SLV" },
    update: {},
    create: {
      isoAlpha3: "SLV",
      isoNumeric: 222,
      name: "El Salvador",
      defaultLocale: "es-SV",
      defaultTzId: "America/El_Salvador",
    },
  });
  console.log(`[seed] Country: ${country.name}`);

  // ───────────────────────────── Currencies ────────────────────────────────
  const currencies = [
    { isoCode: "USD", name: "Dólar de los Estados Unidos", decimals: 2, symbol: "$" },
    { isoCode: "SVC", name: "Colón salvadoreño", decimals: 2, symbol: "₡" },
    { isoCode: "BTC", name: "Bitcoin", decimals: 8, symbol: "₿" },
  ];
  const currencyByIso = new Map<string, string>();
  for (const c of currencies) {
    const cur = await prisma.currency.upsert({
      where: { isoCode: c.isoCode },
      update: {},
      create: c,
    });
    currencyByIso.set(c.isoCode, cur.id);
  }
  // CountryCurrency
  for (const iso of ["USD", "SVC", "BTC"]) {
    await prisma.countryCurrency.upsert({
      where: {
        countryId_currencyId: { countryId: country.id, currencyId: currencyByIso.get(iso)! },
      },
      update: {},
      create: {
        countryId: country.id,
        currencyId: currencyByIso.get(iso)!,
        isLegalTender: iso !== "SVC",
        isFunctional: iso === "USD",
      },
    });
  }

  // ──────────────────────── 14 departamentos SV ────────────────────────────
  // TDR §27.4 — código MINSAL/RNPN. validFrom 2019-01-01.
  const departamentos: Array<{ code: string; name: string }> = [
    { code: "01", name: "Ahuachapán" },
    { code: "02", name: "Santa Ana" },
    { code: "03", name: "Sonsonate" },
    { code: "04", name: "Chalatenango" },
    { code: "05", name: "La Libertad" },
    { code: "06", name: "San Salvador" },
    { code: "07", name: "Cuscatlán" },
    { code: "08", name: "La Paz" },
    { code: "09", name: "Cabañas" },
    { code: "10", name: "San Vicente" },
    { code: "11", name: "Usulután" },
    { code: "12", name: "San Miguel" },
    { code: "13", name: "Morazán" },
    { code: "14", name: "La Unión" },
  ];
  const validFrom = new Date("2019-01-01T00:00:00Z");
  for (const d of departamentos) {
    await prisma.geoDivision.upsert({
      where: {
        countryId_code_level_validFrom: {
          countryId: country.id,
          code: d.code,
          level: 1,
          validFrom,
        },
      },
      update: {},
      create: {
        countryId: country.id,
        level: 1,
        code: d.code,
        name: d.name,
        validFrom,
      },
    });
  }
  console.log(`[seed] GeoDivision: ${departamentos.length} departamentos`);

  // ─────────────────── IdentifierTypes (DUI, NIT, NIE) ─────────────────────
  const idTypes = [
    { code: "DUI", name: "Documento Único de Identidad", validatorFn: "validate_dui" },
    { code: "NIT", name: "Número de Identificación Tributaria", validatorFn: "validate_nit" },
    { code: "NIE", name: "Número de Identificación de Extranjero", validatorFn: "validate_nie" },
    { code: "PASSPORT", name: "Pasaporte", validatorFn: null as string | null },
    { code: "MINOR_ID", name: "Carné de menor", validatorFn: null },
  ];
  for (const t of idTypes) {
    await prisma.identifierType.upsert({
      where: { countryId_code: { countryId: country.id, code: t.code } },
      update: {},
      create: { countryId: country.id, ...t },
    });
  }

  // ─────────────────────────── Géneros ─────────────────────────────────────
  const genders = [
    { code: "MALE", name: "Masculino" },
    { code: "FEMALE", name: "Femenino" },
    { code: "NON_BINARY", name: "No binario" },
    { code: "PREFER_NOT_TO_SAY", name: "Prefiere no decir" },
    { code: "OTHER", name: "Otro" },
  ];
  for (const g of genders) {
    await prisma.gender.upsert({ where: { code: g.code }, update: {}, create: g });
  }

  // ─────────────────────── BiologicalSex ───────────────────────────────────
  const sexes = [
    { code: "M", name: "Masculino" },
    { code: "F", name: "Femenino" },
    { code: "I", name: "Intersexual" },
    { code: "U", name: "Desconocido" },
  ];
  for (const s of sexes) {
    await prisma.biologicalSex.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  // ─────────────────────── MaritalStatus ───────────────────────────────────
  const marital = [
    { code: "SINGLE", name: "Soltero/a" },
    { code: "MARRIED", name: "Casado/a" },
    { code: "DIVORCED", name: "Divorciado/a" },
    { code: "WIDOWED", name: "Viudo/a" },
    { code: "COHABITING", name: "Acompañado/a" },
    { code: "SEPARATED", name: "Separado/a" },
  ];
  for (const m of marital) {
    await prisma.maritalStatus.upsert({ where: { code: m.code }, update: {}, create: m });
  }

  // ─────────────────────── EducationLevel ──────────────────────────────────
  const edu = [
    { code: "NONE", name: "Ninguno", ordinal: 0 },
    { code: "PRIMARY", name: "Primaria", ordinal: 1 },
    { code: "SECONDARY", name: "Secundaria", ordinal: 2 },
    { code: "HIGH_SCHOOL", name: "Bachillerato", ordinal: 3 },
    { code: "TECHNICAL", name: "Técnico", ordinal: 4 },
    { code: "UNIVERSITY", name: "Universitario", ordinal: 5 },
    { code: "POSTGRADUATE", name: "Postgrado", ordinal: 6 },
  ];
  for (const e of edu) {
    await prisma.educationLevel.upsert({ where: { code: e.code }, update: {}, create: e });
  }

  // ───────────────────────────── Languages ─────────────────────────────────
  const langs = [
    { isoCode: "spa", name: "Español" },
    { isoCode: "eng", name: "Inglés" },
    { isoCode: "nah", name: "Náhuat" },
    { isoCode: "fra", name: "Francés" },
    { isoCode: "por", name: "Portugués" },
  ];
  for (const l of langs) {
    await prisma.language.upsert({ where: { isoCode: l.isoCode }, update: {}, create: l });
  }

  // ─────────────────────── Ocupaciones (top 20 CIUO) ───────────────────────
  const occs = [
    { ciuoCode: "0000", name: "No especificado" },
    { ciuoCode: "1120", name: "Director ejecutivo" },
    { ciuoCode: "2211", name: "Médico general" },
    { ciuoCode: "2212", name: "Médico especialista" },
    { ciuoCode: "2221", name: "Profesional de enfermería" },
    { ciuoCode: "2222", name: "Profesional de partería" },
    { ciuoCode: "2261", name: "Odontólogo" },
    { ciuoCode: "2262", name: "Farmacéutico" },
    { ciuoCode: "2310", name: "Profesor universitario" },
    { ciuoCode: "2320", name: "Profesor de secundaria" },
    { ciuoCode: "3221", name: "Enfermería técnica" },
    { ciuoCode: "3251", name: "Auxiliar dental" },
    { ciuoCode: "4110", name: "Oficinista general" },
    { ciuoCode: "5120", name: "Cocinero" },
    { ciuoCode: "5223", name: "Vendedor" },
    { ciuoCode: "6111", name: "Agricultor" },
    { ciuoCode: "7115", name: "Albañil" },
    { ciuoCode: "8322", name: "Conductor de automóvil/taxi" },
    { ciuoCode: "9112", name: "Limpiador" },
    { ciuoCode: "9999", name: "Otro" },
  ];
  for (const o of occs) {
    await prisma.occupation.upsert({ where: { ciuoCode: o.ciuoCode }, update: {}, create: o });
  }

  // ─────────────────────── Religiones principales ──────────────────────────
  const rels = [
    { code: "CATHOLIC", name: "Católica" },
    { code: "EVANGELICAL", name: "Evangélica" },
    { code: "PROTESTANT", name: "Protestante" },
    { code: "JEHOVAH_WITNESS", name: "Testigo de Jehová" },
    { code: "MORMON", name: "Mormona (SUD)" },
    { code: "JEWISH", name: "Judía" },
    { code: "MUSLIM", name: "Musulmana" },
    { code: "BUDDHIST", name: "Budista" },
    { code: "ATHEIST", name: "Ateo" },
    { code: "AGNOSTIC", name: "Agnóstico" },
    { code: "OTHER", name: "Otra" },
    { code: "NONE", name: "Ninguna" },
  ];
  for (const r of rels) {
    await prisma.religion.upsert({ where: { code: r.code }, update: {}, create: r });
  }

  // ───────────────── Especialidades médicas (top 20) ──────────────────────
  const specs = [
    { code: "GENERAL", name: "Medicina General" },
    { code: "INTERNAL", name: "Medicina Interna" },
    { code: "PEDIATRICS", name: "Pediatría" },
    { code: "GYNECOLOGY", name: "Ginecología y Obstetricia" },
    { code: "SURGERY", name: "Cirugía General" },
    { code: "ORTHOPEDICS", name: "Ortopedia y Traumatología" },
    { code: "CARDIOLOGY", name: "Cardiología" },
    { code: "NEUROLOGY", name: "Neurología" },
    { code: "DERMATOLOGY", name: "Dermatología" },
    { code: "OPHTHALMOLOGY", name: "Oftalmología" },
    { code: "OTOLARYNGOLOGY", name: "Otorrinolaringología" },
    { code: "PSYCHIATRY", name: "Psiquiatría" },
    { code: "RADIOLOGY", name: "Radiología" },
    { code: "ANESTHESIOLOGY", name: "Anestesiología" },
    { code: "EMERGENCY", name: "Medicina de Emergencias" },
    { code: "FAMILY", name: "Medicina Familiar" },
    { code: "ENDOCRINOLOGY", name: "Endocrinología" },
    { code: "GASTROENTEROLOGY", name: "Gastroenterología" },
    { code: "ONCOLOGY", name: "Oncología" },
    { code: "UROLOGY", name: "Urología" },
  ];
  for (const s of specs) {
    await prisma.medicalSpecialty.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  // ─────────── PatientType / PatientCategory (mínimos) ────────────────────
  for (const t of [
    { code: "OUTPATIENT", name: "Ambulatorio" },
    { code: "INPATIENT", name: "Hospitalizado" },
    { code: "EMERGENCY", name: "Emergencia" },
    { code: "OBSERVATION", name: "Observación" },
  ]) {
    await prisma.patientType.upsert({ where: { code: t.code }, update: {}, create: t });
  }
  for (const c of [
    { code: "PRIVATE", name: "Privado" },
    { code: "ISSS", name: "ISSS" },
    { code: "MINSAL", name: "MINSAL" },
    { code: "FOSALUD", name: "FOSALUD" },
    { code: "INSURED", name: "Asegurado" },
  ]) {
    await prisma.patientCategory.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  // ─────────────────────── Organizaciones (3 demo) ─────────────────────────
  const usdId = currencyByIso.get("USD")!;
  const holding = await prisma.organization.upsert({
    where: { countryId_taxId: { countryId: country.id, taxId: "0614-010101-001-1" } },
    update: {},
    create: {
      countryId: country.id,
      legalName: "Inversiones Avante S.A. de C.V.",
      tradeName: "Avante Holding",
      taxId: "0614-010101-001-1",
      functionalCurrency: usdId,
    },
  });
  const hospitalCentral = await prisma.organization.upsert({
    where: { countryId_taxId: { countryId: country.id, taxId: "0614-020202-002-2" } },
    update: {},
    create: {
      countryId: country.id,
      parentId: holding.id,
      legalName: "Hospital Avante Central S.A. de C.V.",
      tradeName: "Hospital Avante Central",
      taxId: "0614-020202-002-2",
      functionalCurrency: usdId,
    },
  });
  await prisma.organization.upsert({
    where: { countryId_taxId: { countryId: country.id, taxId: "0614-030303-003-3" } },
    update: {},
    create: {
      countryId: country.id,
      parentId: holding.id,
      legalName: "Clínica Avante San Miguel S.A. de C.V.",
      tradeName: "Clínica Avante SM",
      taxId: "0614-030303-003-3",
      functionalCurrency: usdId,
    },
  });
  console.log("[seed] Organizations: holding + 2 subsidiarias");

  // ─────────────────────── Establishment demo ──────────────────────────────
  const estab = await prisma.establishment.upsert({
    where: { organizationId_code: { organizationId: hospitalCentral.id, code: "EST-001" } },
    update: {},
    create: {
      organizationId: hospitalCentral.id,
      code: "EST-001",
      name: "Hospital Avante Central — Sede Principal",
      addressLine: "Col. Escalón, San Salvador",
      phone: "+503 2222-0000",
    },
  });
  console.log(`[seed] Establishment: ${estab.name}`);

  // ─────────────────────── ServiceUnits ────────────────────────────────────
  const services = [
    { code: "CE", name: "Consulta Externa" },
    { code: "ER", name: "Emergencia" },
    { code: "HOSP", name: "Hospitalización" },
    { code: "UCI", name: "Unidad de Cuidados Intensivos" },
    { code: "UCIN", name: "UCI Neonatal" },
    { code: "QX", name: "Quirófanos" },
    { code: "PARTOS", name: "Sala de Partos" },
    { code: "LAB", name: "Laboratorio Clínico" },
    { code: "RX", name: "Imágenes / Radiología" },
    { code: "FAR", name: "Farmacia" },
  ];
  for (const s of services) {
    await prisma.serviceUnit.upsert({
      where: { establishmentId_code: { establishmentId: estab.id, code: s.code } },
      update: {},
      create: {
        organizationId: hospitalCentral.id,
        establishmentId: estab.id,
        code: s.code,
        name: s.name,
      },
    });
  }
  console.log(`[seed] ServiceUnits: ${services.length}`);

  // ─────────────────────── Roles MVP ───────────────────────────────────────
  const roles = [
    { code: "PHYSICIAN", name: "Médico" },
    { code: "NURSE", name: "Enfermería" },
    { code: "ADMISSION_CLERK", name: "Admisionista" },
    { code: "TRIAGE_NURSE", name: "Enfermería de Triage" },
    { code: "PHARMACIST", name: "Farmacéutico" },
    { code: "ADMIN", name: "Administrador" },
  ];
  const roleByCode = new Map<string, string>();
  for (const r of roles) {
    const role = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: hospitalCentral.id, code: r.code } },
      update: {},
      create: { organizationId: hospitalCentral.id, ...r },
    });
    roleByCode.set(r.code, role.id);
  }

  // ─────────────────────── Permissions base ────────────────────────────────
  const perms: Array<{ code: string; resource: string; action: string }> = [
    { code: "patient.read", resource: "patient", action: "read" },
    { code: "patient.create", resource: "patient", action: "create" },
    { code: "patient.update", resource: "patient", action: "update" },
    { code: "patient.delete", resource: "patient", action: "delete" },
    { code: "encounter.read", resource: "encounter", action: "read" },
    { code: "encounter.admit", resource: "encounter", action: "admit" },
    { code: "encounter.transfer", resource: "encounter", action: "transfer" },
    { code: "encounter.discharge", resource: "encounter", action: "discharge" },
    { code: "bed.read", resource: "bed", action: "read" },
    { code: "bed.update", resource: "bed", action: "update" },
    { code: "triage.read", resource: "triage", action: "read" },
    { code: "triage.create", resource: "triage", action: "create" },
    { code: "catalog.read", resource: "catalog", action: "read" },
    { code: "catalog.write", resource: "catalog", action: "write" },
    { code: "audit.read", resource: "audit", action: "read" },
    { code: "user.manage", resource: "user", action: "manage" },
    { code: "org.manage", resource: "organization", action: "manage" },
    // Sprint 4 — Pharmacy / LIS / EHR Notes (T14 permission scopes).
    { code: "pharmacy.drug.manage", resource: "pharmacy", action: "drug.manage" },
    { code: "pharmacy.prescribe", resource: "pharmacy", action: "prescribe" },
    { code: "pharmacy.dispense", resource: "pharmacy", action: "dispense" },
    { code: "lis.order.create", resource: "lis", action: "order.create" },
    { code: "lis.specimen.collect", resource: "lis", action: "specimen.collect" },
    { code: "lis.result.enter", resource: "lis", action: "result.enter" },
    { code: "lis.result.validate", resource: "lis", action: "result.validate" },
    { code: "ehr.note.author", resource: "ehr", action: "note.author" },
    { code: "ehr.diagnosis.author", resource: "ehr", action: "diagnosis.author" },
  ];
  const permByCode = new Map<string, string>();
  for (const p of perms) {
    const perm = await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
    permByCode.set(p.code, perm.id);
  }

  // ──────────── RolePermission (mapeo mínimo MVP) ──────────────────────────
  const grant = async (roleCode: string, codes: string[]) => {
    const roleId = roleByCode.get(roleCode)!;
    for (const code of codes) {
      const permissionId = permByCode.get(code)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId, effect: "ALLOW" },
      });
    }
  };
  await grant("ADMIN", Array.from(permByCode.keys()));
  await grant("PHYSICIAN", [
    "patient.read",
    "patient.update",
    "encounter.read",
    "encounter.admit",
    "encounter.transfer",
    "encounter.discharge",
    "bed.read",
    "triage.read",
  ]);
  await grant("NURSE", [
    "patient.read",
    "encounter.read",
    "bed.read",
    "bed.update",
    "triage.read",
  ]);
  await grant("ADMISSION_CLERK", [
    "patient.read",
    "patient.create",
    "patient.update",
    "encounter.read",
    "encounter.admit",
    "bed.read",
  ]);
  await grant("TRIAGE_NURSE", [
    "patient.read",
    "encounter.read",
    "triage.read",
    "triage.create",
  ]);
  await grant("PHARMACIST", ["patient.read", "encounter.read"]);

  // ─────────────────── Manchester Triage Levels ────────────────────────────
  // TDR §9.1 — paleta y tiempos clásicos del MTS.
  const levels: Array<{
    color: TriageColor;
    priority: number;
    name: string;
    maxWaitMinutes: number;
    uiColorHex: string;
  }> = [
    { color: "RED", priority: 1, name: "Inmediato", maxWaitMinutes: 0, uiColorHex: "#DC2626" },
    { color: "ORANGE", priority: 2, name: "Muy urgente", maxWaitMinutes: 10, uiColorHex: "#EA580C" },
    { color: "YELLOW", priority: 3, name: "Urgente", maxWaitMinutes: 60, uiColorHex: "#CA8A04" },
    { color: "GREEN", priority: 4, name: "Estándar", maxWaitMinutes: 120, uiColorHex: "#16A34A" },
    { color: "BLUE", priority: 5, name: "No urgente", maxWaitMinutes: 240, uiColorHex: "#2563EB" },
  ];
  for (const l of levels) {
    await prisma.triageLevel.upsert({
      where: { organizationId_color: { organizationId: hospitalCentral.id, color: l.color } },
      update: {},
      create: { organizationId: hospitalCentral.id, ...l },
    });
  }
  console.log("[seed] TriageLevels: 5 niveles Manchester");

  console.log("[seed] OK");
}

main()
  .catch((e) => {
    console.error("[seed] ERROR", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

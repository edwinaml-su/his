/**
 * Seed específico de Pharmacy (Wave 1, Team Charlie).
 *
 * - Carga el dataset estático `drug-interactions.json` en `drug_interaction`.
 * - Crea un subset mínimo de fármacos en el catálogo `drug` para pruebas
 *   manuales y E2E (Amoxicilina, Insulina rápida, Clonazepam, Paracetamol,
 *   Warfarina, Morfina, etc.). El catálogo completo se cargará vía API en
 *   Wave 2 a partir de fuente autoritativa (TODO[Wave 2 Lexicomp/Vademecum]).
 *
 * Ejecutar:  pnpm tsx packages/database/seed-pharmacy.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface InteractionEntry {
  atcA: string;
  atcB: string;
  severity: "minor" | "moderate" | "major" | "contraindicated";
  description: string;
}

interface InteractionJson {
  version: string;
  source: string;
  entries: InteractionEntry[];
}

const SEED_DRUGS = [
  // No controlados — comunes
  {
    atcCode: "J01CA04",
    name: "Amoxicilina",
    strength: "500 mg",
    form: "cápsula",
    defaultRoute: "VO" as const,
    controlledClass: "NONE" as const,
    isHighRisk: false,
    allergyFamilies: ["penicilina", "penicilínicos", "betalactámicos"],
    // US.F2.6.10 — excipientes alergénicos (tartrazina en algunas presentaciones)
    allergyExcipients: [] as string[],
  },
  {
    atcCode: "N02BE01",
    name: "Paracetamol",
    strength: "500 mg",
    form: "tableta",
    defaultRoute: "VO" as const,
    controlledClass: "NONE" as const,
    isHighRisk: false,
    allergyFamilies: ["paracetamol"],
    // US.F2.6.10 — Paracetamol presentación naranja contiene tartrazina (E102).
    allergyExcipients: ["tartrazina"],
  },
  {
    atcCode: "M01AE01",
    name: "Ibuprofeno",
    strength: "400 mg",
    form: "tableta",
    defaultRoute: "VO" as const,
    controlledClass: "NONE" as const,
    isHighRisk: false,
    allergyFamilies: ["aine", "ibuprofeno"],
    allergyExcipients: [] as string[],
  },
  // Alto riesgo ISMP
  {
    atcCode: "A10AB05",
    name: "Insulina aspart (rápida)",
    strength: "100 UI/mL",
    form: "vial",
    defaultRoute: "SC" as const,
    controlledClass: "NONE" as const,
    isHighRisk: true,
    allergyFamilies: ["insulina"],
    allergyExcipients: [] as string[],
  },
  {
    atcCode: "B01AA03",
    name: "Warfarina",
    strength: "5 mg",
    form: "tableta",
    defaultRoute: "VO" as const,
    controlledClass: "NONE" as const,
    isHighRisk: true,
    allergyFamilies: ["warfarina", "cumarínicos"],
    allergyExcipients: [] as string[],
  },
  // Controlados (Wave 1 modo papel)
  {
    atcCode: "N02AA01",
    name: "Morfina",
    strength: "10 mg/mL",
    form: "ampolla",
    defaultRoute: "IV" as const,
    controlledClass: "II" as const,
    isHighRisk: true,
    allergyFamilies: ["opioides", "morfina"],
    allergyExcipients: [] as string[],
  },
  {
    atcCode: "N03AE01",
    name: "Clonazepam",
    strength: "2 mg",
    form: "tableta",
    defaultRoute: "VO" as const,
    controlledClass: "IV" as const,
    isHighRisk: false,
    allergyFamilies: ["benzodiacepinas", "clonazepam"],
    allergyExcipients: [] as string[],
  },
];

async function loadInteractions(): Promise<InteractionEntry[]> {
  const filePath = path.resolve(
    __dirname,
    "seed",
    "drug-interactions.json",
  );
  if (!fs.existsSync(filePath)) {
    console.warn(
      `[seed-pharmacy] drug-interactions.json no encontrado en ${filePath}; skip.`,
    );
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as InteractionJson;
  return parsed.entries;
}

async function main() {
  console.log("[seed-pharmacy] Inicio (Wave 1 — Team Charlie)");

  // 1) Fármacos catálogo global (organizationId NULL).
  for (const d of SEED_DRUGS) {
    await prisma.drug.upsert({
      where: {
        organizationId_atcCode_strength_form: {
          organizationId: null as never, // global
          atcCode: d.atcCode,
          strength: d.strength,
          form: d.form,
        },
      },
      update: {},
      create: { ...d, organizationId: null },
    });
  }
  console.log(`[seed-pharmacy] Drug global: ${SEED_DRUGS.length} entradas`);

  // 2) Interacciones estáticas Wave 1.
  const entries = await loadInteractions();
  for (const e of entries) {
    await prisma.drugInteraction.upsert({
      where: { atcA_atcB: { atcA: e.atcA, atcB: e.atcB } },
      update: {},
      create: {
        atcA: e.atcA,
        atcB: e.atcB,
        severity: e.severity,
        description: e.description,
        source: "stub-wave1",
      },
    });
  }
  console.log(`[seed-pharmacy] DrugInteraction: ${entries.length} pares`);

  // 3) US.F2.6.10 — PatientAllergy fixtures de test para cross-check alergias.
  //    Solo se insertan si existen los pacientes PAC-001 y PAC-002 (test users).
  //    En CI / staging se siembran desde seed-test-users.mjs; en dev local aplica.
  const pacPenicilina = await prisma.patient.findFirst({
    where: { mrn: "PAC-001" },
    select: { id: true },
  });
  if (pacPenicilina) {
    await prisma.patientAllergy.upsert({
      where: {
        // PatientAllergy no tiene unique compuesto — usamos findFirst fallback.
        id: (
          await prisma.patientAllergy.findFirst({
            where: { patientId: pacPenicilina.id, substanceText: "Penicilina" },
          })
        )?.id ?? "00000000-0000-0000-0000-allergy00001",
      },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-allergy00001",
        patientId: pacPenicilina.id,
        substanceText: "Penicilina",
        severity: "severe",
        active: true,
        verified: true,
      },
    }).catch(() => {
      // Ya existe — skip silencioso.
    });
    console.log("[seed-pharmacy] PatientAllergy PAC-001 (Penicilina)");
  }

  const pacTartrazina = await prisma.patient.findFirst({
    where: { mrn: "PAC-002" },
    select: { id: true },
  });
  if (pacTartrazina) {
    await prisma.patientAllergy.upsert({
      where: {
        id: (
          await prisma.patientAllergy.findFirst({
            where: { patientId: pacTartrazina.id, substanceText: "Tartrazina" },
          })
        )?.id ?? "00000000-0000-0000-0000-allergy00002",
      },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-allergy00002",
        patientId: pacTartrazina.id,
        substanceText: "Tartrazina",
        severity: "mild",
        active: true,
        verified: false,
      },
    }).catch(() => {
      // Ya existe — skip silencioso.
    });
    console.log("[seed-pharmacy] PatientAllergy PAC-002 (Tartrazina)");
  }

  console.log("[seed-pharmacy] OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * @his/database — Seed catálogo de vacunas (US-7.3 + soporte US-4.5).
 *
 * Carga el calendario PAI (Programa Ampliado de Inmunizaciones) de El Salvador 2026
 * + un set de vacunas universales (countryId = NULL) compartidas entre países.
 *
 * Idempotente: usa upsert por unique (countryId, code).
 *
 * Fuente: MINSAL — Norma Nacional de Vacunación PAI 2026.
 *  - Esquema básico < 5 años: BCG, HepB-RN, Pentavalente (DPT-Hib-HepB), Polio IPV,
 *    Rotavirus, Neumococo conjugada, Influenza, SRP (triple viral).
 *  - Refuerzos: DPT (18m, 4a), Td (10a y embarazo), VPH (9a niñas).
 *  - Especiales: Fiebre amarilla (viajeros), COVID-19 (esquema vigente).
 *
 * Decisiones de diseño:
 *  - El calendario MINSAL SV 2026 mantiene Pentavalente (no Hexavalente). Las dosis
 *    son 2-4-6 meses (2024 estandarizó refuerzos a los 18m con DPT acelular).
 *  - IPV (polio inactivada) reemplaza completamente la OPV oral desde 2018; mantenemos
 *    sólo IPV en el catálogo SV.
 *  - Neumococo: en SV 2026 se usa PCV13 (10v fue retirada). Code único `NEUMOCOCO`.
 *  - Td adulto: dosis única en embarazo (24-28 semanas) y refuerzo a los 10a.
 *  - VPH: solo niñas 9-10a (esquema 2 dosis 0-6m). Sprint 2 evaluará neutralidad de género.
 *  - Vacunas universales (countryId=null): COVID19 base, Influenza adultos, FA viajeros.
 *
 * Ejecutar:  npm run -w @his/database seed:vaccines
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface VaccineSeed {
  code: string;
  name: string;
  manufacturer?: string;
  routeOfAdmin: string;
  scheduleNote: string;
}

/** Calendario PAI El Salvador 2026 — countryId = SLV. */
const VACCINES_SV: VaccineSeed[] = [
  {
    code: "BCG",
    name: "BCG (antituberculosa)",
    routeOfAdmin: "ID",
    scheduleNote: "Dosis única recién nacido (preferentemente <24h). Vía intradérmica deltoides derecho.",
  },
  {
    code: "HEPB-RN",
    name: "Hepatitis B (recién nacido)",
    routeOfAdmin: "IM",
    scheduleNote: "Dosis 0 dentro de las primeras 24h post-parto. Esquema continúa con Pentavalente 2-4-6m.",
  },
  {
    code: "PENTAVALENTE",
    name: "Pentavalente (DPT-Hib-HepB)",
    routeOfAdmin: "IM",
    scheduleNote:
      "3 dosis: 2, 4 y 6 meses. Cubre difteria, tétanos, pertussis, Haemophilus influenzae b y hepatitis B (dosis 1, 2, 3 post-RN).",
  },
  {
    code: "POLIO-IPV",
    name: "Polio inactivada (IPV)",
    routeOfAdmin: "IM",
    scheduleNote:
      "3 dosis: 2, 4 y 6 meses. Reemplaza completamente OPV en SV desde 2018. Refuerzo opcional con DPT a los 18m.",
  },
  {
    code: "ROTAVIRUS",
    name: "Rotavirus oral",
    routeOfAdmin: "ORAL",
    scheduleNote:
      "2 dosis: 2 y 4 meses. Primera dosis no después de las 15 semanas; última no después de 8 meses 0 días.",
  },
  {
    code: "NEUMOCOCO",
    name: "Neumococo conjugada (PCV13)",
    routeOfAdmin: "IM",
    scheduleNote: "3 dosis: 2, 4 y 12 meses. Refuerzo a los 12m completa el esquema primario.",
  },
  {
    code: "INFLUENZA",
    name: "Influenza estacional",
    routeOfAdmin: "IM",
    scheduleNote:
      "Anual desde los 6 meses. Niños 6m-8a: 2 dosis con 4 semanas de intervalo en primovacunación; luego 1 anual.",
  },
  {
    code: "SRP",
    name: "Triple viral (SRP) — sarampión, rubéola, parotiditis",
    routeOfAdmin: "SC",
    scheduleNote: "3 dosis: 12 meses, 18 meses (refuerzo) y 7 años (escolar).",
  },
  {
    code: "DPT",
    name: "DPT (refuerzo difteria-tétanos-pertussis)",
    routeOfAdmin: "IM",
    scheduleNote: "Refuerzos a los 18 meses y 4 años. No usar para esquema primario (eso es Pentavalente).",
  },
  {
    code: "TD",
    name: "Td (tétanos-difteria adulto)",
    routeOfAdmin: "IM",
    scheduleNote: "Refuerzo a los 10 años y dosis única durante embarazo (24-28 semanas).",
  },
  {
    code: "VPH",
    name: "Virus del papiloma humano (VPH)",
    routeOfAdmin: "IM",
    scheduleNote: "2 dosis (0-6 meses) en niñas de 9-10 años. Tetravalente (6/11/16/18) o nonavalente.",
  },
  {
    code: "FA-SV",
    name: "Fiebre amarilla (PAI El Salvador)",
    routeOfAdmin: "SC",
    scheduleNote: "Dosis única a los 12 meses + viajeros a zonas endémicas (≥10 días antes del viaje).",
  },
];

/** Vacunas universales (countryId = null). Aplicables en cualquier país que use el HIS. */
const VACCINES_GLOBAL: VaccineSeed[] = [
  {
    code: "COVID19",
    name: "COVID-19 (esquema vigente)",
    routeOfAdmin: "IM",
    scheduleNote:
      "Esquema vigente según OMS/MINSAL: refuerzos anuales adaptados a cepa circulante. mRNA o vector viral.",
  },
  {
    code: "FA",
    name: "Fiebre amarilla (universal viajeros)",
    routeOfAdmin: "SC",
    scheduleNote: "Dosis única para viajeros a zonas endémicas. Validez de por vida (OMS, 2016).",
  },
  {
    code: "MENINGO-ACWY",
    name: "Meningocócica conjugada ACWY",
    routeOfAdmin: "IM",
    scheduleNote: "Adolescentes 11-12a + refuerzo 16a. Viajeros a zona del cinturón meningítico.",
  },
  {
    code: "VARICELA",
    name: "Varicela",
    routeOfAdmin: "SC",
    scheduleNote: "2 dosis: 12-15 meses y 4-6 años. NO incluida aún en PAI SV pero disponible privado.",
  },
  {
    code: "HEPA",
    name: "Hepatitis A",
    routeOfAdmin: "IM",
    scheduleNote: "2 dosis con intervalo de 6 meses. Recomendada desde los 12 meses.",
  },
];

async function upsertVaccine(seed: VaccineSeed, countryId: string | null): Promise<void> {
  await prisma.vaccine.upsert({
    where: {
      countryId_code: {
        countryId: countryId as string, // Prisma compound unique acepta null en runtime aunque el tipo sea string
        code: seed.code,
      },
    },
    create: {
      countryId,
      code: seed.code,
      name: seed.name,
      manufacturer: seed.manufacturer,
      routeOfAdmin: seed.routeOfAdmin,
      scheduleNote: seed.scheduleNote,
      active: true,
    },
    update: {
      name: seed.name,
      manufacturer: seed.manufacturer,
      routeOfAdmin: seed.routeOfAdmin,
      scheduleNote: seed.scheduleNote,
      active: true,
    },
  });
}

async function main(): Promise<void> {
  console.log("[seed-vaccines-sv] Inicio…");

  // Resolver país SLV (asumimos seed base ya cargó países).
  const slv = await prisma.country.findFirst({
    where: { isoAlpha3: "SLV" },
    select: { id: true },
  });

  if (!slv) {
    console.warn(
      "[seed-vaccines-sv] País SLV no encontrado en BD. Cargando solo vacunas globales (countryId=null).",
    );
  } else {
    console.log(`[seed-vaccines-sv] País SLV id=${slv.id}. Cargando ${VACCINES_SV.length} vacunas PAI…`);
    for (const v of VACCINES_SV) {
      await upsertVaccine(v, slv.id);
    }
  }

  console.log(`[seed-vaccines-sv] Cargando ${VACCINES_GLOBAL.length} vacunas universales…`);
  for (const v of VACCINES_GLOBAL) {
    await upsertVaccine(v, null);
  }

  const total = await prisma.vaccine.count();
  console.log(`[seed-vaccines-sv] OK. Total vacunas en catálogo: ${total}.`);
}

main()
  .catch((err) => {
    console.error("[seed-vaccines-sv] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

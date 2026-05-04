/**
 * @his/database — Seed Manchester (US-6.3 + US-6.4).
 *
 * Equipo: **Mike — Triage Manchester**
 *
 * Seedea los flujogramas estándar Manchester (52 originales) + sus
 * discriminadores clínicos por nivel (RED/ORANGE/YELLOW/GREEN/BLUE).
 *
 * Ejecución:
 *   pnpm --filter @his/database seed:manchester
 *   o:
 *   tsx --env-file=.env seed-manchester.ts
 *
 * Idempotente:
 *   - upsert flujograma por (organizationId, code)
 *   - upsert discriminador por (flowchartId, ordinal)
 *
 * Decisiones (TDR §9.2 / §9.3):
 *   - Si una organización ya tiene flujogramas con `code` no listado aquí,
 *     se respeta — sólo agregamos los nuevos / actualizamos `name` y `category`.
 *   - Pediátricos: cualquier flowchart cuyo nombre incluya "child"/"baby"/
 *     "Pediatric" o cuyo code arranque con `ped_` se marca `isPediatric=true`.
 *   - Cada flujograma seedea 4 discriminadores estándar (RED, ORANGE,
 *     YELLOW, BLUE) y opcionalmente 1-2 GREEN específicos. Si el TDR clínico
 *     local define más, se agregan después con ordinal incremental.
 *   - Sin discriminador positivo durante la evaluación → cae a `defaultLevel`
 *     que aquí seedeamos como BLUE (priority=5).
 */
import { PrismaClient, TriageColor } from "@prisma/client";

const prisma = new PrismaClient();

// ──────────────────────────── Tipos auxiliares ────────────────────────────

type Category = "TRAUMA" | "MEDICAL" | "PEDIATRIC" | "PSYCHIATRIC";

interface DiscriminatorSeed {
  /** snake_case, único dentro del flujograma. */
  code: string;
  /** Texto clínico mostrado al triagista (ES). */
  text: string;
  /** Color resultante si POSITIVO. */
  color: TriageColor;
  /** Orden de evaluación. 1 = primero (más urgente). */
  ordinal: number;
}

interface FlowchartSeed {
  code: string;
  name: string;
  category: Category;
  isPediatric?: boolean;
  /** Si se omite usamos los 4 discriminadores genéricos. */
  discriminators?: DiscriminatorSeed[];
}

// ──────────────────── Discriminadores genéricos por defecto ────────────────────
//
// Para flujogramas que aún no tienen lista clínica afinada, aplicamos un set
// estándar Manchester: vía aérea / shock / dolor severo / dolor moderado /
// recent event / sin riesgo. Cubre los 5 niveles.

const GENERIC_DISCRIMINATORS: DiscriminatorSeed[] = [
  { code: "airway_compromise",    text: "Compromiso de vía aérea",                color: "RED",    ordinal: 1 },
  { code: "shock",                text: "Signos de shock (hipoperfusión)",        color: "RED",    ordinal: 2 },
  { code: "severe_haemorrhage",   text: "Hemorragia severa exsanguinante",        color: "RED",    ordinal: 3 },
  { code: "altered_consciousness",text: "Alteración aguda de la consciencia",     color: "ORANGE", ordinal: 4 },
  { code: "severe_pain",          text: "Dolor severo (EVA ≥ 7)",                 color: "ORANGE", ordinal: 5 },
  { code: "moderate_pain",        text: "Dolor moderado (EVA 4-6)",               color: "YELLOW", ordinal: 6 },
  { code: "recent_trauma",        text: "Evento / trauma reciente",               color: "YELLOW", ordinal: 7 },
  { code: "recent_problem",       text: "Problema reciente (< 7 días)",           color: "GREEN",  ordinal: 8 },
  { code: "no_risk",              text: "Sin signos de riesgo",                   color: "BLUE",   ordinal: 9 },
];

// ─────────────────── Catálogo de los 52 flujogramas Manchester ───────────────────
//
// Lista completa estándar (Mackway-Jones et al., MTS 3rd ed.) + adaptaciones
// pediátricas y psiquiátricas mencionadas en el TDR.

const FLOWCHARTS: FlowchartSeed[] = [
  // ─────── MEDICAL ───────
  { code: "abdominal_pain",         name: "Dolor abdominal",                    category: "MEDICAL" },
  { code: "asthma",                 name: "Asma",                               category: "MEDICAL" },
  { code: "back_pain",              name: "Dolor de espalda",                   category: "MEDICAL" },
  { code: "behaving_strangely",     name: "Comportamiento anormal",             category: "PSYCHIATRIC" },
  { code: "bites_and_stings",       name: "Mordeduras y picaduras",             category: "MEDICAL" },
  { code: "burns_and_scalds",       name: "Quemaduras y escaldaduras",          category: "TRAUMA" },
  { code: "cardiac_chest_pain",     name: "Dolor torácico cardíaco",            category: "MEDICAL",
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 2 },
      { code: "current_chest_pain",    text: "Dolor torácico actual de tipo cardíaco",       color: "ORANGE", ordinal: 3 },
      { code: "severe_pain",           text: "Dolor severo (EVA ≥ 7)",                       color: "ORANGE", ordinal: 4 },
      { code: "abnormal_pulse",        text: "Pulso anormal (bradicardia / taquicardia)",    color: "ORANGE", ordinal: 5 },
      { code: "moderate_pain",         text: "Dolor moderado (EVA 4-6)",                     color: "YELLOW", ordinal: 6 },
      { code: "history_cardiac_pain",  text: "Antecedente reciente de dolor cardíaco",       color: "YELLOW", ordinal: 7 },
      { code: "recent_problem",        text: "Problema reciente (< 7 días)",                 color: "GREEN",  ordinal: 8 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 9 },
    ],
  },
  { code: "catastrophic_event",     name: "Evento catastrófico",                category: "TRAUMA",
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "inadequate_breathing",  text: "Respiración inadecuada",                       color: "RED",    ordinal: 2 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 3 },
      { code: "exsanguinating_haem",   text: "Hemorragia exsanguinante",                     color: "RED",    ordinal: 4 },
      { code: "altered_consciousness", text: "Alteración aguda de la consciencia",           color: "ORANGE", ordinal: 5 },
      { code: "severe_pain",           text: "Dolor severo",                                 color: "ORANGE", ordinal: 6 },
      { code: "moderate_pain",         text: "Dolor moderado",                               color: "YELLOW", ordinal: 7 },
      { code: "recent_problem",        text: "Problema reciente",                            color: "GREEN",  ordinal: 8 },
    ],
  },
  { code: "chest_pain",             name: "Dolor torácico",                     category: "MEDICAL" },
  { code: "collapsed_adult",        name: "Adulto colapsado",                   category: "MEDICAL",
    discriminators: [
      { code: "unresponsive",          text: "Paciente no responde",                         color: "RED",    ordinal: 1 },
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 2 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 3 },
      { code: "altered_consciousness", text: "Alteración de consciencia",                    color: "ORANGE", ordinal: 4 },
      { code: "abnormal_pulse",        text: "Pulso anormal",                                color: "ORANGE", ordinal: 5 },
      { code: "history_unconsciousness", text: "Antecedente de inconsciencia",               color: "YELLOW", ordinal: 6 },
      { code: "recent_problem",        text: "Problema reciente",                            color: "GREEN",  ordinal: 7 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 8 },
    ],
  },
  { code: "dental_problems",        name: "Problemas dentales",                 category: "MEDICAL" },
  { code: "diabetes",               name: "Diabetes",                           category: "MEDICAL" },
  { code: "diarrhoea_and_vomiting", name: "Diarrea y vómitos",                  category: "MEDICAL" },
  { code: "dyspnoea_adult",         name: "Disnea en adulto",                   category: "MEDICAL",
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "inadequate_breathing",  text: "Respiración inadecuada",                       color: "RED",    ordinal: 2 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 3 },
      { code: "low_spo2",              text: "SpO₂ < 95% al aire ambiente",                  color: "ORANGE", ordinal: 4 },
      { code: "acute_breathlessness",  text: "Disnea aguda",                                 color: "ORANGE", ordinal: 5 },
      { code: "moderate_pain",         text: "Dolor moderado",                               color: "YELLOW", ordinal: 6 },
      { code: "history_dyspnoea",      text: "Antecedente reciente de disnea",               color: "YELLOW", ordinal: 7 },
      { code: "recent_problem",        text: "Problema reciente",                            color: "GREEN",  ordinal: 8 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 9 },
    ],
  },
  { code: "ear_problems",           name: "Problemas en el oído",               category: "MEDICAL" },
  { code: "eye_problems",           name: "Problemas oculares",                 category: "MEDICAL" },
  { code: "facial_problems",        name: "Problemas faciales",                 category: "MEDICAL" },
  { code: "falls",                  name: "Caídas",                             category: "TRAUMA" },
  { code: "fits",                   name: "Convulsiones",                       category: "MEDICAL",
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "currently_fitting",     text: "Convulsionando actualmente",                   color: "RED",    ordinal: 2 },
      { code: "altered_consciousness", text: "Postictal con alteración prolongada",          color: "ORANGE", ordinal: 3 },
      { code: "recent_fit",            text: "Crisis reciente (< 24 h)",                     color: "YELLOW", ordinal: 4 },
      { code: "history_fits",          text: "Antecedente de convulsiones",                  color: "GREEN",  ordinal: 5 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 6 },
    ],
  },
  { code: "foreign_body",           name: "Cuerpo extraño",                     category: "MEDICAL" },
  { code: "gi_bleeding",            name: "Sangrado gastrointestinal",          category: "MEDICAL",
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "shock",                 text: "Shock por sangrado",                           color: "RED",    ordinal: 2 },
      { code: "exsanguinating_haem",   text: "Hemorragia exsanguinante (hematemesis franca)", color: "RED",   ordinal: 3 },
      { code: "altered_consciousness", text: "Alteración de consciencia",                    color: "ORANGE", ordinal: 4 },
      { code: "active_bleeding",       text: "Sangrado activo (melena / hematoquecia)",      color: "ORANGE", ordinal: 5 },
      { code: "moderate_pain",         text: "Dolor moderado",                               color: "YELLOW", ordinal: 6 },
      { code: "recent_problem",        text: "Sangrado intermitente reciente",               color: "GREEN",  ordinal: 7 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 8 },
    ],
  },
  { code: "headache",               name: "Cefalea",                            category: "MEDICAL" },
  { code: "head_injury",            name: "Trauma craneoencefálico",            category: "TRAUMA",
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 2 },
      { code: "gcs_under_9",           text: "Glasgow ≤ 8",                                  color: "RED",    ordinal: 3 },
      { code: "altered_consciousness", text: "Alteración de consciencia",                    color: "ORANGE", ordinal: 4 },
      { code: "loc_history",           text: "Pérdida de consciencia testigada",             color: "ORANGE", ordinal: 5 },
      { code: "vomiting_post_trauma",  text: "Vómitos post-trauma",                          color: "YELLOW", ordinal: 6 },
      { code: "moderate_pain",         text: "Dolor moderado",                               color: "YELLOW", ordinal: 7 },
      { code: "recent_problem",        text: "Trauma reciente sin alarma",                   color: "GREEN",  ordinal: 8 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 9 },
    ],
  },
  { code: "limb_problems",          name: "Problemas en extremidades",          category: "TRAUMA" },
  { code: "major_trauma",           name: "Trauma mayor",                       category: "TRAUMA",
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "inadequate_breathing",  text: "Respiración inadecuada",                       color: "RED",    ordinal: 2 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 3 },
      { code: "exsanguinating_haem",   text: "Hemorragia exsanguinante",                     color: "RED",    ordinal: 4 },
      { code: "altered_consciousness", text: "Alteración de consciencia",                    color: "ORANGE", ordinal: 5 },
      { code: "high_energy_mechanism", text: "Mecanismo de alta energía",                    color: "ORANGE", ordinal: 6 },
      { code: "severe_pain",           text: "Dolor severo",                                 color: "ORANGE", ordinal: 7 },
      { code: "moderate_pain",         text: "Dolor moderado",                               color: "YELLOW", ordinal: 8 },
      { code: "recent_problem",        text: "Trauma reciente menor",                        color: "GREEN",  ordinal: 9 },
    ],
  },
  { code: "mental_illness",         name: "Enfermedad mental",                  category: "PSYCHIATRIC",
    discriminators: [
      { code: "currently_violent",     text: "Violento o con intención homicida",            color: "RED",    ordinal: 1 },
      { code: "active_self_harm",      text: "Autolesión activa o intento reciente",         color: "ORANGE", ordinal: 2 },
      { code: "altered_consciousness", text: "Alteración de consciencia",                    color: "ORANGE", ordinal: 3 },
      { code: "high_distress",         text: "Distrés psicológico severo",                   color: "YELLOW", ordinal: 4 },
      { code: "moderate_distress",     text: "Distrés moderado",                             color: "GREEN",  ordinal: 5 },
      { code: "no_risk",               text: "Sin signos de riesgo agudo",                   color: "BLUE",   ordinal: 6 },
    ],
  },
  { code: "neck_pain",              name: "Dolor cervical",                     category: "MEDICAL" },
  { code: "overdose_poisoning",     name: "Sobredosis e intoxicación",          category: "MEDICAL" },
  { code: "palpitations",           name: "Palpitaciones",                      category: "MEDICAL" },
  { code: "pregnancy",              name: "Embarazo",                           category: "MEDICAL" },
  { code: "pv_bleeding",            name: "Sangrado vaginal (PV)",              category: "MEDICAL" },
  { code: "rash_adult",             name: "Erupción / rash en adulto",          category: "MEDICAL" },
  { code: "self_harm",              name: "Autolesión",                         category: "PSYCHIATRIC" },
  { code: "sexually_acquired_inf",  name: "Infección de transmisión sexual",    category: "MEDICAL" },
  { code: "sore_throat",            name: "Dolor de garganta",                  category: "MEDICAL" },
  { code: "testicular_pain",        name: "Dolor testicular",                   category: "MEDICAL" },
  { code: "torso_injury",           name: "Lesión de torso",                    category: "TRAUMA" },
  { code: "unwell_adult",           name: "Adulto enfermo (inespecífico)",      category: "MEDICAL" },
  { code: "urinary_problems",       name: "Problemas urinarios",                category: "MEDICAL" },
  { code: "vaginal_bleeding",       name: "Sangrado vaginal",                   category: "MEDICAL" },
  { code: "wounds",                 name: "Heridas",                            category: "TRAUMA" },

  // ─────── PEDIATRIC ───────
  { code: "ped_crying_baby",        name: "Bebé que llora",                     category: "PEDIATRIC", isPediatric: true,
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 2 },
      { code: "altered_consciousness", text: "Alteración de consciencia / hipotonía",        color: "ORANGE", ordinal: 3 },
      { code: "inconsolable",          text: "Llanto inconsolable persistente",              color: "YELLOW", ordinal: 4 },
      { code: "recent_problem",        text: "Llanto reciente cedible",                      color: "GREEN",  ordinal: 5 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 6 },
    ],
  },
  { code: "ped_dyspnoea",           name: "Disnea en niño",                     category: "PEDIATRIC", isPediatric: true,
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "inadequate_breathing",  text: "Respiración inadecuada",                       color: "RED",    ordinal: 2 },
      { code: "low_spo2",              text: "SpO₂ < 92%",                                   color: "ORANGE", ordinal: 3 },
      { code: "stridor",               text: "Estridor en reposo",                           color: "ORANGE", ordinal: 4 },
      { code: "recent_problem",        text: "Problema respiratorio reciente",               color: "GREEN",  ordinal: 5 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 6 },
    ],
  },
  { code: "ped_shortness_breath",   name: "Dificultad respiratoria en niño",    category: "PEDIATRIC", isPediatric: true },
  { code: "ped_limb_problems",      name: "Problemas en extremidades (niño)",   category: "PEDIATRIC", isPediatric: true },
  { code: "ped_limping_child",      name: "Niño cojeando",                      category: "PEDIATRIC", isPediatric: true },
  { code: "ped_rash_child",         name: "Erupción / rash en niño",            category: "PEDIATRIC", isPediatric: true },
  { code: "ped_unwell_child",       name: "Niño enfermo (inespecífico)",        category: "PEDIATRIC", isPediatric: true,
    discriminators: [
      { code: "airway_compromise",     text: "Compromiso de vía aérea",                      color: "RED",    ordinal: 1 },
      { code: "shock",                 text: "Shock",                                        color: "RED",    ordinal: 2 },
      { code: "altered_consciousness", text: "Alteración de consciencia",                    color: "ORANGE", ordinal: 3 },
      { code: "high_fever",            text: "Fiebre > 39°C con mal aspecto",                color: "ORANGE", ordinal: 4 },
      { code: "moderate_fever",        text: "Fiebre 38-39°C",                               color: "YELLOW", ordinal: 5 },
      { code: "recent_problem",        text: "Problema reciente",                            color: "GREEN",  ordinal: 6 },
      { code: "no_risk",               text: "Sin signos de riesgo",                         color: "BLUE",   ordinal: 7 },
    ],
  },
  { code: "ped_worried_parent",     name: "Padre preocupado",                   category: "PEDIATRIC", isPediatric: true },
  { code: "ped_assault",            name: "Agresión pediátrica",                category: "PEDIATRIC", isPediatric: true },
  { code: "ped_fever",              name: "Fiebre pediátrica",                  category: "PEDIATRIC", isPediatric: true },
];

// ──────────────────────────── Lógica de seed ────────────────────────────

async function seedForOrganization(organizationId: string) {
  // Mapa color → TriageLevelId para esta organización.
  const levels = await prisma.triageLevel.findMany({
    where: { organizationId, active: true },
    select: { id: true, color: true },
  });
  if (levels.length === 0) {
    console.warn(
      `[seed-manchester] org=${organizationId}: sin TriageLevel configurado. Saltando.`,
    );
    return;
  }
  const levelIdByColor = new Map<TriageColor, string>();
  for (const l of levels) levelIdByColor.set(l.color, l.id);

  const blueId = levelIdByColor.get("BLUE");

  let createdFlowcharts = 0;
  let updatedFlowcharts = 0;
  let createdDiscriminators = 0;

  for (const fc of FLOWCHARTS) {
    const isPediatric = fc.isPediatric ?? false;
    const discList = fc.discriminators ?? GENERIC_DISCRIMINATORS;

    // Validamos que todos los colores de discriminadores existan como nivel.
    const missing = discList.find((d) => !levelIdByColor.has(d.color));
    if (missing) {
      console.warn(
        `[seed-manchester] org=${organizationId} flujograma=${fc.code}: ` +
          `falta TriageLevel ${missing.color}. Saltando.`,
      );
      continue;
    }

    const existing = await prisma.triageFlowchart.findUnique({
      where: { organizationId_code: { organizationId, code: fc.code } },
      select: { id: true, name: true, isPediatric: true },
    });

    let flowchartId: string;
    if (existing) {
      flowchartId = existing.id;
      if (existing.name !== fc.name || existing.isPediatric !== isPediatric) {
        await prisma.triageFlowchart.update({
          where: { id: flowchartId },
          data: {
            name: fc.name,
            isPediatric,
            defaultLevelId: blueId,
          },
        });
        updatedFlowcharts++;
      }
    } else {
      const created = await prisma.triageFlowchart.create({
        data: {
          organizationId,
          code: fc.code,
          name: fc.name,
          isPediatric,
          defaultLevelId: blueId,
        },
        select: { id: true },
      });
      flowchartId = created.id;
      createdFlowcharts++;
    }

    // Discriminadores — upsert por (flowchartId, ordinal).
    for (const d of discList) {
      const resultLevelId = levelIdByColor.get(d.color)!;
      await prisma.triageDiscriminator.upsert({
        where: { flowchartId_ordinal: { flowchartId, ordinal: d.ordinal } },
        update: {
          code: d.code,
          text: d.text,
          resultLevelId,
        },
        create: {
          flowchartId,
          ordinal: d.ordinal,
          code: d.code,
          text: d.text,
          resultLevelId,
        },
      });
      createdDiscriminators++;
    }
  }

  console.log(
    `[seed-manchester] org=${organizationId}: ` +
      `+${createdFlowcharts} nuevos / ${updatedFlowcharts} actualizados / ` +
      `${createdDiscriminators} discriminadores upsert.`,
  );
}

async function main() {
  console.log("[seed-manchester] Inicio");
  const orgs = await prisma.organization.findMany({
    where: { active: true },
    select: { id: true, tradeName: true },
  });
  if (orgs.length === 0) {
    console.warn("[seed-manchester] No hay organizaciones — ejecuta `pnpm db:seed` primero.");
    return;
  }
  for (const o of orgs) {
    console.log(`[seed-manchester] Procesando org "${o.tradeName}" (${o.id})`);
    await seedForOrganization(o.id);
  }
  console.log(`[seed-manchester] Listo. Total flujogramas catalogados: ${FLOWCHARTS.length}`);
}

main()
  .catch((err) => {
    console.error("[seed-manchester] ERROR", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Seed — 6 plantillas base de workflow (US.F2.2.09).
 *
 * Siembra en ece.workflow_plantilla con es_sistema = true.
 * Idempotente: ON CONFLICT (codigo) DO UPDATE.
 *
 * Uso: node packages/database/scripts/seed-workflow-templates.mjs
 */

import { PrismaClient } from "@his/database";

const prisma = new PrismaClient();

/** @typedef {{ codigo: string, nombre: string, es_inicial: boolean, es_final: boolean, orden: number }} EstadoSeed */
/** @typedef {{ origen_codigo: string, destino_codigo: string, accion: string, rol_codigo: string, requiere_firma: boolean }} TransicionSeed */

/**
 * @param {{ codigo: string, nombre: string, categoria: string, descripcion: string, estados: EstadoSeed[], transiciones: TransicionSeed[] }} plantilla
 */
async function upsertPlantilla(plantilla) {
  await prisma.$executeRaw`
    INSERT INTO ece.workflow_plantilla
      (codigo, nombre, categoria, descripcion, estados_seed, transiciones_seed, es_sistema, activo)
    VALUES
      (
        ${plantilla.codigo},
        ${plantilla.nombre},
        ${plantilla.categoria},
        ${plantilla.descripcion},
        ${JSON.stringify(plantilla.estados)}::jsonb,
        ${JSON.stringify(plantilla.transiciones)}::jsonb,
        true,
        true
      )
    ON CONFLICT (codigo) DO UPDATE SET
      nombre              = EXCLUDED.nombre,
      categoria           = EXCLUDED.categoria,
      descripcion         = EXCLUDED.descripcion,
      estados_seed        = EXCLUDED.estados_seed,
      transiciones_seed   = EXCLUDED.transiciones_seed,
      updated_at          = now()
  `;
  console.log(`  upserted: ${plantilla.codigo}`);
}

const plantillas = [
  // ── 1. HC Ambulatoria de primera vez ──────────────────────────────────────
  {
    codigo: "wf-hc-ambulatoria-primera",
    nombre: "HC Ambulatoria — Primera vez",
    categoria: "Ambulatorio",
    descripcion:
      "Flujo básico para atención ambulatoria de primera vez. Incluye triaje, consulta, diagnóstico y cierre.",
    estados: [
      { codigo: "REG",    nombre: "Registro / Admisión",       es_inicial: true,  es_final: false, orden: 0 },
      { codigo: "TRIAJE", nombre: "Triaje",                    es_inicial: false, es_final: false, orden: 1 },
      { codigo: "ESPERA", nombre: "En espera",                 es_inicial: false, es_final: false, orden: 2 },
      { codigo: "CONS",   nombre: "En consulta",               es_inicial: false, es_final: false, orden: 3 },
      { codigo: "DX",     nombre: "Diagnóstico y plan",        es_inicial: false, es_final: false, orden: 4 },
      { codigo: "ALTA",   nombre: "Alta ambulatoria",          es_inicial: false, es_final: true,  orden: 5 },
    ],
    transiciones: [
      { origen_codigo: "REG",    destino_codigo: "TRIAJE", accion: "Iniciar triaje",        rol_codigo: "ENF",  requiere_firma: false },
      { origen_codigo: "TRIAJE", destino_codigo: "ESPERA", accion: "Clasificar y esperar",  rol_codigo: "ENF",  requiere_firma: false },
      { origen_codigo: "ESPERA", destino_codigo: "CONS",   accion: "Llamar a consulta",     rol_codigo: "AC",   requiere_firma: false },
      { origen_codigo: "CONS",   destino_codigo: "DX",     accion: "Registrar diagnóstico", rol_codigo: "MC",   requiere_firma: false },
      { origen_codigo: "DX",     destino_codigo: "ALTA",   accion: "Dar alta",              rol_codigo: "MC",   requiere_firma: true  },
    ],
  },

  // ── 2. HC Ambulatoria subsecuente ─────────────────────────────────────────
  {
    codigo: "wf-hc-ambulatoria-subsecuente",
    nombre: "HC Ambulatoria — Subsecuente",
    categoria: "Ambulatorio",
    descripcion:
      "Flujo para control / seguimiento ambulatorio. Sin triaje obligatorio.",
    estados: [
      { codigo: "REG",   nombre: "Registro",             es_inicial: true,  es_final: false, orden: 0 },
      { codigo: "ESPERA",nombre: "En espera",            es_inicial: false, es_final: false, orden: 1 },
      { codigo: "CONS",  nombre: "Consulta de control",  es_inicial: false, es_final: false, orden: 2 },
      { codigo: "ALTA",  nombre: "Alta / Cierre",        es_inicial: false, es_final: true,  orden: 3 },
    ],
    transiciones: [
      { origen_codigo: "REG",    destino_codigo: "ESPERA", accion: "Asignar turno",         rol_codigo: "AC",  requiere_firma: false },
      { origen_codigo: "ESPERA", destino_codigo: "CONS",   accion: "Llamar a consulta",     rol_codigo: "AC",  requiere_firma: false },
      { origen_codigo: "CONS",   destino_codigo: "ALTA",   accion: "Completar consulta",    rol_codigo: "MC",  requiere_firma: true  },
    ],
  },

  // ── 3. Episodio hospitalario básico ───────────────────────────────────────
  {
    codigo: "wf-hospitalario-basico",
    nombre: "Episodio Hospitalario Básico",
    categoria: "Hospitalario",
    descripcion:
      "Flujo de internamiento estándar: admisión, evaluación, hospitalización, evolución y egreso.",
    estados: [
      { codigo: "ADMSN",  nombre: "Admisión hospitalaria",     es_inicial: true,  es_final: false, orden: 0 },
      { codigo: "EVAL",   nombre: "Evaluación inicial",        es_inicial: false, es_final: false, orden: 1 },
      { codigo: "HOSP",   nombre: "Hospitalizado",             es_inicial: false, es_final: false, orden: 2 },
      { codigo: "EVOL",   nombre: "En evolución",              es_inicial: false, es_final: false, orden: 3 },
      { codigo: "ALTA",   nombre: "Alta hospitalaria",         es_inicial: false, es_final: true,  orden: 4 },
    ],
    transiciones: [
      { origen_codigo: "ADMSN", destino_codigo: "EVAL",  accion: "Evaluación inicial",   rol_codigo: "MC",   requiere_firma: false },
      { origen_codigo: "EVAL",  destino_codigo: "HOSP",  accion: "Ingresar a sala",      rol_codigo: "MC",   requiere_firma: true  },
      { origen_codigo: "HOSP",  destino_codigo: "EVOL",  accion: "Registrar evolución",  rol_codigo: "ENF",  requiere_firma: false },
      { origen_codigo: "EVOL",  destino_codigo: "HOSP",  accion: "Continuar internamiento", rol_codigo: "MC", requiere_firma: false },
      { origen_codigo: "EVOL",  destino_codigo: "ALTA",  accion: "Ordenar egreso",       rol_codigo: "MC",   requiere_firma: true  },
    ],
  },

  // ── 4. Ruta quirúrgica electiva ───────────────────────────────────────────
  {
    codigo: "wf-cirugia-electiva",
    nombre: "Ruta Quirúrgica Electiva",
    categoria: "Quirúrgico",
    descripcion:
      "Flujo completo: pre-operatorio, ingreso a quirófano, acto quirúrgico, URPA y alta.",
    estados: [
      { codigo: "PREOP",  nombre: "Pre-operatorio",       es_inicial: true,  es_final: false, orden: 0 },
      { codigo: "QX",     nombre: "En quirófano",         es_inicial: false, es_final: false, orden: 1 },
      { codigo: "URPA",   nombre: "Recuperación URPA",    es_inicial: false, es_final: false, orden: 2 },
      { codigo: "SALA",   nombre: "En sala post-QX",      es_inicial: false, es_final: false, orden: 3 },
      { codigo: "ALTA",   nombre: "Alta quirúrgica",      es_inicial: false, es_final: true,  orden: 4 },
    ],
    transiciones: [
      { origen_codigo: "PREOP", destino_codigo: "QX",   accion: "Ingresar a quirófano", rol_codigo: "MC",  requiere_firma: true  },
      { origen_codigo: "QX",    destino_codigo: "URPA", accion: "Trasladar a URPA",     rol_codigo: "ENF", requiere_firma: false },
      { origen_codigo: "URPA",  destino_codigo: "SALA", accion: "Traslado a sala",      rol_codigo: "ENF", requiere_firma: false },
      { origen_codigo: "SALA",  destino_codigo: "ALTA", accion: "Ordenar alta",         rol_codigo: "MC",  requiere_firma: true  },
    ],
  },

  // ── 5. Triage Manchester ──────────────────────────────────────────────────
  {
    codigo: "wf-triage-manchester",
    nombre: "Triage Manchester Emergencias",
    categoria: "Emergencia",
    descripcion:
      "Flujo de triaje en emergencias usando escala Manchester (niveles I-V).",
    estados: [
      { codigo: "REG",   nombre: "Recepción / Registro",      es_inicial: true,  es_final: false, orden: 0 },
      { codigo: "TRIAGE",nombre: "Clasificación Manchester",  es_inicial: false, es_final: false, orden: 1 },
      { codigo: "NIV1",  nombre: "Nivel I — Resucitación",    es_inicial: false, es_final: false, orden: 2 },
      { codigo: "NIV2",  nombre: "Nivel II — Emergente",      es_inicial: false, es_final: false, orden: 2 },
      { codigo: "NIV3",  nombre: "Nivel III — Urgente",       es_inicial: false, es_final: false, orden: 2 },
      { codigo: "ALTA",  nombre: "Alta o transferencia",      es_inicial: false, es_final: true,  orden: 3 },
    ],
    transiciones: [
      { origen_codigo: "REG",    destino_codigo: "TRIAGE", accion: "Iniciar clasificación", rol_codigo: "ENF", requiere_firma: false },
      { origen_codigo: "TRIAGE", destino_codigo: "NIV1",   accion: "Clasificar Nivel I",    rol_codigo: "ENF", requiere_firma: false },
      { origen_codigo: "TRIAGE", destino_codigo: "NIV2",   accion: "Clasificar Nivel II",   rol_codigo: "ENF", requiere_firma: false },
      { origen_codigo: "TRIAGE", destino_codigo: "NIV3",   accion: "Clasificar Nivel III",  rol_codigo: "ENF", requiere_firma: false },
      { origen_codigo: "NIV1",   destino_codigo: "ALTA",   accion: "Egreso/transferencia",  rol_codigo: "MC",  requiere_firma: true  },
      { origen_codigo: "NIV2",   destino_codigo: "ALTA",   accion: "Egreso/transferencia",  rol_codigo: "MC",  requiere_firma: true  },
      { origen_codigo: "NIV3",   destino_codigo: "ALTA",   accion: "Egreso/transferencia",  rol_codigo: "MC",  requiere_firma: true  },
    ],
  },

  // ── 6. Consentimiento informado NTEC ─────────────────────────────────────
  {
    codigo: "wf-consentimiento-ntec",
    nombre: "Consentimiento Informado NTEC",
    categoria: "Hospitalario",
    descripcion:
      "Flujo de firma de consentimiento médico informado (Art. 40 NTEC). Doble firma paciente+MC.",
    estados: [
      { codigo: "PEND",    nombre: "Pendiente de firma",     es_inicial: true,  es_final: false, orden: 0 },
      { codigo: "INFORM",  nombre: "Información brindada",   es_inicial: false, es_final: false, orden: 1 },
      { codigo: "FIRMADO", nombre: "Consentimiento firmado", es_inicial: false, es_final: true,  orden: 2 },
      { codigo: "RECHAZ",  nombre: "Consentimiento rechazado", es_inicial: false, es_final: true, orden: 2 },
    ],
    transiciones: [
      { origen_codigo: "PEND",   destino_codigo: "INFORM",  accion: "Brindar información",     rol_codigo: "MC",  requiere_firma: false },
      { origen_codigo: "INFORM", destino_codigo: "FIRMADO", accion: "Firma paciente y médico", rol_codigo: "MC",  requiere_firma: true  },
      { origen_codigo: "INFORM", destino_codigo: "RECHAZ",  accion: "Paciente rechaza",        rol_codigo: "MC",  requiere_firma: true  },
    ],
  },
];

async function main() {
  console.log("Sembrando plantillas de workflow...");
  for (const p of plantillas) {
    await upsertPlantilla(p);
  }
  console.log(`Done. ${plantillas.length} plantillas sembradas.`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());

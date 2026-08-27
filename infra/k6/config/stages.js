// config/stages.js — Perfiles de VUs/duración por escenario, REQ-HIS-PERF-001 §8.
//
// Todo sobreescribible por env var para calibrar sin tocar código, ej.:
//   k6 run -e HARD_VU_CEILING=300 scenarios/c-estres.js
//
// Techo absoluto: el REQ original (§8-C/D) habla de "romper el sistema" /
// picos de hasta 500 VUs. Edwin fijó 1500 VUs como techo de exploración para
// esta corrida (2026-08-17, instrucción directa) — HARD_VU_CEILING lo aplica
// a TODOS los escenarios vía `cap()`, así que subir el número en un solo
// lugar no puede hacer que un escenario se dispare por encima del techo
// acordado.

function envInt(name, def) {
  const v = __ENV[name];
  const n = v ? parseInt(v, 10) : def;
  return Number.isFinite(n) ? n : def;
}

export const HARD_VU_CEILING = envInt('HARD_VU_CEILING', 1500);

function cap(vus) {
  return Math.min(vus, HARD_VU_CEILING);
}

// A) Latencia (baseline) — carga constante baja, 10-20 VUs, ~5 min.
export const stagesBaseline = [
  { duration: '30s', target: cap(envInt('VUS_A', 15)) },
  { duration: '5m', target: cap(envInt('VUS_A', 15)) },
  { duration: '30s', target: 0 },
];

// B) Concurrencia/Carga — ramp-up escalonado 50→100→200→400 con mesetas 3-5min.
export const stagesConcurrency = [
  { duration: '1m', target: cap(50) },
  { duration: '4m', target: cap(50) },
  { duration: '1m', target: cap(100) },
  { duration: '4m', target: cap(100) },
  { duration: '1m', target: cap(200) },
  { duration: '4m', target: cap(200) },
  { duration: '1m', target: cap(400) },
  { duration: '4m', target: cap(400) },
  { duration: '2m', target: 0 },
];

// C) Estrés — rampa agresiva hasta el techo (1500 VUs, Edwin), buscando el
// knee point. Se sostiene en el techo unos minutos para observar si colapsa
// o degrada controladamente, luego se baja a 0 para medir recuperación.
export const stagesStress = [
  { duration: '1m', target: cap(200) },
  { duration: '2m', target: cap(500) },
  { duration: '2m', target: cap(900) },
  { duration: '2m', target: cap(1200) },
  { duration: '2m', target: cap(1500) },
  { duration: '3m', target: cap(1500) },
  { duration: '2m', target: 0 },
];

// D) Spike — salto súbito 20→500 VUs en <30s simulando avalancha de admisiones.
export const stagesSpike = [
  { duration: '30s', target: cap(20) },
  { duration: '20s', target: cap(Math.min(500, HARD_VU_CEILING)) },
  { duration: '3m', target: cap(Math.min(500, HARD_VU_CEILING)) },
  { duration: '20s', target: cap(20) },
  { duration: '2m', target: cap(20) },
  { duration: '30s', target: 0 },
];

// E) Soak/Endurance — carga moderada sostenida. El REQ original pide 1-2h;
// Edwin acortó a 20-30 min (instrucción directa 2026-08-17) — suficiente
// para detectar fugas de memoria/agotamiento de pool en un ambiente Dev/QA,
// no se busca certificar 2h de estabilidad continua en esta corrida.
export const stagesSoak = [
  { duration: '1m', target: cap(envInt('VUS_SOAK', 80)) },
  { duration: `${envInt('SOAK_MINUTES', 25)}m`, target: cap(envInt('VUS_SOAK', 80)) },
  { duration: '1m', target: 0 },
];

// F) Resiliencia/DoS — carga baja y sostenida para validar que el rate
// limit responde consistente (no para tumbar nada). El PICO de ráfaga que
// intenta cruzar el umbral vive en el propio scenario (f-resiliencia-dos.js)
// como un bloque corto de llamadas seriadas por VU, no como stage de rampa.
export const stagesResilience = [
  { duration: '30s', target: cap(10) },
  { duration: '2m', target: cap(10) },
  { duration: '30s', target: 0 },
];

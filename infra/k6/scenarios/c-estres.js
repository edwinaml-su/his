// scenarios/c-estres.js — REQ-HIS-PERF-001 §8-C.
//
// Rampa agresiva hasta el techo (1500 VUs, instrucción directa de Edwin
// 2026-08-17 — el REQ original hablaba de "romper el sistema" sin techo
// fijo). Objetivo: encontrar el *knee point* (VUs/RPS donde el sistema
// colapsa), el primer componente en fallar, y el comportamiento de
// recuperación al bajar la carga a 0.
//
// abortOnFail=false a propósito: este escenario ESPERA que los thresholds
// se rompan en algún punto de la rampa — eso es la señal que se está
// buscando, no un fallo del test. El knee point exacto (en qué VU/tiempo
// empezó la degradación) se identifica post-corrida inspeccionando la
// serie temporal del JSON exportado (reports/), no en tiempo real dentro
// del script.
//
// Uso:
//   k6 run -e BASE_URL=http://localhost:3000 scenarios/c-estres.js
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { assertLocalTarget } from '../lib/guard.js';
import { stagesStress, HARD_VU_CEILING } from '../config/stages.js';
import { stressThresholds } from '../config/slos.js';
import { buildAuthedContext } from '../lib/setup.js';
import { mixedFlow } from '../lib/flows.js';

assertLocalTarget(BASE_URL);

const thresholds = stressThresholds();
// Marcar cada threshold como no-abortivo: la corrida debe completar toda la
// rampa (incluida la fase de recuperación) aunque el SLO se rompa a mitad
// de camino — abortar temprano destruiría justamente el dato que interesa
// (comportamiento de recuperación).
for (const key of Object.keys(thresholds)) {
  thresholds[key] = thresholds[key].map((t) => ({ threshold: t, abortOnFail: false }));
}

export const options = {
  stages: stagesStress,
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

console.log(`[c-estres] Techo de VUs para esta corrida: ${HARD_VU_CEILING} (HARD_VU_CEILING).`);

export function setup() {
  return buildAuthedContext();
}

export default function (ctx) {
  mixedFlow(ctx, __VU * 1000 + __ITER);
  // Sin sleep / think-time deliberadamente reducido — el objetivo es
  // presionar, no simular un usuario pausado.
  sleep(0.2);
}

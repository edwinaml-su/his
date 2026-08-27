// scenarios/b-concurrencia-carga.js — REQ-HIS-PERF-001 §8-B.
//
// Ramp-up escalonado 50→100→200→400 VUs con mesetas de 3-5min (capado por
// HARD_VU_CEILING, ver config/stages.js). Objetivo: identificar el escalón
// donde p95 o la tasa de error empiezan a degradarse — leer el reporte JSON/
// HTML por meseta (stage), no solo el agregado de toda la corrida.
//
// Uso:
//   k6 run -e BASE_URL=http://localhost:3000 scenarios/b-concurrencia-carga.js
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { assertLocalTarget } from '../lib/guard.js';
import { stagesConcurrency } from '../config/stages.js';
import { mixedReadWriteThresholds } from '../config/slos.js';
import { buildAuthedContext } from '../lib/setup.js';
import { mixedFlow } from '../lib/flows.js';

assertLocalTarget(BASE_URL);

export const options = {
  stages: stagesConcurrency,
  thresholds: mixedReadWriteThresholds(),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return buildAuthedContext();
}

export default function (ctx) {
  mixedFlow(ctx, __VU * 1000 + __ITER);
  sleep(0.5 + Math.random() * 1.5);
}

// scenarios/d-spike.js — REQ-HIS-PERF-001 §8-D.
//
// Salto súbito 20→500 VUs en <30s (simula una avalancha de admisiones, ej.
// evento masivo / desastre). Mide latencia durante el pico y tiempo de
// recuperación al bajar de nuevo a carga baja. abortOnFail=false por la
// misma razón que en C — nos interesa ver el pico Y la recuperación, no
// cortar la corrida en el primer breach de SLO.
//
// Uso:
//   k6 run -e BASE_URL=http://localhost:3000 scenarios/d-spike.js
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { assertLocalTarget } from '../lib/guard.js';
import { stagesSpike } from '../config/stages.js';
import { stressThresholds } from '../config/slos.js';
import { buildAuthedContext } from '../lib/setup.js';
import { mixedFlow } from '../lib/flows.js';

assertLocalTarget(BASE_URL);

const thresholds = stressThresholds();
for (const key of Object.keys(thresholds)) {
  thresholds[key] = thresholds[key].map((t) => ({ threshold: t, abortOnFail: false }));
}

export const options = {
  stages: stagesSpike,
  thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return buildAuthedContext();
}

export default function (ctx) {
  mixedFlow(ctx, __VU * 1000 + __ITER);
  sleep(0.3 + Math.random() * 0.7);
}

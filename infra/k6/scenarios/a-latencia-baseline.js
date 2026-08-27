// scenarios/a-latencia-baseline.js — REQ-HIS-PERF-001 §8-A.
//
// Carga constante baja (10-20 VUs, ~5min). Establece la línea base de
// p50/p90/p95/p99 por endpoint y throughput, SIN presión de concurrencia —
// es el punto de comparación para B/C/D/E.
//
// Uso:
//   k6 run -e BASE_URL=http://localhost:3000 scenarios/a-latencia-baseline.js
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { assertLocalTarget } from '../lib/guard.js';
import { stagesBaseline } from '../config/stages.js';
import { mixedReadWriteThresholds } from '../config/slos.js';
import { buildAuthedContext } from '../lib/setup.js';
import { mixedFlow } from '../lib/flows.js';

assertLocalTarget(BASE_URL); // ── guard anti-producción (§11/§12) ──

export const options = {
  stages: stagesBaseline,
  thresholds: mixedReadWriteThresholds(),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return buildAuthedContext();
}

export default function (ctx) {
  mixedFlow(ctx, __VU * 1000 + __ITER);
  sleep(1 + Math.random() * 2); // think time — comportamiento de usuario real, no bucle caliente.
}

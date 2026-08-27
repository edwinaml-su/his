// scenarios/e-soak.js — REQ-HIS-PERF-001 §8-E.
//
// Carga moderada sostenida. El REQ original pide 1-2h; Edwin acortó a
// 20-30 min (instrucción directa 2026-08-17, ver config/stages.js) —
// suficiente para asomar una tendencia de fuga de memoria/agotamiento de
// pool en Dev/QA, no para certificar 2h de estabilidad continua.
//
// LO QUE k6 PUEDE MEDIR ACÁ: degradación de latencia/error-rate en el
// tiempo (comparar el primer y el último 10% de la corrida).
// LO QUE k6 NO PUEDE MEDIR: memoria/CPU del proceso Node ni conexiones
// abiertas del pool de Prisma — eso requiere observación externa en
// paralelo (Task Manager / `docker stats <container>` si la app corre en
// Docker, o `SELECT count(*) FROM pg_stat_activity` contra Postgres cada
// pocos minutos). Correlacionar manualmente con los timestamps del JSON
// exportado.
//
// Uso:
//   k6 run -e BASE_URL=http://localhost:3000 -e SOAK_MINUTES=25 scenarios/e-soak.js
import { sleep } from 'k6';
import { BASE_URL } from '../lib/config.js';
import { assertLocalTarget } from '../lib/guard.js';
import { stagesSoak } from '../config/stages.js';
import { mixedReadWriteThresholds } from '../config/slos.js';
import { buildAuthedContext } from '../lib/setup.js';
import { mixedFlow } from '../lib/flows.js';

assertLocalTarget(BASE_URL);

export const options = {
  stages: stagesSoak,
  thresholds: mixedReadWriteThresholds(),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return buildAuthedContext();
}

export default function (ctx) {
  mixedFlow(ctx, __VU * 1000 + __ITER);
  sleep(1 + Math.random() * 2);
}

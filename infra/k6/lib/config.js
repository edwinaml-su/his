// lib/config.js — configuración central k6 para HIS.
// Todos los parámetros se pueden sobreescribir via env vars al invocar k6.
//
// Uso:
//   k6 run -e BASE_URL=https://staging.his.com -e VUS=10 scenarios/03-triage-queue.js

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// URL base de la API Supabase (necesaria para auth REST).
// En producción: https://ejacvsgbewcerxtjtwto.supabase.co
export const SUPABASE_URL = __ENV.SUPABASE_URL || 'http://localhost:54321';

export const VUS = parseInt(__ENV.VUS || '5', 10);
export const DURATION = __ENV.DURATION || '30s';

// Think time entre requests (segundos) — simula comportamiento de usuario real.
export const THINK_TIME_MIN = 1;
export const THINK_TIME_MAX = 3;

// Thresholds por defecto — conservadores. El objetivo es detectar regresiones,
// no estresar el sistema. Sobreescribir por scenario si tiene SLO propio.
export const DEFAULT_THRESHOLDS = {
  // p95 < 1500ms, p99 < 3000ms para endpoints generales
  http_req_duration: ['p(95) < 1500', 'p(99) < 3000'],
  // Menos del 1% de requests deben fallar (status >= 400 o error de red)
  http_req_failed: ['rate < 0.01'],
  // Más del 99% de checks de negocio deben pasar
  checks: ['rate > 0.99'],
};

// Thresholds más estrictos para el flujo de autenticación (UX crítico).
export const AUTH_THRESHOLDS = {
  http_req_duration: ['p(95) < 800', 'p(99) < 2000'],
  http_req_failed: ['rate < 0.01'],
  checks: ['rate > 0.99'],
};

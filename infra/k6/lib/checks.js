// lib/checks.js — helpers de verificación reutilizables para k6.
//
// Uso:
//   import { checkOk, checkStatusCode, checkBodyContains } from '../lib/checks.js';

import { check } from 'k6';

/**
 * checkOk — verifica que el response sea HTTP 200 y dure < 2000ms.
 * Caso base para GETs simples.
 */
export function checkOk(res) {
  return check(res, {
    'status 200': (r) => r.status === 200,
    'respuesta < 2s': (r) => r.timings.duration < 2000,
  });
}

/**
 * checkStatusCode — verifica un status code específico.
 *
 * @param {Object} res       — response de k6
 * @param {number} expected  — código HTTP esperado
 */
export function checkStatusCode(res, expected) {
  return check(res, {
    [`status ${expected}`]: (r) => r.status === expected,
  });
}

/**
 * checkBodyContains — verifica que el body del response contenga una cadena.
 *
 * @param {Object} res        — response de k6
 * @param {string} fragment   — string que debe aparecer en el body
 */
export function checkBodyContains(res, fragment) {
  return check(res, {
    [`body contiene "${fragment}"`]: (r) => r.body && r.body.indexOf(fragment) !== -1,
  });
}

/**
 * checkResponseTime — verifica que la duración sea menor a maxMs.
 *
 * @param {Object} res    — response de k6
 * @param {number} maxMs  — máximo de milisegundos permitidos
 */
export function checkResponseTime(res, maxMs) {
  return check(res, {
    [`respuesta < ${maxMs}ms`]: (r) => r.timings.duration < maxMs,
  });
}

/**
 * checkTrpcOk — verifica que un response de tRPC no traiga error.
 * tRPC batch devuelve array; tRPC simple devuelve { result: { data: ... } }.
 */
export function checkTrpcOk(res) {
  return check(res, {
    'status 200': (r) => r.status === 200,
    'sin error tRPC': (r) => {
      try {
        const body = JSON.parse(r.body);
        // tRPC batch: array
        if (Array.isArray(body)) {
          return body.every((item) => !item.error);
        }
        // tRPC single: { result: ... }
        return !body.error;
      } catch (_) {
        return false;
      }
    },
  });
}

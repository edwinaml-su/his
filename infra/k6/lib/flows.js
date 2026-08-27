// lib/flows.js — Flujos clínicos §6 REQ-HIS-PERF-001, sobre rutas tRPC REALES.
//
// Los nombres de procedure y campos de input se verificaron LEYENDO el
// código fuente (packages/trpc/src/routers/*.ts,
// packages/contracts/src/schemas/*.ts) — no son inventados. Lo que NO se
// verificó es la ejecución end-to-end (ver docs/performance/
// REQ-HIS-PERF-001-resultados.md, "qué no se pudo ejecutar"): Docker Desktop
// no logró levantar Postgres local en esta sesión, así que ningún flujo
// corrió contra una app real.
//
// Prerrequisitos de datos que este archivo ASUME que existen en la BD
// (sembrados vía packages/database/scripts/seed-*.mjs, NUNCA con datos
// reales — Decreto 143/144):
//   - catálogo `biologicalSex` con al menos 1 fila activa (seed base).
//   - al menos 1 episodio hospitalario activo para los flujos 2/3/5
//     (packages/database/scripts/seed-demo-hospitalario.mjs) — si no hay
//     ninguno, esos flujos se OMITEN con un warning en vez de fallar el
//     check silenciosamente (ver ctx.sampleEpisodioId === null abajo).
//
// `ctx` (armado en cada scenario, típicamente en setup()) trae:
//   { headers, biologicalSexId, samplePatientId, sampleEpisodioId, physicianUserId }
import { trpcQuery, trpcMutation, checkTrpcResult } from './trpc.js';
import {
  syntheticDUI,
  syntheticBirthDate,
  syntheticPatientName,
  syntheticVitals,
  syntheticSoapNote,
  syntheticIndicacion,
} from './data.js';

/** Flujo 1 — Admisión de paciente (ESCRITURA). CC-0002/CC-0008b/CC-0014. */
export function flowAdmision(ctx, seed) {
  const name = syntheticPatientName(seed);
  const input = {
    firstName: name.firstName,
    lastName: name.lastName,
    secondLastName: name.secondLastName,
    birthDate: syntheticBirthDate(seed),
    biologicalSexId: ctx.biologicalSexId,
    traeDocumento: true,
    documentType: 'DUI',
    documentNumber: syntheticDUI(seed),
    isUnknown: false,
  };
  const result = trpcMutation('patient.create', input, ctx.headers, { name: 'patient.create' });
  checkTrpcResult(result, 'patient.create');
  return result;
}

/** Flujo 6 — Dashboard de flujo de pacientes (SOLO LECTURA). */
export function flowDashboard(ctx) {
  const bedMap = trpcQuery('census.bedMap', {}, ctx.headers, { name: 'census.bedMap' });
  checkTrpcResult(bedMap, 'census.bedMap');
  const occ = trpcQuery('census.occupancyStats', {}, ctx.headers, { name: 'census.occupancyStats' });
  checkTrpcResult(occ, 'census.occupancyStats');
  return [bedMap, occ];
}

/** Flujo 4 — Historia Clínica, módulos lab/imagen (LECTURA PESADA). */
export function flowHistoriaClinica(ctx) {
  if (!ctx.samplePatientId) {
    return null; // sin paciente sembrado — ver nota de prerrequisitos arriba.
  }
  const result = trpcQuery(
    'patientHistory.get',
    { patientId: ctx.samplePatientId },
    ctx.headers,
    { name: 'patientHistory.get' },
  );
  checkTrpcResult(result, 'patientHistory.get');
  return result;
}

/** Flujo 3 — Signos Vitales (ALTA CONCURRENCIA, ESCRITURA). CC-0012. */
export function flowSignosVitales(ctx, seed) {
  if (!ctx.sampleEpisodioId) return null;
  const v = syntheticVitals(seed);
  const input = {
    episodioId: ctx.sampleEpisodioId,
    presionSistolica: v.presionSistolica,
    presionDiastolica: v.presionDiastolica,
    frecuenciaCardiaca: v.frecuenciaCardiaca,
    frecuenciaRespiratoria: v.frecuenciaRespiratoria,
    temperatura: v.temperatura,
    saturacionO2: v.saturacionO2,
    escalaDolor: v.escalaDolor,
  };
  const result = trpcMutation('eceSignosVitales.create', input, ctx.headers, { name: 'eceSignosVitales.create' });
  checkTrpcResult(result, 'eceSignosVitales.create');
  return result;
}

/** Flujo 2 — Evolución Médica SOAP + contexto de órdenes (ESCRITURA PESADA). */
export function flowEvolucionMedica(ctx, seed) {
  if (!ctx.sampleEpisodioId) return null;
  const soap = syntheticSoapNote(seed);
  const input = { episodioId: ctx.sampleEpisodioId, fecha: new Date().toISOString(), ...soap };
  const result = trpcMutation('eceEvolucion.create', input, ctx.headers, { name: 'eceEvolucion.create' });
  checkTrpcResult(result, 'eceEvolucion.create');
  return result;
}

/** Flujo 5 — Nuevas Indicaciones: autocomplete (lectura) + crear (escritura). */
export function flowIndicaciones(ctx, seed) {
  if (!ctx.sampleEpisodioId) return null;
  // Lectura: catálogo usado por el autocomplete farmacológico del formulario.
  const auto = trpcQuery(
    'catalog.list',
    { catalog: 'medicalSpecialty', activeOnly: true },
    ctx.headers,
    { name: 'catalog.list(autocomplete)' },
  );
  checkTrpcResult(auto, 'catalog.list(autocomplete)');

  // Escritura: crear indicación (tipo MEDICAMENTO, vía oral, c/8h — valores
  // fijos válidos del enum, ver ece/indicaciones-medicas.router.ts).
  const input = {
    episodioId: ctx.sampleEpisodioId,
    medicoPrescriptor: ctx.physicianUserId,
    items: [
      {
        tipo: 'MEDICAMENTO',
        descripcion: syntheticIndicacion(seed),
        via: 'ORAL',
        frecuencia: 'Q8H',
      },
    ],
  };
  const result = trpcMutation('eceIndicaciones.create', input, ctx.headers, { name: 'eceIndicaciones.create' });
  checkTrpcResult(result, 'eceIndicaciones.create');
  return [auto, result];
}

/**
 * mixedFlow — mezcla aproximada 70/30 lectura/escritura (§6) contando
 * sub-llamadas por flujo (dashboard=2 lecturas, indicaciones=1 lectura+1
 * escritura). No es un 70/30 exacto por diseño — es una aproximación
 * razonable, no una garantía matemática; si hace falta una proporción
 * exacta, contar `op:read` vs `op:write` en el resumen k6 y ajustar los
 * pesos de abajo.
 */
export function mixedFlow(ctx, seed) {
  const r = Math.abs(seed) % 10;
  if (r < 3) return flowDashboard(ctx); // 30% — lectura (2 sub-llamadas)
  if (r < 5) return flowHistoriaClinica(ctx); // 20% — lectura
  if (r < 7) return flowAdmision(ctx, seed); // 20% — escritura
  if (r < 8) return flowSignosVitales(ctx, seed); // 10% — escritura
  if (r < 9) return flowEvolucionMedica(ctx, seed); // 10% — escritura
  return flowIndicaciones(ctx, seed); // 10% — lectura+escritura
}

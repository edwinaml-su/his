// lib/data.js — Generador de datos 100% SINTÉTICOS para la suite A-F.
//
// Decreto 143/144 (El Salvador, protección de datos): cero PII/PHI real.
// Todos los nombres, documentos y notas clínicas de este archivo son
// fabricados de forma determinista a partir de un `seed` numérico — no hay
// ninguna fuente de datos reales involucrada.
//
// Expediente: el formato real {NNN}{AA}{NNNNN} (CC-0014, ver
// packages/trpc/src/lib/expediente-numbering.ts) lo asigna el SERVIDOR
// (fn_next_expediente) dentro de patient.create — este archivo no lo
// envía como input, solo lo usa para generar un DUI/fecha de nacimiento
// coherentes en las etiquetas de log/reporte.

const NOMBRES = [
  'MARIA', 'JOSE', 'ANA', 'CARLOS', 'LUCIA', 'JORGE', 'SOFIA', 'LUIS', 'ELENA', 'DIEGO',
  'PAOLA', 'MIGUEL', 'GABRIELA', 'RICARDO', 'VALERIA', 'FERNANDO', 'DANIELA', 'ROBERTO', 'CAMILA', 'ANDRES',
];
const APELLIDOS = [
  'HERNANDEZ', 'MARTINEZ', 'LOPEZ', 'GONZALEZ', 'RODRIGUEZ', 'PEREZ', 'GARCIA', 'FLORES',
  'RAMIREZ', 'TORRES', 'VASQUEZ', 'CASTRO', 'MORALES', 'CRUZ', 'ORTIZ', 'REYES', 'GOMEZ', 'DIAZ', 'ROMERO', 'MEJIA',
];

function pick(arr, seed) {
  return arr[((seed % arr.length) + arr.length) % arr.length];
}

/**
 * syntheticDUI — DUI sintético con dígito verificador VÁLIDO.
 * Mismo algoritmo que packages/contracts/src/validators/index.ts
 * (validateDUI) — pesos 9..2 sobre 8 dígitos, verificador = (10 - suma%10)%10.
 * Necesario: patientCreateSchema valida el DUI con ese mismo algoritmo, un
 * DUI con checksum inválido haría fallar el 100% de los patient.create.
 */
export function syntheticDUI(seed) {
  const n = Math.abs(seed) % 89999999;
  const body = String(10000000 + n).padStart(8, '0');
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(body[i]) * (10 - (i + 1));
  }
  let check = 10 - (sum % 10);
  if (check === 10) check = 0;
  return `${body}${check}`;
}

/** Fecha de nacimiento sintética entre 1940 y 2023 (mezcla adulto/pediátrico). */
export function syntheticBirthDate(seed) {
  const s = Math.abs(seed);
  const year = 1940 + (s % 84);
  const month = 1 + (s % 12);
  const day = 1 + (s % 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function syntheticPatientName(seed) {
  const s = Math.abs(seed);
  return {
    firstName: pick(NOMBRES, s),
    lastName: pick(APELLIDOS, s + 7),
    secondLastName: pick(APELLIDOS, s + 13),
  };
}

/** Vector de signos vitales en rango fisiológico normal — evita disparar
 *  alertas clínicas (medication-window / farmacovigilancia) cuyo I/O extra
 *  no es lo que este escenario mide. */
export function syntheticVitals(seed) {
  const s = Math.abs(seed);
  return {
    presionSistolica: 100 + (s % 30),
    presionDiastolica: 60 + (s % 20),
    frecuenciaCardiaca: 60 + (s % 40),
    frecuenciaRespiratoria: 12 + (s % 8),
    temperatura: Math.round((36 + (s % 15) / 10) * 10) / 10,
    saturacionO2: 94 + (s % 6),
    escalaDolor: s % 11,
  };
}

/** Nota SOAP sintética — nunca contenido clínico real, marcada explícitamente. */
export function syntheticSoapNote(seed) {
  return {
    soapSubjetivo: `[SINTETICO k6] Paciente refiere síntoma de prueba #${seed}. Dato de carga, no representa persona real.`,
    soapObjetivo: `[SINTETICO k6] Exploración física simulada #${seed}. Signos dentro de parámetros de prueba.`,
    soapAnalisis: `[SINTETICO k6] Impresión diagnóstica de prueba #${seed} — no representa condición clínica real.`,
    soapPlan: `[SINTETICO k6] Plan de prueba #${seed}: control en próxima corrida de carga k6.`,
  };
}

/** Descripción de indicación médica sintética. */
export function syntheticIndicacion(seed) {
  return `[SINTETICO k6] Indicación de prueba #${seed} — dato de carga, no representa una orden clínica real.`;
}

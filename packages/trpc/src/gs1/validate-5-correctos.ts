/**
 * Helper puro — Validación 5 correctos GS1 para administración bedside.
 *
 * Diseñado para correr en el servidor antes de persistir una administración.
 * Sin dependencia de contexto tRPC; recibe la PrismaClient (o tx) externamente
 * para que el caller pueda envolverlo dentro de su transacción.
 *
 * Tablas raw SQL consultadas (schema ece):
 *   ece.gs1_gtin       — catálogo GTIN: gtin VARCHAR(14), vencimiento DATE, lote TEXT, activo BOOL
 *   ece.gsrn_catalogo  — catálogo GSRN: gsrn VARCHAR(18), referencia_id UUID (paciente.id | personal_salud.id), activo BOOL
 *   ece.indicacion_item — dosis TEXT, via TEXT
 *   ece.indicaciones_medicas — hora_inicio TIMESTAMPTZ (hora programada del primer ciclo)
 *
 * Reglas implementadas:
 *   1. Paciente   — si pacienteGsrn provisto, checksum GS1-18 + match con pacienteId
 *   2. Medicamento — GTIN existe en ece.gs1_gtin, activo, lote coincide y expiry > now
 *   3. Dosis      — parse "500mg" → número+unidad, compara contra indicacion_item.dosis (±10%)
 *   4. Via        — match exacto case-insensitive con indicacion_item.via
 *   5. Hora       — horaAdministrada dentro de ±30 min de hora programada en indicacion_item
 *
 * Nota: el campo en el blueprint es `ece.gs1_gtin` (spec del usuario). Si el nombre
 * de tabla cambia al aplicar la migración, solo hay que actualizar las queries aquí.
 */

import type { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface Validate5CorrectosInput {
  gtin: string;
  lote: string;
  expiry: Date;
  pacienteId: string;
  pacienteGsrn?: string;
  dosis: string;
  via: string;
  hora: Date;
  /** UUID del indicacion_item a validar */
  indicacionItemId: string;
  /** UUID del episodio (para el match GSRN → paciente) */
  episodioId?: string;
}

export interface ValidacionError {
  campo: "paciente" | "medicamento" | "dosis" | "via" | "hora";
  mensaje: string;
  severity: "error" | "warning";
}

export interface Validate5CorrectosResult {
  valid: boolean;
  errores: ValidacionError[];
  correctos: {
    paciente: boolean;
    medicamento: boolean;
    dosis: boolean;
    via: boolean;
    hora: boolean;
  };
}

// ---------------------------------------------------------------------------
// Checksum GS1-18 (GSRN / SSCC)
// Algoritmo: suma alternando pesos 3 y 1 de dcha a izq (sin último dígito),
// complemento a 10 del módulo 10.
// ---------------------------------------------------------------------------

function gsrnChecksumValid(gsrn: string): boolean {
  if (!/^\d{18}$/.test(gsrn)) return false;
  const digits = gsrn.split("").map(Number);
  // Los 17 primeros; el 18.º es el check digit
  const weights = [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3];
  const sum = digits
    .slice(0, 17)
    .reduce((acc, d, i) => acc + d * weights[i]!, 0);
  const check = (10 - (sum % 10)) % 10;
  return check === digits[17];
}

// ---------------------------------------------------------------------------
// Parser de dosis: "500mg" → { valor: 500, unidad: "mg" }
// ---------------------------------------------------------------------------

interface DosisParsed {
  valor: number;
  unidad: string;
}

function parseDosis(dosis: string): DosisParsed | null {
  const match = dosis.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Zµ\/]+)$/);
  if (!match) return null;
  return { valor: parseFloat(match[1]!), unidad: match[2]!.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Raw rows esperados de la BD
// ---------------------------------------------------------------------------

interface GtinRow {
  gtin: string;
  lote: string;
  vencimiento: Date;
  activo: boolean;
}

interface GsrnRow {
  gsrn: string;
  referencia_id: string;
  activo: boolean;
}

interface IndicacionItemRow {
  dosis: string | null;
  via: string | null;
  hora_programada: Date | null;
}

// Alias para el subconjunto de PrismaClient usado (facilita mocking en tests)
type QueryClient = Pick<PrismaClient, "$queryRaw">;

// ---------------------------------------------------------------------------
// Función principal (pura respecto a efectos secundarios; solo lectura BD)
// ---------------------------------------------------------------------------

export async function validate5Correctos(
  db: QueryClient,
  input: Validate5CorrectosInput,
): Promise<Validate5CorrectosResult> {
  const errores: ValidacionError[] = [];
  const correctos = {
    paciente: false,
    medicamento: false,
    dosis: false,
    via: false,
    hora: false,
  };

  // ── 1. Paciente ──────────────────────────────────────────────────────────

  if (input.pacienteGsrn !== undefined) {
    if (!gsrnChecksumValid(input.pacienteGsrn)) {
      errores.push({
        campo: "paciente",
        mensaje: `GSRN inválido (checksum GS1-18 fallido): ${input.pacienteGsrn}`,
        severity: "error",
      });
    } else {
      const gsrnRows = await (
        db.$queryRaw as (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => Promise<GsrnRow[]>
      )`
        SELECT gsrn, referencia_id, activo
        FROM ece.gsrn_catalogo
        WHERE gsrn = ${input.pacienteGsrn}
          AND tipo = 'paciente'
          AND activo = true
        LIMIT 1
      `;

      const gsrnRow = gsrnRows[0] ?? null;

      if (!gsrnRow) {
        errores.push({
          campo: "paciente",
          mensaje: `GSRN ${input.pacienteGsrn} no registrado en catálogo de pacientes.`,
          severity: "error",
        });
      } else if (gsrnRow.referencia_id !== input.pacienteId) {
        errores.push({
          campo: "paciente",
          mensaje: `GSRN ${input.pacienteGsrn} corresponde a otro paciente (no al paciente del episodio).`,
          severity: "error",
        });
      } else {
        correctos.paciente = true;
      }
    }
  } else {
    // Sin GSRN: no se puede verificar identidad GS1; warning, no bloquea (capacidad parcial)
    errores.push({
      campo: "paciente",
      mensaje: "GSRN de paciente no escaneado. Verificación GS1 de identidad omitida.",
      severity: "warning",
    });
    // No se marca correcto; el middleware decide si bloquear por warnings
  }

  // ── 2. Medicamento ───────────────────────────────────────────────────────

  const now = new Date();

  const gtinRows = await (
    db.$queryRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<GtinRow[]>
  )`
    SELECT gtin, lote, vencimiento, activo
    FROM ece.gs1_gtin
    WHERE gtin = ${input.gtin}
      AND lote  = ${input.lote}
      AND activo = true
    LIMIT 1
  `;

  const gtinRow = gtinRows[0] ?? null;

  if (!gtinRow) {
    errores.push({
      campo: "medicamento",
      mensaje: `GTIN ${input.gtin} con lote ${input.lote} no encontrado en catálogo GS1 o inactivo.`,
      severity: "error",
    });
  } else {
    // Validar vencimiento: usamos tanto el valor de la BD como el del código escaneado
    const vencimientoBd = gtinRow.vencimiento;
    const vencimientoEscaneado = input.expiry;

    if (vencimientoBd <= now || vencimientoEscaneado <= now) {
      errores.push({
        campo: "medicamento",
        mensaje: `Medicamento vencido. Vencimiento BD: ${vencimientoBd.toISOString().slice(0, 10)}; escaneado: ${vencimientoEscaneado.toISOString().slice(0, 10)}.`,
        severity: "error",
      });
    } else {
      correctos.medicamento = true;
    }
  }

  // ── 3+4+5. Consulta indicacion_item para dosis, vía y hora ───────────────

  const itemRows = await (
    db.$queryRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<IndicacionItemRow[]>
  )`
    SELECT ii.dosis, ii.via, im.hora_inicio AS hora_programada
    FROM ece.indicacion_item ii
    JOIN ece.indicaciones_medicas im ON im.id = ii.indicacion_id
    WHERE ii.id = ${input.indicacionItemId}::uuid
    LIMIT 1
  `;

  const item = itemRows[0] ?? null;

  if (!item) {
    // Si no encontramos el item, no podemos validar dosis/via/hora
    errores.push({
      campo: "dosis",
      mensaje: `indicacion_item ${input.indicacionItemId} no encontrado.`,
      severity: "error",
    });
    errores.push({
      campo: "via",
      mensaje: `indicacion_item ${input.indicacionItemId} no encontrado.`,
      severity: "error",
    });
    errores.push({
      campo: "hora",
      mensaje: `indicacion_item ${input.indicacionItemId} no encontrado.`,
      severity: "error",
    });
  } else {
    // ── 3. Dosis (tolerancia ±10%) ─────────────────────────────────────────
    if (!item.dosis) {
      // Sin dosis definida en la indicación: skip como warning
      errores.push({
        campo: "dosis",
        mensaje: "Indicación sin dosis definida; verificación de dosis omitida.",
        severity: "warning",
      });
    } else {
      const dosisIndicada = parseDosis(item.dosis);
      const dosisAdministrada = parseDosis(input.dosis);

      if (!dosisIndicada || !dosisAdministrada) {
        errores.push({
          campo: "dosis",
          mensaje: `No se pudo parsear dosis. Indicada: "${item.dosis}", administrada: "${input.dosis}".`,
          severity: "error",
        });
      } else if (dosisIndicada.unidad !== dosisAdministrada.unidad) {
        errores.push({
          campo: "dosis",
          mensaje: `Unidad de dosis no coincide. Indicada: ${dosisIndicada.unidad}, administrada: ${dosisAdministrada.unidad}.`,
          severity: "error",
        });
      } else {
        const tolerancia = dosisIndicada.valor * 0.1;
        const diff = Math.abs(dosisIndicada.valor - dosisAdministrada.valor);
        if (diff > tolerancia) {
          errores.push({
            campo: "dosis",
            mensaje: `Dosis fuera de tolerancia (±10%). Indicada: ${item.dosis}, administrada: ${input.dosis}.`,
            severity: "error",
          });
        } else {
          correctos.dosis = true;
        }
      }
    }

    // ── 4. Vía ─────────────────────────────────────────────────────────────
    if (!item.via) {
      errores.push({
        campo: "via",
        mensaje: "Indicación sin vía definida; verificación de vía omitida.",
        severity: "warning",
      });
    } else if (item.via.trim().toLowerCase() !== input.via.trim().toLowerCase()) {
      errores.push({
        campo: "via",
        mensaje: `Vía no coincide. Indicada: "${item.via}", administrada: "${input.via}".`,
        severity: "error",
      });
    } else {
      correctos.via = true;
    }

    // ── 5. Hora (±30 min) ──────────────────────────────────────────────────
    if (!item.hora_programada) {
      errores.push({
        campo: "hora",
        mensaje: "Indicación sin hora programada; verificación de hora omitida.",
        severity: "warning",
      });
    } else {
      const diffMs = Math.abs(
        input.hora.getTime() - item.hora_programada.getTime(),
      );
      const TREINTA_MIN_MS = 30 * 60 * 1000;
      if (diffMs > TREINTA_MIN_MS) {
        errores.push({
          campo: "hora",
          mensaje: `Hora fuera de ventana ±30 min. Programada: ${item.hora_programada.toISOString()}, administrada: ${input.hora.toISOString()}.`,
          severity: "error",
        });
      } else {
        correctos.hora = true;
      }
    }
  }

  const erroresHard = errores.filter((e) => e.severity === "error");
  const valid = erroresHard.length === 0;

  return { valid, errores, correctos };
}

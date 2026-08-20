/**
 * Detector de drift CHECK-constraint ↔ enum Zod para el dominio de
 * indicaciones médicas (ece.indicacion_item.tipo y
 * ece.administracion_medicamento.estado).
 *
 * ─── Por qué existe ────────────────────────────────────────────────────────
 *
 * Durante meses, `indicacionesMedicasRouter.create()` y
 * `registrarAdministracion()` violaron el CHECK de Postgres en CADA llamada
 * real: los enums Zod enviaban MAYUSCULAS y los CHECK exigían minúsculas en
 * español. Ningún valor coincidía. Nadie lo notó porque los tests de estos
 * routers mockean Prisma al 100% — un mock acepta cualquier string, así que
 * un CHECK jamás participa. El síntoma sólo aparecía contra Postgres, y como
 * el flujo no tenía UAT, las tablas simplemente quedaron en 0 filas.
 *
 * ─── Qué verifica ──────────────────────────────────────────────────────────
 *
 * Este test lee el SQL de la migración canónica (202), extrae los valores
 * literales de cada CHECK, y los compara contra los enums Zod de los cuatro
 * puntos de definición del vocabulario. Cualquier edición de UN solo lado
 * rompe CI.
 *
 * ─── Qué NO verifica (limitación consciente) ───────────────────────────────
 *
 * Compara el ARCHIVO SQL contra el código, no la BD viva contra el código: no
 * hay Postgres en CI (`vitest.config.ts` de este paquete no levanta ninguno).
 * Un `202` correcto pero nunca aplicado a prod deja el drift real abierto — el
 * cierre del loop es el apply y la query de verificación al pie de 202.
 * Detectarlo automáticamente exigiría un testcontainer/Postgres efímero en CI;
 * queda como follow-up.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  tipoIndicacionEnum as tipoRouter,
  estadoAdminEnum as estadoRouterMedico,
} from "../indicaciones-medicas.router";
import { estadoAdminMedEnum as estadoRouterEnfermeria } from "../registro-enfermeria.router";
import {
  tipoIndicacionEnum as tipoContracts,
  estadoAdminEnum as estadoContractsMedico,
} from "@his/contracts/schemas/ece-indicaciones";
import { estadoAdminMedEnum as estadoContractsEnfermeria } from "@his/contracts/schemas/ece-registro-enfermeria";

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_FILE = resolve(
  HERE,
  "../../../../../database/sql/202_ece_indicacion_vocabulario_estados.sql",
);

/**
 * Extrae los valores de un `ADD CONSTRAINT <nombre> ... CHECK (col IN (...))`.
 * Descarta los comentarios `--` antes de parsear para no capturar literales
 * citados en la documentación del archivo.
 */
function checkValues(sql: string, constraintName: string): string[] {
  const sinComentarios = sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  const inicio = sinComentarios.indexOf(`ADD CONSTRAINT ${constraintName}`);
  if (inicio === -1) {
    throw new Error(`No se encontró ADD CONSTRAINT ${constraintName} en 202.`);
  }
  const fin = sinComentarios.indexOf(";", inicio);
  const cuerpo = sinComentarios.slice(inicio, fin);

  return [...cuerpo.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
}

// ─── Vocabulario canónico ────────────────────────────────────────────────────
// Duplicado a propósito: si alguien cambia el SQL o un enum, tiene que venir
// aquí y declarar el cambio de forma deliberada.

const TIPO_BD = [
  "MEDICAMENTO",
  "PROCEDIMIENTO",
  "DIETA",
  "CUIDADO_GENERAL",
  "ESTUDIO",
  "REPOSO",
] as const;

const ESTADO_BD = [
  "PROGRAMADA",
  "ADMINISTRADO",
  "OMITIDA",
  "DIFERIDA",
  "RECHAZADA",
] as const;

/**
 * Valores que el CHECK acepta pero ningún enum Zod expone todavía.
 * REPOSO viene del DDL original (61) y se conservó para no perder la categoría
 * clínica; exponerlo en el enum + el Select de la UI es un cambio de producto,
 * no de este fix.
 */
const SOLO_BD = { tipo: ["REPOSO"], estado: [] as string[] };

const sql = readFileSync(SQL_FILE, "utf-8");
const ordenado = (xs: readonly string[]) => [...xs].sort();

describe("vocabulario BD ↔ Zod — ece.indicacion_item.tipo", () => {
  it("chk_ind_item_tipo en 202 contiene exactamente el vocabulario canónico", () => {
    expect(ordenado(checkValues(sql, "chk_ind_item_tipo"))).toEqual(
      ordenado(TIPO_BD),
    );
  });

  it("el enum del router (punto de enforcement del INSERT) es subconjunto del CHECK", () => {
    expect(ordenado(tipoRouter.options)).toEqual(
      ordenado(TIPO_BD.filter((v) => !SOLO_BD.tipo.includes(v))),
    );
  });

  it("el enum de @his/contracts coincide con el del router", () => {
    expect(ordenado(tipoContracts.options)).toEqual(ordenado(tipoRouter.options));
  });
});

describe("vocabulario BD ↔ Zod — ece.administracion_medicamento.estado", () => {
  it("chk_admin_med_estado_v2 en 202 contiene exactamente el vocabulario canónico", () => {
    expect(ordenado(checkValues(sql, "chk_admin_med_estado_v2"))).toEqual(
      ordenado(ESTADO_BD),
    );
  });

  it("los dos routers que escriben la columna cubren el CHECK sin excederlo", () => {
    const union = new Set([
      ...estadoRouterMedico.options,
      ...estadoRouterEnfermeria.options,
    ]);
    expect(ordenado([...union])).toEqual(ordenado(ESTADO_BD));
  });

  it("los enums de @his/contracts coinciden con los de sus routers", () => {
    expect(ordenado(estadoContractsMedico.options)).toEqual(
      ordenado(estadoRouterMedico.options),
    );
    expect(ordenado(estadoContractsEnfermeria.options)).toEqual(
      ordenado(estadoRouterEnfermeria.options),
    );
  });
});

describe("regresión — el vocabulario viejo quedó fuera", () => {
  it("ningún enum vuelve a aceptar los valores en minúsculas del DDL original", () => {
    const viejos = [
      "medicamento",
      "dieta",
      "cuidado",
      "estudio",
      "reposo",
      "administrado",
      "omitido",
      "diferido",
      "pospuesto", // nunca existió en ningún CHECK
    ];
    const todos = [
      ...tipoRouter.options,
      ...tipoContracts.options,
      ...estadoRouterMedico.options,
      ...estadoRouterEnfermeria.options,
      ...estadoContractsMedico.options,
      ...estadoContractsEnfermeria.options,
    ];
    expect(todos.filter((v) => viejos.includes(v))).toEqual([]);
  });

  it("202 dropea los dos CHECK del DDL original", () => {
    expect(sql).toContain(
      "DROP CONSTRAINT IF EXISTS indicacion_item_tipo_check",
    );
    expect(sql).toContain(
      "DROP CONSTRAINT IF EXISTS administracion_medicamento_estado_check",
    );
  });
});

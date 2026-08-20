/**
 * bedside — contexto RLS del evento EPCIS (`ece.gs1_epcis_event`).
 *
 * Por qué existe este archivo (y por qué NO usa `vi.mock` del helper):
 *
 * El defecto que estos tests fijan sobrevivió a una suite verde porque los
 * tests existentes mockean `$executeRawUnsafe` como un no-op y nunca miran
 * QUÉ se ejecuta ni EN QUÉ ORDEN. Un test que solo verifica el valor de
 * retorno del procedure pasa igual con el INSERT emitido bajo el contexto
 * equivocado. Por eso acá se afirma el **protocolo SQL** completo alrededor
 * del INSERT, que es exactamente donde estaba el bug:
 *
 *   1. `SELECT current_user`                → captura del rol del caller
 *   2. `SET LOCAL ROLE authenticated`       → demote
 *   3. `ece.set_ece_context($1,$2)`         → GUC `app.ece_establecimiento_id`
 *   4. `INSERT INTO ece.gs1_epcis_event`    → con el id de ece.establecimiento
 *   5. `SET LOCAL ROLE "<rol capturado>"`   → restore, NUNCA `RESET ROLE`
 *
 * Verificado empíricamente contra PostgreSQL 16 (BD desechable, 2026-08-19)
 * que sin el paso 3 el INSERT falla con 42501 «new row violates row-level
 * security policy» — porque las policies de `ece.gs1_epcis_event`
 * (sql/94_farmacovigilancia_epcis.sql) leen `app.ece_establecimiento_id`, no
 * el `app.current_org_id` que setea `withTenantContext`. Y que `RESET ROLE`
 * devuelve al rol de sesión (BYPASSRLS), no al `authenticated` del caller.
 *
 * También se fija el segundo defecto del mismo INSERT: `establecimiento_id`
 * es FK a `ece.establecimiento(id)`, cuyo uuid NO es el
 * `public."Establishment".id` de `ctx.tenant.establishmentId`
 * (sql/56_ece_01_catalogos.sql). Pasar el segundo produce 23503.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { bedsideRouter } from "../bedside.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_TENANT } from "@his/test-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function gs1CheckDigit(root: string): string {
  const len = root.length;
  let sum = 0;
  for (let i = 0; i < len; i++) {
    const rightPos = len - 1 - i;
    const weight = rightPos % 2 === 0 ? 3 : 1;
    sum += parseInt(root[i]!, 10) * weight;
  }
  return root + ((10 - (sum % 10)) % 10).toString();
}

const GTIN = gs1CheckDigit("0750100000123");
const GSRN_PACIENTE = gs1CheckDigit("80187413000000001".padStart(17, "0"));
const GSRN_ENFERMERA = gs1CheckDigit("80187413000000100".padStart(17, "0"));
const DM_OK = `(01)${GTIN}(10)L2024A(17)261231(21)SER0001`;

const UUID_PATIENT = "bbbbbbbb-0000-0000-0000-000000000001";
const UUID_INDICATION = "cccccccc-0000-0000-0000-000000000001";

/** `public."Establishment".id` — lo que trae el tenant context. */
const PUBLIC_ESTABLISHMENT_ID = MOCK_TENANT.establishmentId!;
/** `ece.establecimiento.id` — otro uuid, resuelto por el join del bridge. */
const ECE_ESTABLECIMIENTO_ID = "eeeeeeee-0000-0000-0000-00000000000e";

/** Rol Postgres que trae la transacción ya demotada por `withTenantContext`. */
const CALLER_ROLE = "authenticated";

let prisma: DeepMockProxy<PrismaClient>;
/** Log ordenado de todo el SQL emitido sobre la transacción. */
let sqlLog: string[];

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  sqlLog = [];
  vi.clearAllMocks();

  // `withTenantContext` real: $transaction passthrough (tx === prisma).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = vi
    .fn()
    .mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRawUnsafe = vi.fn().mockImplementation((sql: string) => {
    sqlLog.push(normalize(sql));
    return Promise.resolve(1);
  });

  // `resolveEceEstablecimientoId` usa $queryRaw (tagged template) sobre
  // ctx.prisma, FUERA de la transacción demotada.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRaw = vi.fn().mockResolvedValue([{ id: ECE_ESTABLECIMIENTO_ID }]);

  // $queryRawUnsafe: sirve tanto a las consultas del algoritmo 5-correctos
  // como al `SELECT current_user` del helper de persistencia.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
    const n = normalize(sql);
    sqlLog.push(n);
    if (/^SELECT current_user$/i.test(n)) {
      return Promise.resolve([{ current_user: CALLER_ROLE }]);
    }
    if (/FROM ece\.gs1_gsrn/i.test(n)) {
      return Promise.resolve([{ referencia_id: UUID_PATIENT, activo: true }]);
    }
    if (/FROM ece\.indicaciones_medicas/i.test(n)) {
      return Promise.resolve([
        {
          id: UUID_INDICATION,
          patient_id: UUID_PATIENT,
          patient_gsrn: GSRN_PACIENTE,
          gtin: GTIN,
          dose: "500mg",
          route: "oral",
          frequency: "cada 8h",
          status: "ACTIVA",
        },
      ]);
    }
    if (/FROM ece\.gs1_gtin/i.test(n)) {
      return Promise.resolve([{ presentacion: "Amoxicilina 500mg/cap" }]);
    }
    if (/INSERT INTO ece\.bedside_validation/i.test(n)) {
      return Promise.resolve([{ id: "dddddddd-0000-0000-0000-000000000001" }]);
    }
    if (/FROM "MedicationAdministration"/i.test(n)) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  });
});

async function runValidacionOk() {
  const caller = bedsideRouter.createCaller(makeCtx({ prisma }));
  return caller.validate5Correctos({
    indicationId: UUID_INDICATION,
    gsrnPaciente: GSRN_PACIENTE,
    gsrnEnfermera: GSRN_ENFERMERA,
    gs1Medicamento: DM_OK,
    dosis: "500mg",
    via: "oral",
    timestamp: new Date(),
  });
}

/** Índice en `sqlLog` de la primera sentencia que matchea. */
function idx(re: RegExp): number {
  return sqlLog.findIndex((s) => re.test(s));
}

describe("bedside — EPCIS bajo el contexto RLS del schema ece", () => {
  it("emite el INSERT en ece.gs1_epcis_event DESPUÉS de ece.set_ece_context", async () => {
    const res = await runValidacionOk();
    expect(res.ok).toBe(true);

    const iSetCtx = idx(/ece\.set_ece_context/i);
    const iInsert = idx(/INSERT INTO ece\.gs1_epcis_event/i);

    // Si alguien vuelve a emitir el INSERT bajo withTenantContext (GUC
    // app.current_org_id) sin setear el contexto ECE, iSetCtx === -1 y el
    // WITH CHECK de la policy compararía contra NULL → 42501 en runtime.
    expect(iSetCtx).toBeGreaterThanOrEqual(0);
    expect(iInsert).toBeGreaterThanOrEqual(0);
    expect(iSetCtx).toBeLessThan(iInsert);
  });

  it("captura el rol del caller y lo restaura — nunca RESET ROLE", async () => {
    await runValidacionOk();

    const iCapture = idx(/^SELECT current_user$/i);
    // OJO: el primer `SET LOCAL ROLE authenticated` del log es el de
    // withTenantContext. El relevante es el que emite el helper DESPUÉS de
    // capturar el rol; por eso se busca a partir de iCapture.
    const iDemote = sqlLog.findIndex(
      (s, k) => k > iCapture && /^SET LOCAL ROLE authenticated$/i.test(s),
    );
    const iInsert = idx(/INSERT INTO ece\.gs1_epcis_event/i);
    const iRestore = sqlLog.findIndex(
      (s, k) => k > iInsert && /^SET LOCAL ROLE "/.test(s),
    );

    expect(iCapture).toBeGreaterThanOrEqual(0);
    expect(iCapture).toBeLessThan(iDemote);
    expect(iRestore).toBeGreaterThan(iInsert);
    expect(sqlLog[iRestore]).toBe(`SET LOCAL ROLE "${CALLER_ROLE}"`);

    // `RESET ROLE` volvería al rol de SESIÓN (BYPASSRLS en Supabase), no al
    // `authenticated` que ya había puesto withTenantContext — verificado
    // contra PostgreSQL 16: tras dos SET ROLE anidados, RESET ROLE deja
    // current_user = postgres.
    expect(sqlLog.some((s) => /^RESET ROLE$/i.test(s))).toBe(false);
  });

  it("usa el id de ece.establecimiento, no el de public.Establishment", async () => {
    await runValidacionOk();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = (prisma as any).$executeRawUnsafe.mock.calls as unknown[][];
    const setCtx = calls.find((c) => /ece\.set_ece_context/i.test(String(c[0])));
    const insert = calls.find((c) => /INSERT INTO ece\.gs1_epcis_event/i.test(String(c[0])));

    expect(setCtx).toBeDefined();
    expect(insert).toBeDefined();

    // GUC del contexto ECE
    expect(setCtx![2]).toBe(ECE_ESTABLECIMIENTO_ID);
    expect(setCtx![2]).not.toBe(PUBLIC_ESTABLISHMENT_ID);

    // Columna establecimiento_id del INSERT (posición $10 → índice 10 en la
    // lista de args, con args[0] = SQL).
    expect(insert!).toContain(ECE_ESTABLECIMIENTO_ID);
    expect(insert!).not.toContain(PUBLIC_ESTABLISHMENT_ID);
  });

  it("falla cerrado si el establecimiento no existe en ece.establecimiento", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).$queryRaw = vi.fn().mockResolvedValue([]);

    await expect(runValidacionOk()).rejects.toThrow(/ece\.establecimiento/i);

    // Y sin dejar el evento a medias: no se emitió el INSERT.
    expect(idx(/INSERT INTO ece\.gs1_epcis_event/i)).toBe(-1);
  });

  it("resuelve el establecimiento ECE fuera de la transacción demotada", async () => {
    await runValidacionOk();

    // `ece.establecimiento` tiene policy por GUC ECE; resolverlo DENTRO de la
    // transacción ya demotada (y aún sin contexto ECE) devolvería 0 filas y el
    // procedure fallaría siempre. Debe correr sobre ctx.prisma, antes del
    // $transaction que abre withTenantContext.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txOrder = (prisma as any).$transaction.mock.invocationCallOrder[0] as number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolveOrder = (prisma as any).$queryRaw.mock.invocationCallOrder[0] as number;
    expect(resolveOrder).toBeLessThan(txOrder);
  });
});

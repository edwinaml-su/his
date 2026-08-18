/**
 * epcis-patient-persist.test.ts — INSERT en ece.gs1_epcis_patient_event.
 *
 * Cubre dos defectos reportados por @QA sobre `persistPatientMovementEvent`:
 *
 * Defecto A: la función original hacía `RESET ROLE` al final, lo cual no es un
 * "pop" del `SET ROLE` previo — resetea al rol de SESIÓN, no al rol que estaba
 * activo justo antes del demote. Si el caller ya había demotado a
 * `authenticated` (como `encounter.router.ts` `admit` vía `withTenantContext`),
 * `RESET ROLE` deshacía TAMBIÉN ese demote y dejaba el resto de la transacción
 * corriendo con el rol de sesión (bypass RLS). El fix captura `current_user`
 * ANTES de demotar y restaura exactamente ese rol al final — los tests de este
 * archivo verifican que la secuencia real sea "capturar rol → demotar →
 * set_ece_context → INSERT → restaurar rol capturado" y que NUNCA se emita un
 * `RESET ROLE` literal.
 *
 * Defecto C: el payload what/where_data/why/who ahora se valida en runtime
 * contra los schemas Zod de `@his/contracts` (dictamen @AE §4 restricción 4)
 * ANTES de tocar la base — un payload con un campo no declarado o con texto
 * libre debe lanzar y no llegar nunca al INSERT.
 *
 * NOTA: estos tests verifican la SECUENCIA de llamadas contra un tx mockeado —
 * no contra Postgres real (docker-compose.test.yml no disponible en esta
 * sesión). El mock de $queryRawUnsafe simula lo que `SELECT current_user`
 * devolvería en cada uno de los dos escenarios reales (tx ya demotada vs. tx
 * con el rol de sesión original) — no prueba el efecto sobre Postgres real.
 */
import { describe, it, expect, vi } from "vitest";
import { persistPatientMovementEvent } from "../epcis-patient-persist";
import type { EpcisPatientEventRow } from "../epcis-builder";

function makeRow(overrides: Partial<EpcisPatientEventRow> = {}): EpcisPatientEventRow {
  return {
    tipo_evento: "ObjectEvent",
    subtipo: "PATIENT_ADMISSION",
    what: { epcList: ["urn:epc:id:gsrn:7503000.0000000123"], gsrn: "750300000000001234" },
    where_data: {
      readPoint: null,
      bizLocation: null,
      internalRef: {
        bedId: null,
        serviceUnitId: null,
        establishmentId: "00000000-0000-0000-0000-0000000000f1",
      },
    },
    event_time: new Date("2026-08-18T12:00:00.000Z"),
    why: { businessStep: "arriving", disposition: "active", bizTransactionList: [] },
    who: {
      sourceList: [
        { type: "urn:epcglobal:cbv:sdt:possessing_party", gsrn: "750300000000001234" },
      ],
      recordedById: "00000000-0000-0000-0000-0000000000a1",
    },
    payload_hash: "a".repeat(64),
    establecimiento_id: "00000000-0000-0000-0000-0000000000e9",
    status: "COMMITTED",
    ...overrides,
  };
}

function makeTx(currentUser: string) {
  const calls: string[] = [];
  return {
    calls,
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ current_user: currentUser }]),
    $executeRawUnsafe: vi.fn((query: string) => {
      calls.push(query.trim().split("\n")[0]!.trim());
      return Promise.resolve(1);
    }),
  };
}

describe("persistPatientMovementEvent — Defecto A (RESET ROLE no es pop de stack)", () => {
  it("caso tx YA demotada (encounter.router.ts admit): restaura a 'authenticated', nunca a RESET ROLE", async () => {
    const tx = makeTx("authenticated");
    await persistPatientMovementEvent(tx, "user-1", "estab-1", makeRow());

    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith("SELECT current_user");
    expect(tx.calls).toEqual([
      "SET LOCAL ROLE authenticated",
      "SELECT ece.set_ece_context($1::uuid, $2::uuid)",
      expect.stringContaining("INSERT INTO ece.gs1_epcis_patient_event"),
      'SET LOCAL ROLE "authenticated"',
    ]);
    expect(tx.calls).not.toContain("RESET ROLE");
  });

  it("caso tx NO demotada (encounter-transfer/discharge router, $transaction plano): restaura el rol de sesión original capturado, no 'authenticated'", async () => {
    const tx = makeTx("postgres.ejacvsgbewcerxtjtwto");
    await persistPatientMovementEvent(tx, "user-1", "estab-1", makeRow());

    expect(tx.calls[0]).toBe("SET LOCAL ROLE authenticated");
    expect(tx.calls[3]).toBe('SET LOCAL ROLE "postgres.ejacvsgbewcerxtjtwto"');
    expect(tx.calls).not.toContain("RESET ROLE");
  });

  it("captura current_user ANTES de emitir el demote (orden correcto)", async () => {
    const tx = makeTx("authenticated");
    const order: string[] = [];
    tx.$queryRawUnsafe.mockImplementation(async () => {
      order.push("query-current-user");
      return [{ current_user: "authenticated" }];
    });
    const originalExecute = tx.$executeRawUnsafe.getMockImplementation()!;
    tx.$executeRawUnsafe.mockImplementation(async (query: string, ...args: unknown[]) => {
      order.push(`execute:${query.trim().split("\n")[0]!.trim()}`);
      return originalExecute(query, ...args);
    });

    await persistPatientMovementEvent(tx, "user-1", "estab-1", makeRow());

    expect(order[0]).toBe("query-current-user");
    expect(order[1]).toBe("execute:SET LOCAL ROLE authenticated");
  });

  it("lanza si no puede determinar el rol activo (current_user vacío)", async () => {
    const tx = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };
    await expect(
      persistPatientMovementEvent(tx, "user-1", "estab-1", makeRow()),
    ).rejects.toThrow(/rol Postgres activo/);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("escapa comillas dobles en el rol capturado al restaurarlo (defensivo, sin inyección)", async () => {
    const tx = makeTx('weird"role');
    await persistPatientMovementEvent(tx, "user-1", "estab-1", makeRow());
    expect(tx.calls[3]).toBe('SET LOCAL ROLE "weird""role"');
  });
});

describe("persistPatientMovementEvent — secuencia base (comportamiento preexistente)", () => {
  it("pasa recordedById/eceEstablecimientoId a set_ece_context en ese orden", async () => {
    const tx = makeTx("authenticated");
    await persistPatientMovementEvent(tx, "user-42", "estab-42", makeRow());

    const setContextCall = tx.$executeRawUnsafe.mock.calls[1]!;
    expect(setContextCall.slice(1)).toEqual(["user-42", "estab-42"]);
  });

  it("serializa what/where_data/why/who como JSON string (no objeto crudo) para el INSERT", async () => {
    const tx = makeTx("authenticated");
    const row = makeRow({
      what: { gsrn: "750300000000001234", epcList: ["urn:epc:id:gsrn:7503000.0000000123"] },
    });
    await persistPatientMovementEvent(tx, "user-1", "estab-1", row);

    const insertCall = tx.$executeRawUnsafe.mock.calls[2]!;
    // Orden de parámetros: tipo_evento, subtipo, what, where_data, event_time,
    // why, who, payload_hash, establecimiento_id, status.
    const [, tipoEvento, subtipo, what] = insertCall;
    expect(tipoEvento).toBe("ObjectEvent");
    expect(subtipo).toBe("PATIENT_ADMISSION");
    expect(typeof what).toBe("string");
    expect(JSON.parse(what as string)).toEqual(row.what);
  });

  it("event_time se serializa con toISOString()", async () => {
    const tx = makeTx("authenticated");
    const row = makeRow({ event_time: new Date("2026-01-15T08:30:00.000Z") });
    await persistPatientMovementEvent(tx, "user-1", "estab-1", row);

    const insertCall = tx.$executeRawUnsafe.mock.calls[2]!;
    expect(insertCall[5]).toBe("2026-01-15T08:30:00.000Z");
  });
});

describe("persistPatientMovementEvent — Defecto C (validación Zod runtime, dictamen @AE §4.4)", () => {
  it("rechaza un payload con un campo no declarado (ej. 'diagnostico' inyectado en who) y NO llega a ejecutar SQL", async () => {
    const tx = makeTx("authenticated");
    const row = makeRow({
      who: {
        sourceList: [
          { type: "urn:epcglobal:cbv:sdt:possessing_party", gsrn: "750300000000001234" },
        ],
        recordedById: "00000000-0000-0000-0000-0000000000a1",
        // Campo no declarado — exactamente lo que .strict() debe atrapar. `who` es
        // `object` en EpcisPatientEventRow (epcis-builder.ts), así que TS no lo
        // marca — la defensa real es el .strict() de Zod en runtime, no el tipo.
        diagnostico: "influenza",
      },
    });

    await expect(
      persistPatientMovementEvent(tx, "user-1", "estab-1", row),
    ).rejects.toThrow(/payload de evento de paciente no cumple el schema opaco/);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("rechaza texto libre en 'why.businessStep' (fuera del enum CBV cerrado)", async () => {
    const tx = makeTx("authenticated");
    const row = makeRow({
      why: {
        // Texto libre, no un valor del enum CBV cerrado — `why` también es `object`
        // a nivel de tipo; la defensa real es el enum Zod en runtime.
        businessStep: "el paciente fue trasladado por sospecha de TB",
        disposition: "active",
        bizTransactionList: [],
      },
    });

    await expect(
      persistPatientMovementEvent(tx, "user-1", "estab-1", row),
    ).rejects.toThrow(/payload de evento de paciente no cumple el schema opaco/);
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("rechaza un where_data.internalRef con campo adicional no documentado (ej. 'unidadNombre')", async () => {
    const tx = makeTx("authenticated");
    const row = makeRow({
      where_data: {
        readPoint: null,
        bizLocation: null,
        internalRef: {
          bedId: null,
          serviceUnitId: null,
          establishmentId: "00000000-0000-0000-0000-0000000000f1",
          // Campo no declarado (nombre humano de unidad, prohibido por §4
          // restricción 2/8) — atrapado por Zod en runtime, no por TS.
          unidadNombre: "Aislamiento TB",
        },
      },
    });

    await expect(
      persistPatientMovementEvent(tx, "user-1", "estab-1", row),
    ).rejects.toThrow(/payload de evento de paciente no cumple el schema opaco/);
  });

  it("acepta un payload válido (shape real de buildPatientMovementEvent) sin lanzar", async () => {
    const tx = makeTx("authenticated");
    await expect(
      persistPatientMovementEvent(tx, "user-1", "estab-1", makeRow()),
    ).resolves.toBeUndefined();
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(4);
  });
});

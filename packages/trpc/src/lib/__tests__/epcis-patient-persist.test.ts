/**
 * epcis-patient-persist.test.ts — INSERT en ece.gs1_epcis_patient_event.
 *
 * Gap detectado por @QA: persistPatientMovementEvent no tenía ningún test.
 * Es la función que ejecuta el demote de rol + set_ece_context + INSERT +
 * RESET ROLE descrito en el header del archivo — sin un test, un cambio de
 * orden o de parámetros pasaría CI en silencio.
 *
 * IMPORTANTE (hallazgo, no solo test): estos tests verifican la SECUENCIA de
 * llamadas ($executeRawUnsafe) contra un tx mockeado — no contra Postgres
 * real (docker-compose.test.yml no disponible en esta sesión, daemon caído).
 * No prueban el efecto real de `RESET ROLE` sobre el rol de la transacción.
 * Ver reporte de @QA: `RESET ROLE` no es "pop de un stack" — resetea al rol
 * de sesión. Si esta función se invoca dentro de una transacción YA demotada
 * por `withTenantContext` (como ocurre en encounter.router.ts `admit`), el
 * `RESET ROLE` de esta función deja el resto de esa transacción corriendo
 * con el rol original (bypass RLS), no con `authenticated`. Hoy es inofensivo
 * porque la llamada es la última operación de ese callback, pero es un
 * contrato frágil que un test de mocks no puede detectar — requiere Postgres
 * real o una revisión de @DBA del orden SET ROLE / RESET ROLE por callsite.
 */
import { describe, it, expect, vi } from "vitest";
import { persistPatientMovementEvent } from "../epcis-patient-persist";
import type { EpcisPatientEventRow } from "../epcis-builder";

function makeRow(overrides: Partial<EpcisPatientEventRow> = {}): EpcisPatientEventRow {
  return {
    tipo_evento: "ObjectEvent",
    subtipo: "PATIENT_ADMISSION",
    what: { epcList: ["urn:epc:id:gsrn:7503000.0000000123"], gsrn: "750300000000001234" },
    where_data: { readPoint: null, bizLocation: null, internalRef: {} },
    event_time: new Date("2026-08-18T12:00:00.000Z"),
    why: { businessStep: "arriving", disposition: "active", bizTransactionList: [] },
    who: { sourceList: [], recordedById: "u1" },
    payload_hash: "a".repeat(64),
    establecimiento_id: "00000000-0000-0000-0000-0000000000e9",
    status: "COMMITTED",
    ...overrides,
  };
}

describe("persistPatientMovementEvent", () => {
  it("ejecuta la secuencia SET LOCAL ROLE → set_ece_context → INSERT → RESET ROLE, en ese orden", async () => {
    const calls: string[] = [];
    const tx = {
      $executeRawUnsafe: vi.fn((query: string) => {
        calls.push(query.trim().split("\n")[0]!.trim());
        return Promise.resolve(1);
      }),
    };

    const row = makeRow();
    await persistPatientMovementEvent(tx, "user-1", "estab-1", row);

    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(4);
    expect(calls[0]).toBe("SET LOCAL ROLE authenticated");
    expect(calls[1]).toBe("SELECT ece.set_ece_context($1::uuid, $2::uuid)");
    expect(calls[2]).toContain("INSERT INTO ece.gs1_epcis_patient_event");
    expect(calls[3]).toBe("RESET ROLE");
  });

  it("pasa recordedById/eceEstablecimientoId a set_ece_context en ese orden", async () => {
    const tx = { $executeRawUnsafe: vi.fn().mockResolvedValue(1) };
    await persistPatientMovementEvent(tx, "user-42", "estab-42", makeRow());

    const setContextCall = tx.$executeRawUnsafe.mock.calls[1]!;
    expect(setContextCall.slice(1)).toEqual(["user-42", "estab-42"]);
  });

  it("serializa what/where_data/why/who como JSON string (no objeto crudo) para el INSERT", async () => {
    const tx = { $executeRawUnsafe: vi.fn().mockResolvedValue(1) };
    const row = makeRow({ what: { gsrn: "1", epcList: [] } });
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
    const tx = { $executeRawUnsafe: vi.fn().mockResolvedValue(1) };
    const row = makeRow({ event_time: new Date("2026-01-15T08:30:00.000Z") });
    await persistPatientMovementEvent(tx, "user-1", "estab-1", row);

    const insertCall = tx.$executeRawUnsafe.mock.calls[2]!;
    expect(insertCall[5]).toBe("2026-01-15T08:30:00.000Z");
  });
});

/**
 * Tests unitarios — materializeIndicacionFirmadaToFarmacia (R04 consumer).
 *
 * Estrategia: mock directo de `tx.$executeRaw` (sin mockDeep — el consumer
 * solo necesita ese método), siguiendo el patrón de
 * `ece/__tests__/dependencias-enforcement.test.ts`.
 *
 * Casos cubiertos:
 *   1. Happy path — llama $executeRaw una vez, con los valores esperados
 *      embebidos en el template SQL (indicacionId, episodioId,
 *      medicoPrescriptorId, domainEventId), y devuelve itemsMaterializados
 *      igual al row-count reportado por Postgres.
 *   2. Sin ítems tipo=medicamento — el INSERT...SELECT no matchea filas,
 *      Postgres reporta 0 afectadas → itemsMaterializados=0 (no es un error;
 *      indicaciones sin medicamentos, ej. solo DIETA/CUIDADO, son válidas).
 *   3. domainEventId ausente (undefined) — se pasa null, no revienta.
 *   4. CONTRATO DE FALLO (el caso que importa): si `tx.$executeRaw` rechaza
 *      (ej. constraint violation, conexión perdida), la función NO atrapa
 *      la excepción — la propaga tal cual al caller. Esto es lo que permite
 *      que `firmar()` haga rollback completo en vez de dejar una indicación
 *      "firmada" sin contraparte en farmacia.
 */
import { describe, it, expect, vi } from "vitest";
import { materializeIndicacionFirmadaToFarmacia } from "../mar-consumer";

const INDICACION_ID = "11111111-1111-1111-1111-111111111111";
const EPISODIO_ID = "22222222-2222-2222-2222-222222222222";
const MEDICO_ID = "33333333-3333-3333-3333-333333333333";
const EVENT_ID = "44444444-4444-4444-4444-444444444444";

interface MockTx {
  $executeRaw: ReturnType<typeof vi.fn>;
}

function makeTx(): MockTx {
  return { $executeRaw: vi.fn() };
}

describe("materializeIndicacionFirmadaToFarmacia", () => {
  it("happy path: ejecuta el INSERT...SELECT y devuelve el row-count", async () => {
    const tx = makeTx();
    tx.$executeRaw.mockResolvedValueOnce(2); // 2 ítems tipo=medicamento

    const result = await materializeIndicacionFirmadaToFarmacia(
      tx as never,
      {
        indicacionId: INDICACION_ID,
        episodioId: EPISODIO_ID,
        medicoPrescriptorId: MEDICO_ID,
        domainEventId: EVENT_ID,
      },
    );

    expect(result.itemsMaterializados).toBe(2);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);

    // El primer arg de un tagged-template call es el array de strings del
    // SQL; los valores interpolados son los args siguientes. Verificamos
    // que los 4 valores del caller viajen en el orden correcto.
    const callArgs = tx.$executeRaw.mock.calls[0] as unknown[];
    expect(callArgs).toEqual(
      expect.arrayContaining([EPISODIO_ID, MEDICO_ID, INDICACION_ID, EVENT_ID]),
    );
  });

  it("sin ítems tipo=medicamento: devuelve itemsMaterializados=0 sin lanzar", async () => {
    const tx = makeTx();
    tx.$executeRaw.mockResolvedValueOnce(0);

    const result = await materializeIndicacionFirmadaToFarmacia(
      tx as never,
      {
        indicacionId: INDICACION_ID,
        episodioId: EPISODIO_ID,
        medicoPrescriptorId: MEDICO_ID,
      },
    );

    expect(result.itemsMaterializados).toBe(0);
  });

  it("domainEventId ausente: se pasa null sin lanzar", async () => {
    const tx = makeTx();
    tx.$executeRaw.mockResolvedValueOnce(1);

    const result = await materializeIndicacionFirmadaToFarmacia(
      tx as never,
      {
        indicacionId: INDICACION_ID,
        episodioId: EPISODIO_ID,
        medicoPrescriptorId: MEDICO_ID,
        domainEventId: null,
      },
    );

    expect(result.itemsMaterializados).toBe(1);
    const callArgs = tx.$executeRaw.mock.calls[0] as unknown[];
    expect(callArgs).toEqual(expect.arrayContaining([null]));
  });

  it("CONTRATO DE FALLO: propaga la excepción del INSERT en vez de tragarla", async () => {
    const tx = makeTx();
    const dbError = new Error(
      'insert or update on table "indicacion_farmacia_pendiente" violates foreign key constraint',
    );
    tx.$executeRaw.mockRejectedValueOnce(dbError);

    await expect(
      materializeIndicacionFirmadaToFarmacia(tx as never, {
        indicacionId: INDICACION_ID,
        episodioId: EPISODIO_ID,
        medicoPrescriptorId: MEDICO_ID,
        domainEventId: EVENT_ID,
      }),
    ).rejects.toThrow(dbError);
  });
});

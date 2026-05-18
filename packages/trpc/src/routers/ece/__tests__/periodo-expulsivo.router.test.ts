/**
 * Tests unitarios — ecePeriodoExpulsivo router (NTEC Doc 14).
 *
 * Cubre:
 *  1. debeEmitirAlertaHPP: false cuando alumbramiento ≤ 30 min post-nacimiento
 *  2. debeEmitirAlertaHPP: true cuando alumbramiento > 30 min post-nacimiento
 *  3. debeEmitirAlertaHPP: false cuando no existe evento nacimiento
 *  4. findEventoTimestamp: retorna Date del evento correcto
 *  5. findEventoTimestamp: retorna null si tipo no existe
 *  6. list: lanza BAD_REQUEST sin establecimiento activo
 *  7. get: lanza NOT_FOUND cuando sala no existe en BD
 *  8. listEventos: devuelve array vacío si sala sin eventos
 *  9. registrarEvento: happy-path sin alerta HPP
 * 10. registrarEvento: emite alertaHPP=true cuando intervalo > 30 min
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// Mockear @his/database antes de importar el router para que emitDomainEvent
// sea un spy controlable. El stub del worktree no exporta emitDomainEvent correctamente.
vi.mock("@his/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@his/database")>().catch(() => ({}));
  return {
    ...actual,
    emitDomainEvent: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  periodoExpulsivoRouter,
  debeEmitirAlertaHPP,
  findEventoTimestamp,
  type ExpulsionEvento,
} from "../periodo-expulsivo.router";
import { makeCtx } from "../../../__tests__/helpers/caller";
import { MOCK_TENANT, MOCK_TENANT_NO_ESTABLISHMENT } from "@his/test-utils";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SALA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ESTAB_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const PHYSICIAN_TENANT = {
  ...MOCK_TENANT,
  roleCodes: ["PHYSICIAN"] as string[],
  establishmentId: ESTAB_ID,
};

const nacimientoTs = new Date("2026-05-17T10:00:00Z");

const eventoNacimiento: ExpulsionEvento = {
  id: "ev-nac",
  tipo: "nacimiento",
  timestamp: nacimientoTs.toISOString(),
};

const SALA_RAW = {
  id: SALA_ID,
  episodio_hospitalario_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  tipo_parto: "eutocico",
  inicio_expulsivo_ts: null,
  nacimiento_ts: nacimientoTs,
  alumbramiento_ts: null,
  sangrado_estimado_ml: null,
  episiotomia: false,
  desgarro_perineal_grado: null,
  estado_registro: "borrador",
  registrado_en: new Date("2026-05-17T09:00:00Z"),
  eventos: [eventoNacimiento],
};

// ─── Helper Prisma ─────────────────────────────────────────────────────────────

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: typeof prisma) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  return prisma;
}

// ─── Helpers puros (sin BD) ───────────────────────────────────────────────────

describe("findEventoTimestamp", () => {
  // 4 — encontrado
  it("retorna Date del evento cuando tipo existe", () => {
    const ts = findEventoTimestamp([eventoNacimiento], "nacimiento");
    expect(ts).toEqual(nacimientoTs);
  });

  // 5 — no encontrado
  it("retorna null cuando el tipo no está en el array", () => {
    const ts = findEventoTimestamp([eventoNacimiento], "alumbramiento");
    expect(ts).toBeNull();
  });
});

describe("debeEmitirAlertaHPP", () => {
  // 1 — dentro del umbral (20 min ≤ 30 min → no alerta)
  it("retorna false cuando alumbramiento ocurre en ≤ 30 min post-nacimiento", () => {
    const alumbramiento = new Date(nacimientoTs.getTime() + 20 * 60 * 1000);
    expect(debeEmitirAlertaHPP([eventoNacimiento], alumbramiento)).toBe(false);
  });

  // 2 — fuera del umbral (35 min > 30 min → alerta)
  it("retorna true cuando alumbramiento ocurre > 30 min post-nacimiento", () => {
    const alumbramiento = new Date(nacimientoTs.getTime() + 35 * 60 * 1000);
    expect(debeEmitirAlertaHPP([eventoNacimiento], alumbramiento)).toBe(true);
  });

  // 3 — sin evento nacimiento (no se puede calcular → no alerta)
  it("retorna false cuando no existe evento nacimiento", () => {
    const alumbramiento = new Date(nacimientoTs.getTime() + 40 * 60 * 1000);
    expect(debeEmitirAlertaHPP([], alumbramiento)).toBe(false);
  });
});

// ─── Router (con Prisma mock) ─────────────────────────────────────────────────

describe("periodoExpulsivoRouter", () => {
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = makePrisma();
    vi.clearAllMocks();
  });

  // 6 — list sin establecimiento activo
  it("list: lanza BAD_REQUEST si no hay establecimiento activo", async () => {
    const caller = periodoExpulsivoRouter.createCaller(
      makeCtx({
        prisma,
        tenant: { ...MOCK_TENANT_NO_ESTABLISHMENT, roleCodes: ["PHYSICIAN", "MC"] },
      }),
    );
    await expect(caller.list({})).rejects.toThrow("establecimiento activo");
  });

  // 7 — get NOT_FOUND
  it("get: lanza NOT_FOUND cuando la sala no existe", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    const caller = periodoExpulsivoRouter.createCaller(
      makeCtx({ prisma, tenant: PHYSICIAN_TENANT }),
    );
    await expect(caller.get({ id: SALA_ID })).rejects.toThrow("no encontrado");
  });

  // 8 — listEventos array vacío
  it("listEventos: devuelve array vacío cuando sala existe sin eventos", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ eventos: [] }]);
    const caller = periodoExpulsivoRouter.createCaller(
      makeCtx({ prisma, tenant: PHYSICIAN_TENANT }),
    );
    const result = await caller.listEventos({ salaId: SALA_ID });
    expect(result).toEqual([]);
  });

  // 9 — registrarEvento happy-path (sin alerta HPP)
  it("registrarEvento: retorna ok=true y alertaHPP=false para evento no-alumbramiento", async () => {
    // Primera query dentro de la tx: carga la sala
    prisma.$queryRaw.mockResolvedValueOnce([SALA_RAW]);

    const caller = periodoExpulsivoRouter.createCaller(
      makeCtx({ prisma, tenant: PHYSICIAN_TENANT }),
    );
    const result = await caller.registrarEvento({
      salaId: SALA_ID,
      tipo: "inicio_pujos",
    });

    expect(result.ok).toBe(true);
    expect(result.alertaHPP).toBe(false);
    expect(typeof result.eventoId).toBe("string");
  });

  // 10 — registrarEvento con alerta HPP
  it("registrarEvento: alertaHPP=true cuando alumbramiento > 30 min post-nacimiento", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([SALA_RAW]);
    // emitDomainEvent hace $executeRaw internamente (ya mockeado con mockResolvedValue(0))

    const alumbramiento = new Date(nacimientoTs.getTime() + 35 * 60 * 1000);

    const caller = periodoExpulsivoRouter.createCaller(
      makeCtx({ prisma, tenant: PHYSICIAN_TENANT }),
    );
    const result = await caller.registrarEvento({
      salaId: SALA_ID,
      tipo: "alumbramiento",
      timestamp: alumbramiento,
    });

    expect(result.ok).toBe(true);
    expect(result.alertaHPP).toBe(true);
  });
});

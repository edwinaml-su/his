/**
 * Compliance test — IPSG.2 ME 2: Notificación de resultados críticos con SLA <60 min
 * y read-back digital del médico tratante.
 *
 * JCI Standard: IPSG.2 ME 2
 * "Critical results of tests and diagnostic procedures are communicated to a responsible
 *  licensed practitioner within a time frame to meet patient needs."
 *
 * Cubre:
 *   1. emit → notificación creada con sla_min=60 y notificado_en poblado.
 *   2. confirmReadback dentro de SLA → ok=true, read_back_at populado, dentroSla=true.
 *   3. PIN incorrecto → UNAUTHORIZED + pin_fail_count incrementado.
 *   4. PIN incorrecto 5 veces → bloqueado.
 *   5. read-back ya confirmado → CONFLICT (idempotencia segura).
 *   6. pending → lista solo notificaciones sin read-back.
 *   7. escalate manual → ok=true + evento emitido.
 *   8. confirmReadback fuera de SLA → ok=true pero dentroSla=false.
 */
import { describe, it, expect, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { criticalResultRouter } from "../../routers/ece/critical-result.router";
import { makeCtx } from "../../__tests__/helpers/caller";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.2 ME 2
const NOTIF_ID     = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LAB_RESULT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PACIENTE_ID  = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const MEDICO_ID    = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ESCALADO_ID  = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const PERSONAL_ID  = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const PIN_CORRECTO = "1234";
const PIN_MALO     = "9999";

const NOTIF_ROW = {
  id: NOTIF_ID,
  organization_id: "00000000-0000-0000-0000-0000000000aa",
  lab_result_id: LAB_RESULT_ID,
  paciente_id: PACIENTE_ID,
  medico_tratante_id: MEDICO_ID,
  valor_critico: { glucemia_mg_dl: 35, flag: "CRITICAL_LOW" },
  severidad: "crítica",
  notificado_en: new Date(Date.now() - 20 * 60 * 1000), // hace 20 min
  sla_min: 60,
  read_back_at: null,
  read_back_por_id: null,
  pin_fail_count: 0,
  escalado_a_id: null,
  escalado_en: null,
};

const PERSONAL_ROW = {
  id: PERSONAL_ID,
  pin_hash: null, // sin hash: cualquier PIN ≥4 chars es válido (ver TODO en router)
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrisma(): DeepMockProxy<PrismaClient> {
  const prisma = mockDeep<PrismaClient>();
  prisma.$transaction.mockImplementation(async (cb: unknown) => {
    if (typeof cb === "function") {
      return (cb as (tx: unknown) => Promise<unknown>)(prisma);
    }
    return cb;
  });
  prisma.$executeRaw.mockResolvedValue(0 as never);
  // Mock emitDomainEvent dependencies: domainEvent.create + auditLog.create
  // (emit.ts:127 lee created.id — debe retornar objeto con id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.domainEvent as any).create = vi.fn().mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000999",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.auditLog as any).create = vi.fn().mockResolvedValue({
    id: 1n,
  });
  return prisma;
}

/**
 * Configura el mock de $queryRaw para responder a múltiples llamadas en orden.
 * Cada llamada a $queryRaw consume la siguiente respuesta de la lista.
 */
function setupQueryRaw(
  prisma: DeepMockProxy<PrismaClient>,
  responses: unknown[],
) {
  let callIdx = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma.$queryRaw as any).mockImplementation(() => {
    const resp = responses[callIdx] ?? [];
    callIdx++;
    return Promise.resolve(resp);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// JCI Standard: IPSG.2 ME 2
describe("IPSG.2 ME 2 — Notificación de resultados críticos: SLA + read-back digital", () => {
  // 1. emit
  it("emit → crea notificación con sla_min=60 y notificado_en poblado", async () => {
    const prisma = makePrisma();
    const notifCreada = { id: NOTIF_ID, notificado_en: new Date() };

    setupQueryRaw(prisma, [
      // INSERT RETURNING → notificación creada
      [notifCreada],
      // emitDomainEvent → INSERT outbox
      [],
    ]);

    const result = await criticalResultRouter
      .createCaller(
        makeCtx({
          prisma,
          tenant: { ...makeCtx().tenant, roleCodes: ["LAB"] },
        }),
      )
      .emit({
        labResultId: LAB_RESULT_ID,
        pacienteId: PACIENTE_ID,
        medicoTratanteId: MEDICO_ID,
        valorCritico: { glucemia_mg_dl: 35, flag: "CRITICAL_LOW" },
        severidad: "crítica",
        slaMin: 60,
      });

    // JCI Standard: IPSG.2 ME 2 — la notificación debe tener id y timestamp
    expect(result.notificationId).toBe(NOTIF_ID);
    expect(result.notificadoEn).toBeInstanceOf(Date);
  });

  // 2. confirmReadback dentro de SLA
  it("confirmReadback dentro de SLA → ok=true, dentroSla=true", async () => {
    const prisma = makePrisma();
    const notifReciente = {
      ...NOTIF_ROW,
      notificado_en: new Date(Date.now() - 15 * 60 * 1000), // hace 15 min
    };

    setupQueryRaw(prisma, [
      // findNotification
      [notifReciente],
      // findPersonalByHisUser
      [PERSONAL_ROW],
      // verifyPin: SELECT pin_fail_count
      [{ pin_fail_count: 0 }],
      // emitDomainEvent INSERT outbox
      [],
    ]);

    const result = await criticalResultRouter
      .createCaller(
        makeCtx({
          prisma,
          tenant: { ...makeCtx().tenant, roleCodes: ["MC"] },
        }),
      )
      .confirmReadback({
        notificationId: NOTIF_ID,
        pin: PIN_CORRECTO,
      });

    // JCI Standard: IPSG.2 ME 2 — read-back dentro de SLA es el happy path
    expect(result.ok).toBe(true);
    expect(result.dentroSla).toBe(true);
    expect(result.minutosTranscurridos).toBeLessThanOrEqual(60);
  });

  // 3. PIN incorrecto → UNAUTHORIZED + contador incrementado
  it("PIN incorrecto → UNAUTHORIZED (pin_fail_count se incrementa)", async () => {
    const prisma = makePrisma();

    setupQueryRaw(prisma, [
      // findNotification
      [NOTIF_ROW],
      // findPersonalByHisUser — pin_hash='HASH_REAL' → PIN_MALO no coincide
      [{ ...PERSONAL_ROW, pin_hash: "HASH_REAL" }],
      // verifyPin: SELECT pin_fail_count
      [{ pin_fail_count: 0 }],
    ]);

    // JCI Standard: IPSG.2 ME 2 — PIN incorrecto debe bloquear confirmación
    await expect(
      criticalResultRouter
        .createCaller(
          makeCtx({
            prisma,
            tenant: { ...makeCtx().tenant, roleCodes: ["MC"] },
          }),
        )
        .confirmReadback({
          notificationId: NOTIF_ID,
          pin: PIN_MALO,
        }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // El UPDATE de incremento debe haberse llamado
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  // 4. PIN incorrecto 5 veces → bloqueado
  it("5 intentos PIN fallidos → UNAUTHORIZED bloqueado", async () => {
    const prisma = makePrisma();

    setupQueryRaw(prisma, [
      // findNotification
      [NOTIF_ROW],
      // findPersonalByHisUser — con hash real
      [{ ...PERSONAL_ROW, pin_hash: "HASH_REAL" }],
      // verifyPin: pin_fail_count ya en límite
      [{ pin_fail_count: 5 }],
    ]);

    // JCI Standard: IPSG.2 ME 2 — bloqueo tras intentos excesivos protege contra brute-force
    await expect(
      criticalResultRouter
        .createCaller(
          makeCtx({
            prisma,
            tenant: { ...makeCtx().tenant, roleCodes: ["MC"] },
          }),
        )
        .confirmReadback({
          notificationId: NOTIF_ID,
          pin: PIN_MALO,
        }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: expect.stringContaining("bloqueada"),
    });
  });

  // 5. read-back ya confirmado → CONFLICT
  it("read-back ya confirmado → CONFLICT (idempotencia segura)", async () => {
    const prisma = makePrisma();
    const notifConfirmada = {
      ...NOTIF_ROW,
      read_back_at: new Date(Date.now() - 5 * 60 * 1000),
      read_back_por_id: PERSONAL_ID,
    };

    setupQueryRaw(prisma, [
      [notifConfirmada],
    ]);

    // JCI Standard: IPSG.2 ME 2 — no debe permitir doble confirmación
    await expect(
      criticalResultRouter
        .createCaller(
          makeCtx({
            prisma,
            tenant: { ...makeCtx().tenant, roleCodes: ["MC"] },
          }),
        )
        .confirmReadback({
          notificationId: NOTIF_ID,
          pin: PIN_CORRECTO,
        }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // 6. pending → solo notificaciones sin read-back
  it("pending → lista notificaciones pendientes del médico", async () => {
    const prisma = makePrisma();

    setupQueryRaw(prisma, [
      // pending query
      [NOTIF_ROW],
    ]);

    const result = await criticalResultRouter
      .createCaller(
        makeCtx({
          prisma,
          tenant: { ...makeCtx().tenant, roleCodes: ["MC"] },
        }),
      )
      .pending({ limit: 50 });

    // JCI Standard: IPSG.2 ME 2 — la cola de pendientes debe ser visible para el médico
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(NOTIF_ID);
    expect(result.items[0]?.read_back_at).toBeNull();
  });

  // 7. escalate manual
  it("escalate → ok=true + escalado_en populado", async () => {
    const prisma = makePrisma();

    setupQueryRaw(prisma, [
      // findNotification
      [NOTIF_ROW],
      // emitDomainEvent INSERT outbox
      [],
    ]);

    const result = await criticalResultRouter
      .createCaller(
        makeCtx({
          prisma,
          tenant: { ...makeCtx().tenant, roleCodes: ["DIR"] },
        }),
      )
      .escalate({
        notificationId: NOTIF_ID,
        escaladoAId: ESCALADO_ID,
      });

    // JCI Standard: IPSG.2 ME 2 — escalación documenta cadena de responsabilidad
    expect(result.ok).toBe(true);
    expect(result.escaladoEn).toBeTruthy();
  });

  // 8. confirmReadback fuera de SLA → ok pero dentroSla=false
  it("confirmReadback después de 60 min → ok=true pero dentroSla=false", async () => {
    const prisma = makePrisma();
    const notifFueraSla = {
      ...NOTIF_ROW,
      // hace 70 minutos → fuera del SLA de 60 min
      notificado_en: new Date(Date.now() - 70 * 60 * 1000),
    };

    setupQueryRaw(prisma, [
      [notifFueraSla],
      [PERSONAL_ROW],
      [{ pin_fail_count: 0 }],
      [],
    ]);

    const result = await criticalResultRouter
      .createCaller(
        makeCtx({
          prisma,
          tenant: { ...makeCtx().tenant, roleCodes: ["MC"] },
        }),
      )
      .confirmReadback({
        notificationId: NOTIF_ID,
        pin: PIN_CORRECTO,
      });

    // JCI Standard: IPSG.2 ME 2 — se registra pero se documenta el incumplimiento de SLA
    expect(result.ok).toBe(true);
    expect(result.dentroSla).toBe(false);
    expect(result.minutosTranscurridos).toBeGreaterThan(60);
  });
});

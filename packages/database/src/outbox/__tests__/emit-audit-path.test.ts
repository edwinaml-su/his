/**
 * P0-0 (sql/206) — camino de escritura del audit log en `emitDomainEvent`.
 *
 * El rol `authenticated` NO tiene GRANT INSERT sobre audit."AuditLog", así que
 * un emisor demotado debe escribir la entrada por la función SECURITY DEFINER
 * `audit.fn_write_manual_audit_entry`. Un emisor que corre con el rol
 * privilegiado (fuera de withTenantContext) conserva el INSERT directo.
 *
 * Estos tests fijan esa bifurcación, que es lo único que puede volver a
 * romper R02 en escrituras si alguien la revierte por descuido.
 */
import { describe, it, expect, vi } from "vitest";
import { emitDomainEvent } from "../emit";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

/**
 * @param hasTenantContext qué devuelve la sonda `public.current_org_id()`.
 *   `undefined` simula un mock que no stubea la sonda — el caso de los tests
 *   preexistentes, que deben seguir viendo el INSERT directo.
 */
function makeTx(hasTenantContext: boolean | undefined) {
  return {
    domainEvent: {
      create: vi.fn().mockResolvedValue({ id: "evt-1" }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 1n }),
    },
    $queryRaw: vi.fn().mockResolvedValue(
      hasTenantContext === undefined ? undefined : [{ hasTenantContext }],
    ),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

const INDICACION_ID = "00000000-0000-0000-0000-000000000003";
const EPISODIO_ID = "00000000-0000-0000-0000-000000000004";

const input = {
  organizationId: ORG_ID,
  eventType: "ece.indicaciones.firmadas",
  aggregateType: "Indicacion",
  aggregateId: INDICACION_ID,
  payload: {
    indicacionId: INDICACION_ID,
    episodioId: EPISODIO_ID,
    medicoId: USER_ID,
    itemCount: 3,
    organizationId: ORG_ID,
  },
  emittedById: USER_ID,
} as const;

describe("emitDomainEvent — camino de audit", () => {
  it("con contexto de tenant usa la función SECURITY DEFINER, no el INSERT directo", async () => {
    const tx = makeTx(true);

    await emitDomainEvent(tx as never, input as never);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();

    // La llamada debe ir a la función aprobada — si alguien la cambia por un
    // INSERT directo, el rol demotado vuelve a reventar con permission denied.
    const sql = tx.$executeRaw.mock.calls[0]![0] as unknown as string[];
    expect(sql.join("")).toContain("audit.fn_write_manual_audit_entry");
  });

  it("sin contexto de tenant conserva el INSERT directo (rol privilegiado)", async () => {
    const tx = makeTx(false);

    await emitDomainEvent(tx as never, input as never);

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("si la sonda no está stubeada, cae al INSERT directo sin lanzar", async () => {
    const tx = makeTx(undefined);

    await expect(emitDomainEvent(tx as never, input as never)).resolves.toBeDefined();

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("el evento de dominio se inserta siempre, por cualquiera de los dos caminos", async () => {
    for (const ctx of [true, false] as const) {
      const tx = makeTx(ctx);
      await emitDomainEvent(tx as never, input as never);
      expect(tx.domainEvent.create).toHaveBeenCalledTimes(1);
    }
  });
});

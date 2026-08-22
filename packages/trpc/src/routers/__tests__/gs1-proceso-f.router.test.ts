/**
 * Tests unitarios: gs1ProcesoFRouter.autorizarDevolucion — R03.
 *
 * Cubre el fix del bug de identidad documentado en la cabecera del router:
 * `autorizado_por` tiene FK a `ece.personal_salud(id)`, y el código pasaba
 * `ctx.user.id` (espacio de ids `public."User"`) directo — violación de FK
 * garantizada. El fix resuelve `ece.personal_salud.id` real vía
 * `requirePersonalSalud` antes del UPDATE.
 *
 * Estrategia: `withEceContext` real (no se mockea el módulo) — se mockean
 * `$transaction` (passthrough), `$executeRaw`/`$executeRawUnsafe` (SET LOCAL
 * del contexto ECE) y `$queryRaw`/`$queryRawUnsafe` (mismo patrón que
 * gs1-gln-hierarchy.router.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { gs1ProcesoFRouter } from "../gs1-proceso-f.router";
import { makeCtx } from "../../__tests__/helpers/caller";
import { MOCK_USER_ADMIN } from "@his/test-utils";

const PERSONAL_ID = "00000000-0000-0000-0000-0000000000f1";
const DEVOLUCION_ID = "00000000-0000-0000-0000-0000000000f2";

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  vi.clearAllMocks();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRaw = vi.fn().mockResolvedValue(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$executeRawUnsafe = vi.fn().mockResolvedValue(1);
});

describe("gs1ProcesoF.autorizarDevolucion", () => {
  it("resuelve ece.personal_salud.id y lo pasa a autorizado_por — NO ctx.user.id", async () => {
    // requirePersonalSalud (dentro de la tx ECE) usa $queryRaw tagged template.
    prisma.$queryRaw = vi.fn().mockResolvedValue([
      { id: PERSONAL_ID, nombre_completo: "Dra. Autorizante" },
    ]) as unknown as typeof prisma.$queryRaw;
    // El UPDATE de devolucion_inventario usa $queryRawUnsafe.
    prisma.$queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([{ id: DEVOLUCION_ID, estado: "autorizado" }]) as unknown as typeof prisma.$queryRawUnsafe;

    const caller = gs1ProcesoFRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.autorizarDevolucion({ devolucionId: DEVOLUCION_ID });

    expect(result).toEqual({ id: DEVOLUCION_ID, estado: "autorizado" });

    const unsafeCalls = (prisma.$queryRawUnsafe as ReturnType<typeof vi.fn>).mock.calls;
    expect(unsafeCalls).toHaveLength(1);
    const [, autorizadoPorParam] = unsafeCalls[0]!;
    // El primer parámetro posicional ($1 = autorizado_por) debe ser el id ECE
    // resuelto — nunca el id de sesión HIS.
    expect(autorizadoPorParam).toBe(PERSONAL_ID);
    expect(autorizadoPorParam).not.toBe(MOCK_USER_ADMIN.id);
  });

  it("PRECONDITION_FAILED cuando el usuario no tiene ece.personal_salud vinculado", async () => {
    prisma.$queryRaw = vi.fn().mockResolvedValue([]) as unknown as typeof prisma.$queryRaw;
    prisma.$queryRawUnsafe = vi.fn();

    const caller = gs1ProcesoFRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.autorizarDevolucion({ devolucionId: DEVOLUCION_ID }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // No debe intentar el UPDATE si la identidad no resolvió.
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

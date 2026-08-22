/**
 * Tests unitarios: personalSaludRouter — R03 (identidad HIS↔ECE).
 *
 * Cubre el fix de cierre de R03: este router es el ÚNICO camino de alta en
 * producción para `ece.personal_salud`, y antes de este cambio ningún
 * procedure poblaba `his_user_id` — el bridge que
 * `packages/trpc/src/lib/identity-resolver.ts` y ~100 lecturas dispersas en
 * otros 48 archivos resuelven. Sin esto, aunque un ADMIN diera de alta y
 * "vinculara" un profesional con la UI existente, `requirePersonalSalud`
 * seguía fallando para ese usuario.
 *
 * Foco: `linkAuthUser`, `unlinkAuthUser`, `createAndLinkUser` — los tres
 * procedures tocados. No se cubre el resto del router (list/get/create/
 * update/setActive/listRoles/getPacientesReferidos/getReporteMedico), que
 * no se modificó en este cambio y no tenía tests previos (gap preexistente,
 * fuera de alcance).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { personalSaludRouter } from "../personal-salud.router";
import { makeCtx } from "../../__tests__/helpers/caller";

const PERSONAL_ID = "00000000-0000-0000-0000-0000000000e1";
const USER_ID = "00000000-0000-0000-0000-0000000000e2";
const OTHER_PERSONAL_ID = "00000000-0000-0000-0000-0000000000e3";

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  vi.clearAllMocks();
});

describe("personalSalud.linkAuthUser", () => {
  it("setea auth_user_id Y his_user_id al mismo input.userId (R03 fix)", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID }]) // target: personal existe
      .mockResolvedValueOnce([]); // alreadyLinked: sin colisión
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: "dra.perez@avante.test",
      active: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    prisma.$executeRaw.mockResolvedValue(1);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.linkAuthUser({ personalId: PERSONAL_ID, userId: USER_ID });

    expect(result).toEqual({ id: PERSONAL_ID, userEmail: "dra.perez@avante.test" });

    // El UPDATE debe interpolar el mismo userId para ambas columnas.
    const call = prisma.$executeRaw.mock.calls[0]!;
    const strings = call[0] as unknown as TemplateStringsArray;
    const sql = strings.join("?");
    expect(sql).toContain("auth_user_id");
    expect(sql).toContain("his_user_id");
    // Ambos placeholders reciben USER_ID (dos ocurrencias entre los valores interpolados).
    const interpolated = call.slice(1);
    expect(interpolated.filter((v) => v === USER_ID)).toHaveLength(2);
  });

  it("CONFLICT (pre-check) cuando el usuario ya está vinculado a otro personal por auth_user_id o his_user_id", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID }]) // target existe
      .mockResolvedValueOnce([{ id: OTHER_PERSONAL_ID }]); // alreadyLinked: otro personal
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: "dra.perez@avante.test",
      active: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.linkAuthUser({ personalId: PERSONAL_ID, userId: USER_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("CONFLICT (carrera) cuando el UPDATE viola la unicidad de his_user_id — no propaga el error crudo de Postgres", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID }])
      .mockResolvedValueOnce([]); // pre-check pasó, pero otra request ganó la carrera
    prisma.user.findUnique.mockResolvedValue({
      id: USER_ID,
      email: "dra.perez@avante.test",
      active: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    prisma.$executeRaw.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "personal_salud_his_user_id_key" (23505)',
      ),
    );

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.linkAuthUser({ personalId: PERSONAL_ID, userId: USER_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("NOT_FOUND si el personal no existe en el establecimiento del tenant", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]); // target no encontrado

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.linkAuthUser({ personalId: PERSONAL_ID, userId: USER_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("personalSalud.unlinkAuthUser", () => {
  it("limpia solo auth_user_id — NO toca his_user_id (bridge de identidad primario)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID }]); // target existe
    prisma.$executeRaw.mockResolvedValue(1);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.unlinkAuthUser({ personalId: PERSONAL_ID });

    expect(result).toEqual({ id: PERSONAL_ID });
    const call = prisma.$executeRaw.mock.calls[0]!;
    const strings = call[0] as unknown as TemplateStringsArray;
    const sql = strings.join("?");
    expect(sql).toContain("auth_user_id");
    expect(sql).not.toContain("his_user_id");
  });
});

describe("personalSalud.createAndLinkUser", () => {
  it("crea el User y setea auth_user_id Y his_user_id con el mismo id recién creado (R03 fix)", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID, auth_user_id: null }]); // target sin cuenta previa
    prisma.user.findUnique.mockResolvedValue(null); // email disponible
    prisma.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return (fn as (tx: unknown) => unknown)(prisma);
      }
      return fn;
    });
    prisma.user.create.mockResolvedValue({
      id: USER_ID,
      email: "nuevo.medico@avante.test",
      fullName: "Dr. Nuevo Médico",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    prisma.$executeRaw.mockResolvedValue(1);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.createAndLinkUser({
      personalId: PERSONAL_ID,
      email: "nuevo.medico@avante.test",
      fullName: "Dr. Nuevo Médico",
    });

    expect(result).toEqual({
      userId: USER_ID,
      email: "nuevo.medico@avante.test",
      fullName: "Dr. Nuevo Médico",
    });

    const call = prisma.$executeRaw.mock.calls[0]!;
    const strings = call[0] as unknown as TemplateStringsArray;
    const sql = strings.join("?");
    expect(sql).toContain("auth_user_id");
    expect(sql).toContain("his_user_id");
    const interpolated = call.slice(1);
    expect(interpolated.filter((v) => v === USER_ID)).toHaveLength(2);
  });

  it("CONFLICT (carrera) si el UPDATE final viola la unicidad de his_user_id", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: PERSONAL_ID, auth_user_id: null }]);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(async (fn: unknown) => {
      if (typeof fn === "function") {
        return (fn as (tx: unknown) => unknown)(prisma);
      }
      return fn;
    });
    prisma.user.create.mockResolvedValue({
      id: USER_ID,
      email: "nuevo.medico@avante.test",
      fullName: "Dr. Nuevo Médico",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    prisma.$executeRaw.mockRejectedValue(
      new Error('duplicate key value violates unique constraint (23505)'),
    );

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.createAndLinkUser({
        personalId: PERSONAL_ID,
        email: "nuevo.medico@avante.test",
        fullName: "Dr. Nuevo Médico",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

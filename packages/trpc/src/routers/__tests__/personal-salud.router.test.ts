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
 * procedures tocados por R03. No se cubre el resto del router (list/get/
 * create/setActive/listRoles/getPacientesReferidos/getReporteMedico), que no
 * se modificó en ese cambio y no tenía tests previos (gap preexistente,
 * fuera de alcance).
 *
 * D4b (R3B) agrega cobertura de `update` — específicamente el campo nuevo
 * `documentoIdentidad` (permite corregir los centinelas `PENDIENTE-DUI-*`
 * del sync R1.1) y su validación condicional de DUI.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { personalSaludRouter, CLINICAL_ROLE_CODES } from "../personal-salud.router";
import { makeCtx, installTenantContextMock } from "../../__tests__/helpers/caller";
import { VALID_DUIS_WITH_DASH, INVALID_DUIS } from "@his/test-utils";

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

describe("personalSalud.usuariosSinPerfil", () => {
  const USER_LINKED = "00000000-0000-0000-0000-0000000000e4";
  const USER_UNLINKED = "00000000-0000-0000-0000-0000000000e5";

  it("excluye Users cuyo id ya está vinculado por his_user_id", async () => {
    installTenantContextMock(prisma);
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { id: USER_LINKED, full_name: "Dr. Ya Vinculado", email: "vinculado@avante.test", role_codes: ["MC"] },
        { id: USER_UNLINKED, full_name: "Dra. Sin Perfil", email: "sinperfil@avante.test", role_codes: ["ENF"] },
      ]) // query de Users con rol clínico (dentro de withTenantContext)
      .mockResolvedValueOnce([{ his_user_id: USER_LINKED }]); // ya vinculados globalmente

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.usuariosSinPerfil({ limit: 100 });

    expect(result).toEqual([
      { userId: USER_UNLINKED, nombre: "Dra. Sin Perfil", email: "sinperfil@avante.test", roles: ["ENF"] },
    ]);
  });

  it("devuelve [] sin consultar personal_salud cuando no hay Users con rol clínico", async () => {
    installTenantContextMock(prisma);
    prisma.$queryRaw.mockResolvedValueOnce([]); // sin candidatos

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.usuariosSinPerfil({ limit: 100 });

    expect(result).toEqual([]);
    // Solo la query de Users — el check de personal_salud se salta.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("filtra la query de Users por los códigos de rol clínico esperados", async () => {
    installTenantContextMock(prisma);
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await caller.usuariosSinPerfil({ limit: 50 });

    const call = prisma.$queryRaw.mock.calls[0]!;
    const interpolated = call.slice(1);
    expect(interpolated).toContainEqual(Array.from(CLINICAL_ROLE_CODES));
  });
});

describe("personalSalud.update — D4b documentoIdentidad", () => {
  it("permite corregir el documento (ej. centinela PENDIENTE-DUI-*) con un DUI válido", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID, documento_identidad: "PENDIENTE-DUI-0001" }]) // target existe
      .mockResolvedValueOnce([]); // sin colisión de documento en el establecimiento
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(1);

    const validDui = VALID_DUIS_WITH_DASH[9]!; // "12345678-4" — fixture canónico
    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.update({ id: PERSONAL_ID, documentoIdentidad: validDui });

    expect(result).toEqual({ id: PERSONAL_ID });
    const call = prisma.$executeRaw.mock.calls[0]!;
    expect(call.slice(1)).toContain(validDui);
  });

  it("acepta documentos que NO tienen forma de DUI (pasaporte/DPI extranjero) sin exigir checksum", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID, documento_identidad: "PENDIENTE-DUI-0002" }])
      .mockResolvedValueOnce([]);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(1);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    // Pasaporte alfanumérico — no son 9 dígitos, el refine de zod no aplica validateDUI.
    const result = await caller.update({ id: PERSONAL_ID, documentoIdentidad: "P1234567A" });

    expect(result).toEqual({ id: PERSONAL_ID });
  });

  it("rechaza un documento con forma de DUI pero dígito verificador inválido (BAD_REQUEST de zod)", async () => {
    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));

    // 9 dígitos → se le exige el checksum; INVALID_DUIS.badCheck altera el
    // verificador de un cuerpo válido (fixture canónico de @his/test-utils).
    await expect(
      caller.update({ id: PERSONAL_ID, documentoIdentidad: INVALID_DUIS.badCheck }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // El zod refine corta antes de tocar la BD.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("lanza CONFLICT si el nuevo documento ya pertenece a otro profesional del establecimiento", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID, documento_identidad: "PENDIENTE-DUI-0003" }]) // target existe
      .mockResolvedValueOnce([{ id: OTHER_PERSONAL_ID }]); // colisión

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.update({ id: PERSONAL_ID, documentoIdentidad: "P1234567A" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("P2-1: traduce la violación del índice único parcial (carrera) a CONFLICT", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID, documento_identidad: "PENDIENTE-DUI-0004" }]) // target existe
      .mockResolvedValueOnce([]); // el dup-check previo NO detecta nada (perdió la carrera)
    // El $executeRaw dentro de la tx revienta con la violación real de
    // Postgres del índice de 264_r3_unique_documento_personal.sql — otra
    // request concurrente ya insertó el mismo documento entre el dup-check
    // y este UPDATE.
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.$executeRaw.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "ux_personal_salud_estab_documento" (23505)',
      ),
    );

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await expect(
      caller.update({ id: PERSONAL_ID, documentoIdentidad: "P1234567A" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("P1: audita el cambio de documentoIdentidad con before/after fuera de la tx (TDR §6.3)", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID, documento_identidad: "PENDIENTE-DUI-0005" }]) // target existe
      .mockResolvedValueOnce([]); // sin colisión
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.auditLog.create.mockResolvedValue({} as never);

    const validDui = VALID_DUIS_WITH_DASH[9]!;
    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    const result = await caller.update({ id: PERSONAL_ID, documentoIdentidad: validDui });

    expect(result).toEqual({ id: PERSONAL_ID });
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArgs = prisma.auditLog.create.mock.calls[0]![0];
    expect(auditArgs.data).toMatchObject({
      action: "UPDATE",
      entity: "PersonalSalud",
      entityId: PERSONAL_ID,
      beforeJson: { documentoIdentidad: "PENDIENTE-DUI-0005" },
      afterJson: { documentoIdentidad: validDui },
    });
  });

  it("P1: NO audita si documentoIdentidad no cambió de valor", async () => {
    const validDui = VALID_DUIS_WITH_DASH[9]!;
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: PERSONAL_ID, documento_identidad: validDui }]) // ya tenía este valor
      .mockResolvedValueOnce([]);
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(1);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await caller.update({ id: PERSONAL_ID, documentoIdentidad: validDui });

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("P1: NO audita cuando el update no toca documentoIdentidad", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: PERSONAL_ID, documento_identidad: "PENDIENTE-DUI-0006" },
    ]); // target existe; sin segunda llamada porque no hay dup-check (documentoIdentidad ausente)
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(1);

    const caller = personalSaludRouter.createCaller(makeCtx({ prisma }));
    await caller.update({ id: PERSONAL_ID, profesion: "Enfermería" });

    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

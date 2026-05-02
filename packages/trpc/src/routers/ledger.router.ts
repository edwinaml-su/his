/**
 * US-1.4 — Router multi-libro contable (Foxtrot).
 *
 * Procedures:
 *   - list                : libros por organización (default: org del tenant).
 *   - get                 : detalle + count de cuentas asociadas (stub Sprint 5).
 *   - create              : crea libro nuevo. Valida unicidad por (org, kind):
 *                           si ya existe ACTIVO → CONFLICT, si existe INACTIVO
 *                           → BAD_REQUEST con mensaje "reactivar".
 *   - update              : edita name / functionalCurrencyId (no kind ni org).
 *   - activate / deactivate : toggle del flag `active`. En MVP siempre permitido;
 *                           Sprint 5 validará que no haya transacciones financieras.
 *   - listKinds           : devuelve `[{kind, label, description}]` con literales es-SV.
 *   - roundingPolicy      : stub `{decimals: 2, mode: 'HALF_EVEN'}`. Sprint 5
 *                           implementará tabla `LedgerRoundingPolicy`.
 *
 * Autorización: todos los procedures son `protectedProcedure` y validan
 * membresía ADMIN vigente (UserOrganizationRole + role.code = 'ADMIN') sobre
 * la organización destino. Mismo patrón que `organization.setFunctionalCurrency`.
 *
 * Schemas: replicados inline (barrel `@his/contracts/schemas/index.ts` está
 * congelada). Fuente de verdad canónica:
 *   `packages/contracts/src/schemas/ledger.ts`.
 *
 * Registro en `_app.ts`: lo hace @Orq tras consolidar (este equipo NO toca _app.ts).
 *
 * NOTAS DE ESQUEMA (NO modificar):
 *   - `Ledger` tiene columna `code` (VARCHAR 40) con unique [orgId, code].
 *     Derivamos `code = kind` (string del enum) → garantiza un único registro
 *     por kind y org, sin requerir índice nuevo. La validación de "no existe
 *     ya un libro con ese kind" es la regla de negocio explícita del story.
 *   - `currencyId` (no `functionalCurrencyId`): el contract usa el nombre de
 *     dominio (`functionalCurrencyId`) para alinear con `Organization`; el
 *     router lo mapea al campo del schema.
 *
 * TODO(Sprint 5): jerarquía completa de plan de cuentas (`ChartOfAccounts`).
 * TODO(Sprint 5): bloquear deactivate cuando haya transacciones contables.
 * TODO(Sprint 5): `roundingPolicy` real con tabla persistida.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma, PrismaClient } from "@his/database";
import { router, protectedProcedure } from "../trpc";

// -----------------------------------------------------------------------------
// Schemas locales — espejo de `packages/contracts/src/schemas/ledger.ts`.
// -----------------------------------------------------------------------------

const ledgerKindEnum = z.enum([
  "FISCAL_LOCAL",
  "IFRS",
  "US_GAAP",
  "MANAGEMENT",
  "BUDGET",
  "STATISTICAL",
]);
type LedgerKindLocal = z.infer<typeof ledgerKindEnum>;

const ledgerListInput = z
  .object({
    organizationId: z.string().uuid().optional(),
    kind: ledgerKindEnum.optional(),
    activeOnly: z.boolean().optional(),
  })
  .optional();

const ledgerGetInput = z.object({
  id: z.string().uuid(),
});

const ledgerCreateInput = z.object({
  organizationId: z.string().uuid(),
  kind: ledgerKindEnum,
  name: z.string().trim().min(3).max(120),
  functionalCurrencyId: z.string().uuid(),
});

const ledgerUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(3).max(120).optional(),
  functionalCurrencyId: z.string().uuid().optional(),
});

const ledgerActivateInput = z.object({
  id: z.string().uuid(),
});

const ledgerRoundingPolicyInput = z.object({
  ledgerId: z.string().uuid(),
});

// -----------------------------------------------------------------------------
// Etiquetas es-SV por tipo de libro.
// -----------------------------------------------------------------------------

const LEDGER_KIND_LABELS: Record<LedgerKindLocal, { label: string; description: string }> = {
  FISCAL_LOCAL: {
    label: "Libro Fiscal Local",
    description: "Reporte fiscal local (Ministerio de Hacienda — es-SV).",
  },
  IFRS: {
    label: "Libro NIIF (IFRS)",
    description: "Reporte bajo Normas Internacionales de Información Financiera.",
  },
  US_GAAP: {
    label: "Libro US GAAP",
    description: "Reporte bajo principios contables generalmente aceptados (EE.UU.).",
  },
  MANAGEMENT: {
    label: "Libro Gerencial",
    description: "Libro de gestión interna (controlling, no regulatorio).",
  },
  BUDGET: {
    label: "Libro Presupuestario",
    description: "Seguimiento de presupuesto vs. ejecución.",
  },
  STATISTICAL: {
    label: "Libro Estadístico",
    description: "Indicadores no financieros (KPIs, métricas operativas).",
  },
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Verifica que el `ctx.user` tenga rol ADMIN vigente sobre `organizationId`.
 * Lanza FORBIDDEN si no. Pattern alineado con `organization.setFunctionalCurrency`.
 */
async function assertAdminMembership(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<void> {
  const now = new Date();
  const membership = await prisma.userOrganizationRole.findFirst({
    where: {
      userId,
      organizationId,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gte: now } }],
      role: { code: "ADMIN" },
    },
  });
  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Requiere rol ADMIN vigente en la organización.",
    });
  }
}

/**
 * Resuelve la organización efectiva: la del input si vino, si no la del tenant.
 * Si tampoco hay tenant, BAD_REQUEST.
 */
function resolveOrgId(
  inputOrgId: string | undefined,
  tenantOrgId: string | undefined,
): string {
  const orgId = inputOrgId ?? tenantOrgId;
  if (!orgId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Organización no especificada (sin tenant activo).",
    });
  }
  return orgId;
}

function rethrowPrisma(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Ya existe un libro de este tipo en la organización.",
      });
    }
    if (err.code === "P2003") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Moneda funcional u organización no existe.",
      });
    }
  }
  throw err;
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

export const ledgerRouter = router({
  /**
   * Listado de libros para una organización. Por defecto trae todos (activos
   * + inactivos). Filtros opcionales: kind, activeOnly.
   */
  list: protectedProcedure.input(ledgerListInput).query(async ({ ctx, input }) => {
    const orgId = resolveOrgId(input?.organizationId, ctx.tenant?.organizationId);
    await assertAdminMembership(ctx.prisma, ctx.user!.id, orgId);

    const rows = await ctx.prisma.ledger.findMany({
      where: {
        organizationId: orgId,
        ...(input?.kind ? { kind: input.kind } : {}),
        ...(input?.activeOnly ? { active: true } : {}),
      },
      orderBy: [{ active: "desc" }, { kind: "asc" }, { name: "asc" }],
      include: {
        currency: { select: { id: true, isoCode: true, name: true, symbol: true } },
      },
    });
    return rows;
  }),

  /**
   * Detalle de un libro + count de cuentas asociadas (stub Sprint 5: la tabla
   * `ChartOfAccounts` aún no existe; devolvemos 0).
   */
  get: protectedProcedure.input(ledgerGetInput).query(async ({ ctx, input }) => {
    const ledger = await ctx.prisma.ledger.findUnique({
      where: { id: input.id },
      include: {
        currency: { select: { id: true, isoCode: true, name: true, symbol: true } },
        organization: { select: { id: true, legalName: true, tradeName: true } },
      },
    });
    if (!ledger) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Libro no encontrado." });
    }
    await assertAdminMembership(ctx.prisma, ctx.user!.id, ledger.organizationId);

    // TODO(Sprint 5): `ctx.prisma.chartOfAccounts.count({ where: { ledgerId: input.id } })`.
    const accountsCount = 0;

    return { ...ledger, accountsCount };
  }),

  /**
   * Crea un libro nuevo en la organización.
   *
   * Reglas:
   *   1) Membresía ADMIN vigente.
   *   2) Currency activa.
   *   3) Si ya existe libro ACTIVO con ese kind en la org → CONFLICT.
   *   4) Si existe INACTIVO con ese kind → BAD_REQUEST con guía a "reactivar"
   *      (no creamos duplicado para preservar unique [orgId, code]).
   *
   * `code` se deriva del kind (string del enum). Esto satisface el unique
   * compuesto del schema y refuerza la regla "un libro por kind por org".
   */
  create: protectedProcedure
    .input(ledgerCreateInput)
    .mutation(async ({ ctx, input }) => {
      await assertAdminMembership(ctx.prisma, ctx.user!.id, input.organizationId);

      const currency = await ctx.prisma.currency.findUnique({
        where: { id: input.functionalCurrencyId },
        select: { id: true, active: true },
      });
      if (!currency) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Moneda no existe." });
      }
      if (!currency.active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La moneda funcional debe estar activa.",
        });
      }

      const existing = await ctx.prisma.ledger.findFirst({
        where: { organizationId: input.organizationId, kind: input.kind },
        select: { id: true, active: true },
      });
      if (existing) {
        if (existing.active) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe un libro activo de tipo ${input.kind} en esta organización.`,
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Existe un libro inactivo de tipo ${input.kind}. Reactívalo en lugar de crear uno nuevo.`,
        });
      }

      try {
        return await ctx.prisma.ledger.create({
          data: {
            organizationId: input.organizationId,
            kind: input.kind,
            code: input.kind, // unique [orgId, code] = unique [orgId, kind] por convención.
            name: input.name,
            currencyId: input.functionalCurrencyId,
            active: true,
          },
          include: {
            currency: { select: { id: true, isoCode: true, name: true, symbol: true } },
          },
        });
      } catch (err) {
        rethrowPrisma(err);
      }
    }),

  /**
   * Actualiza name y/o moneda funcional. NO permite cambiar kind ni org
   * (esos son inmutables una vez creado el libro: cambiarlos rompería la
   * cadena contable y el unique [orgId, code]).
   */
  update: protectedProcedure
    .input(ledgerUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const ledger = await ctx.prisma.ledger.findUnique({
        where: { id: input.id },
        select: { id: true, organizationId: true },
      });
      if (!ledger) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Libro no encontrado." });
      }
      await assertAdminMembership(ctx.prisma, ctx.user!.id, ledger.organizationId);

      if (input.functionalCurrencyId) {
        const currency = await ctx.prisma.currency.findUnique({
          where: { id: input.functionalCurrencyId },
          select: { active: true },
        });
        if (!currency || !currency.active) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La moneda funcional debe existir y estar activa.",
          });
        }
      }

      try {
        return await ctx.prisma.ledger.update({
          where: { id: input.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.functionalCurrencyId !== undefined
              ? { currencyId: input.functionalCurrencyId }
              : {}),
          },
          include: {
            currency: { select: { id: true, isoCode: true, name: true, symbol: true } },
          },
        });
      } catch (err) {
        rethrowPrisma(err);
      }
    }),

  /**
   * Reactiva un libro. En MVP no validamos transacciones (no existen aún).
   * Sprint 5 añadirá guard para evitar reactivar libros con cierre fiscal.
   */
  activate: protectedProcedure
    .input(ledgerActivateInput)
    .mutation(async ({ ctx, input }) => {
      const ledger = await ctx.prisma.ledger.findUnique({
        where: { id: input.id },
        select: { id: true, organizationId: true, active: true, kind: true },
      });
      if (!ledger) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Libro no encontrado." });
      }
      await assertAdminMembership(ctx.prisma, ctx.user!.id, ledger.organizationId);

      if (ledger.active) {
        return ledger; // idempotente
      }
      return ctx.prisma.ledger.update({
        where: { id: input.id },
        data: { active: true },
      });
    }),

  /**
   * Desactiva un libro. En MVP siempre permitido.
   * TODO(Sprint 5): bloquear si existen transacciones financieras posteriores
   * al cierre fiscal en este libro (`JournalEntry.ledgerId`).
   */
  deactivate: protectedProcedure
    .input(ledgerActivateInput)
    .mutation(async ({ ctx, input }) => {
      const ledger = await ctx.prisma.ledger.findUnique({
        where: { id: input.id },
        select: { id: true, organizationId: true, active: true },
      });
      if (!ledger) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Libro no encontrado." });
      }
      await assertAdminMembership(ctx.prisma, ctx.user!.id, ledger.organizationId);

      if (!ledger.active) {
        return ledger; // idempotente
      }
      return ctx.prisma.ledger.update({
        where: { id: input.id },
        data: { active: false },
      });
    }),

  /**
   * Lista los tipos de libro con etiquetas es-SV.
   * Si `organizationId` viene, marca cuáles ya existen como activos
   * (para que el form filtre opciones disponibles en `create`).
   */
  listKinds: protectedProcedure
    .input(
      z
        .object({ organizationId: z.string().uuid().optional() })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const orgId = input?.organizationId ?? ctx.tenant?.organizationId;

      let activeKinds = new Set<string>();
      let inactiveKinds = new Set<string>();

      if (orgId) {
        // Best-effort: si hay org, marcamos los kinds tomados.
        // No exigimos ADMIN: este endpoint sólo lista metadata.
        const existing = await ctx.prisma.ledger.findMany({
          where: { organizationId: orgId },
          select: { kind: true, active: true },
        });
        for (const e of existing) {
          if (e.active) activeKinds.add(e.kind);
          else inactiveKinds.add(e.kind);
        }
      }

      return (Object.keys(LEDGER_KIND_LABELS) as LedgerKindLocal[]).map((kind) => ({
        kind,
        label: LEDGER_KIND_LABELS[kind].label,
        description: LEDGER_KIND_LABELS[kind].description,
        alreadyActive: activeKinds.has(kind),
        existsInactive: inactiveKinds.has(kind),
      }));
    }),

  /**
   * Política de redondeo del libro. STUB MVP — devuelve defaults
   * `{decimals: 2, mode: 'HALF_EVEN'}`. Sprint 5 leerá de tabla
   * `LedgerRoundingPolicy` (per ledger + per currency).
   */
  roundingPolicy: protectedProcedure
    .input(ledgerRoundingPolicyInput)
    .query(async ({ ctx, input }) => {
      const ledger = await ctx.prisma.ledger.findUnique({
        where: { id: input.ledgerId },
        select: { id: true, organizationId: true, currencyId: true },
      });
      if (!ledger) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Libro no encontrado." });
      }
      await assertAdminMembership(ctx.prisma, ctx.user!.id, ledger.organizationId);

      // TODO(Sprint 5): SELECT * FROM LedgerRoundingPolicy WHERE ledgerId = ...
      return {
        ledgerId: ledger.id,
        currencyId: ledger.currencyId,
        decimals: 2,
        mode: "HALF_EVEN" as const,
        isStub: true,
        note: "Política por defecto (Sprint 5: tabla LedgerRoundingPolicy persistida).",
      };
    }),
});

/**
 * @his/contracts/schemas/ledger — schemas Zod para US-1.4 Multi-libro contable.
 *
 * Cubre el CRUD del modelo `Ledger` + activación/desactivación + listado de
 * tipos disponibles. El plan de cuentas queda como placeholder (Sprint 5
 * implementará jerarquía completa en `ChartOfAccounts`).
 *
 * Tipos de libro (LedgerKind, schema Prisma):
 *   - FISCAL_LOCAL : libro fiscal local (es-SV: Ministerio de Hacienda).
 *   - IFRS         : reporte bajo NIIF.
 *   - US_GAAP      : reporte bajo principios contables EE.UU.
 *   - MANAGEMENT   : libro gerencial (controlling).
 *   - BUDGET       : libro presupuestario.
 *   - STATISTICAL  : libro estadístico (KPIs no financieros).
 *
 * Política de redondeo: stub MVP — tabla `LedgerRoundingPolicy` llegará en
 * Sprint 5; aquí devolvemos { decimals: 2, mode: 'HALF_EVEN' } por defecto.
 *
 * Fuente única de verdad para los formularios web; replicado inline en el
 * router por restricción de barrel `@his/contracts/schemas/index.ts` frozen.
 */
import { z } from "zod";

/** Enum de tipos de libro alineado con `LedgerKind` en schema.prisma. */
export const ledgerKindEnum = z.enum([
  "FISCAL_LOCAL",
  "IFRS",
  "US_GAAP",
  "MANAGEMENT",
  "BUDGET",
  "STATISTICAL",
]);

export type LedgerKindUI = z.infer<typeof ledgerKindEnum>;

/** Modo de redondeo soportado por `LedgerRoundingPolicy` (Sprint 5). */
export const ledgerRoundingModeEnum = z.enum([
  "HALF_EVEN",
  "HALF_UP",
  "HALF_DOWN",
  "DOWN",
  "UP",
]);
export type LedgerRoundingMode = z.infer<typeof ledgerRoundingModeEnum>;

/** Etiqueta + descripción es-SV por tipo de libro. */
export const LEDGER_KIND_LABELS: Record<LedgerKindUI, { label: string; description: string }> = {
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

/**
 * Input para `ledger.list`.
 * `organizationId` opcional: si no viene, el router usa `ctx.tenant.organizationId`.
 */
export const ledgerListInput = z
  .object({
    organizationId: z.string().uuid().optional(),
    kind: ledgerKindEnum.optional(),
    activeOnly: z.boolean().optional(),
  })
  .optional();

export const ledgerGetInput = z.object({
  id: z.string().uuid(),
});

/** Input para crear un libro. `code` se deriva del kind (FISCAL_LOCAL → "FISCAL_LOCAL"). */
export const ledgerCreateInput = z.object({
  organizationId: z.string().uuid({ message: "Organización inválida." }),
  kind: ledgerKindEnum,
  name: z
    .string()
    .trim()
    .min(3, "Nombre mínimo 3 caracteres.")
    .max(120, "Nombre máximo 120 caracteres."),
  functionalCurrencyId: z
    .string()
    .uuid({ message: "Moneda funcional inválida." }),
});

export const ledgerUpdateInput = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(3, "Nombre mínimo 3 caracteres.")
    .max(120, "Nombre máximo 120 caracteres.")
    .optional(),
  functionalCurrencyId: z.string().uuid().optional(),
});

export const ledgerActivateInput = z.object({
  id: z.string().uuid(),
});

export const ledgerRoundingPolicyInput = z.object({
  ledgerId: z.string().uuid(),
});

export type LedgerListInput = z.infer<typeof ledgerListInput>;
export type LedgerCreateInput = z.infer<typeof ledgerCreateInput>;
export type LedgerUpdateInput = z.infer<typeof ledgerUpdateInput>;
export type LedgerActivateInput = z.infer<typeof ledgerActivateInput>;
export type LedgerRoundingPolicyInput = z.infer<typeof ledgerRoundingPolicyInput>;

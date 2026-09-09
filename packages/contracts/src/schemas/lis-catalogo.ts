/**
 * CC-0011 — Catálogo de exámenes parametrizable (§17 LIS).
 *
 * Extiende el catálogo LIS existente (lis.ts: labPanelListInput/labTestListInput)
 * con CRUD admin + `area` (LABORATORIO/RADIOLOGIA/CARDIOLOGIA) + `displayOrder`,
 * consumidos por el wizard de solicitud de exámenes de historia clínica
 * (mockup docs/CC/0007/historia-clinica-avante2.html, EXAM_CATALOGS).
 *
 * SQL: packages/database/sql/185_cc0011_lab_catalogo_parametrizable.sql
 *   (ALTER TABLE LabPanel.area/displayOrder, LabTest.displayOrder + seed global).
 */
import { z } from "zod";
import { specimenTypeEnum } from "./lis";

const LAB_CATALOG_AREA = ["LABORATORIO", "RADIOLOGIA", "CARDIOLOGIA"] as const;
export const labCatalogAreaEnum = z.enum(LAB_CATALOG_AREA);
export type LabCatalogArea = z.infer<typeof labCatalogAreaEnum>;

// ---------------------------------------------------------------------------
// Panel — CRUD admin
// ---------------------------------------------------------------------------

export const labPanelCreateInput = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  area: labCatalogAreaEnum,
  description: z.string().trim().max(2000).optional(),
  displayOrder: z.number().int().min(0).max(999).default(0),
});
export type LabPanelCreateInput = z.infer<typeof labPanelCreateInput>;

export const labPanelUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  area: labCatalogAreaEnum.optional(),
  description: z.string().trim().max(2000).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
});
export type LabPanelUpdateInput = z.infer<typeof labPanelUpdateInput>;

export const labPanelToggleInput = z.object({ id: z.string().uuid() });
export type LabPanelToggleInput = z.infer<typeof labPanelToggleInput>;

// ---------------------------------------------------------------------------
// Test — CRUD admin
// ---------------------------------------------------------------------------

/**
 * CC-0013 — precio estándar del catálogo. ≥0, máx 2 decimales (moneda).
 * Nullable: `null` limpia el precio explícitamente (vuelve al tarifario/sin precio).
 */
const standardPriceSchema = z
  .number()
  .nonnegative("El precio no puede ser negativo.")
  .refine((v) => Math.round(v * 100) === v * 100, "Máximo 2 decimales.");

export const labTestCreateInput = z.object({
  panelId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  specimen: specimenTypeEnum.default("OTHER"),
  unit: z.string().trim().max(40).optional(),
  displayOrder: z.number().int().min(0).max(999).default(0),
  /** CC-0013 — precio estándar (opcional; el admin lo parametriza post-creación). */
  standardPrice: standardPriceSchema.optional(),
  /** Rediseño lab 2026-09 — tipo/subtipo de muestra parametrizables (mockup). */
  sampleTypeId: z.string().uuid().optional(),
  sampleSubtypeId: z.string().uuid().optional(),
  /** Cantidad por defecto al solicitar (ej. HEMOCULTIVOS = 2). */
  defaultQty: z.number().int().min(1).optional(),
});
export type LabTestCreateInput = z.infer<typeof labTestCreateInput>;

export const labTestUpdateInput = z.object({
  id: z.string().uuid(),
  panelId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  specimen: specimenTypeEnum.optional(),
  unit: z.string().trim().max(40).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  /** CC-0013 — `null` limpia el precio explícitamente. */
  standardPrice: standardPriceSchema.nullable().optional(),
  /** Rediseño lab 2026-09 — tipo/subtipo de muestra parametrizables (mockup). */
  sampleTypeId: z.string().uuid().optional(),
  sampleSubtypeId: z.string().uuid().optional(),
  defaultQty: z.number().int().min(1).optional(),
});
export type LabTestUpdateInput = z.infer<typeof labTestUpdateInput>;

export const labTestToggleInput = z.object({ id: z.string().uuid() });
export type LabTestToggleInput = z.infer<typeof labTestToggleInput>;

// ---------------------------------------------------------------------------
// listByArea — consumido por el wizard de solicitud de exámenes de HC
// ---------------------------------------------------------------------------

export const labTestListByAreaInput = z.object({
  area: labCatalogAreaEnum,
});
export type LabTestListByAreaInput = z.infer<typeof labTestListByAreaInput>;

/** Item de examen dentro de un panel, shape de respuesta de `test.listByArea`. */
export interface LabCatalogTestItem {
  id: string;
  nombre: string;
  displayOrder: number;
}

/** Panel con sus exámenes activos, shape de respuesta de `test.listByArea`. */
export interface LabCatalogPanelGroup {
  panelId: string;
  nombre: string;
  tests: LabCatalogTestItem[];
}

// ---------------------------------------------------------------------------
// Rediseño lab 2026-09 (mockup_examenes_laboratorio) — catálogo de tipos y
// subtipos de muestra + parámetros por prueba + export/import del mockup.
// ---------------------------------------------------------------------------

export const labSampleTypeCreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  displayOrder: z.number().int().min(0).max(999).default(0),
});
export type LabSampleTypeCreateInput = z.infer<typeof labSampleTypeCreateInput>;

export const labSampleTypeUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});
export type LabSampleTypeUpdateInput = z.infer<typeof labSampleTypeUpdateInput>;

export const labSampleSubtypeCreateInput = z.object({
  sampleTypeId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  displayOrder: z.number().int().min(0).max(999).default(0),
});
export type LabSampleSubtypeCreateInput = z.infer<typeof labSampleSubtypeCreateInput>;

export const labSampleSubtypeUpdateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  sampleTypeId: z.string().uuid().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  active: z.boolean().optional(),
});
export type LabSampleSubtypeUpdateInput = z.infer<typeof labSampleSubtypeUpdateInput>;

export const labTestParameterAddInput = z.object({
  labTestId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
});
export type LabTestParameterAddInput = z.infer<typeof labTestParameterAddInput>;

export const labTestParameterRemoveInput = z.object({
  parameterId: z.string().uuid(),
});
export type LabTestParameterRemoveInput = z.infer<typeof labTestParameterRemoveInput>;

/**
 * Shape del JSON exportado/importado desde "Mantenimiento de catálogos" del
 * mockup (`design/mockup/mockup_examenes_laboratorio.html`, funciones
 * `exportarCatalogo`/`importarCatalogo`). `parametros` usa como clave
 * `"SECCION|||PRUEBA"` (helper `keyOf` del mockup).
 */
export const labCatalogoImportInput = z.object({
  secciones: z.array(z.string().trim().min(1).max(200)),
  tipos: z.array(z.string().trim().min(1).max(120)),
  subtipos: z.record(z.string(), z.array(z.string().trim().min(1).max(120))),
  pruebas: z.array(
    z.object({
      seccion: z.string().trim().min(1).max(200),
      prueba: z.string().trim().min(1).max(200),
      tipo: z.string().trim().min(1).max(120),
      subtipo: z.string().trim().min(1).max(120),
      cant: z.number().int().min(1).default(1),
    }),
  ),
  parametros: z.record(z.string(), z.array(z.string().trim().min(1).max(160))).optional(),
});
export type LabCatalogoImportInput = z.infer<typeof labCatalogoImportInput>;

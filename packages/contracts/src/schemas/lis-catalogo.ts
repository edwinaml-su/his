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

export const labTestCreateInput = z.object({
  panelId: z.string().uuid(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(200),
  specimen: specimenTypeEnum.default("OTHER"),
  unit: z.string().trim().max(40).optional(),
  displayOrder: z.number().int().min(0).max(999).default(0),
});
export type LabTestCreateInput = z.infer<typeof labTestCreateInput>;

export const labTestUpdateInput = z.object({
  id: z.string().uuid(),
  panelId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  specimen: specimenTypeEnum.optional(),
  unit: z.string().trim().max(40).optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
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

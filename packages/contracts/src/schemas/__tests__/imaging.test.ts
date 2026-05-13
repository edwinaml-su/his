/**
 * Tests del schema §18 RIS/PACS.
 * Valida forma del contrato Zod; reglas DICOM y workflow ORDERED→REPORTED
 * viven en `imaging.router.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  imagingModalityTypeEnum,
  imagingOrderStatusEnum,
  imagingPriorityEnum,
  imagingModalityCreateInput,
  imagingModalityListInput,
  imagingOrderCreateInput,
  imagingOrderListInput,
  imagingOrderUpdateStatusInput,
  imagingOrderCancelInput,
  imagingReportCreateInput,
  imagingReportSignInput,
} from "../imaging";

const u = "00000000-0000-0000-0000-000000000001";

describe("imagingModalityTypeEnum / imagingOrderStatusEnum / imagingPriorityEnum", () => {
  it.each(["CR", "CT", "MR", "US", "MG", "OTHER"])("modality %s válido", (m) =>
    expect(imagingModalityTypeEnum.safeParse(m).success).toBe(true),
  );
  it("ORDERED válido", () =>
    expect(imagingOrderStatusEnum.safeParse("ORDERED").success).toBe(true));
  it("ROUTINE válido", () =>
    expect(imagingPriorityEnum.safeParse("ROUTINE").success).toBe(true));
  it("priority desconocida inválida", () =>
    expect(imagingPriorityEnum.safeParse("HIGH").success).toBe(false));
});

describe("imagingModalityCreateInput / listInput", () => {
  it("acepta modalidad CT con aeTitle", () =>
    expect(
      imagingModalityCreateInput.safeParse({
        establishmentId: u,
        code: "CT-01",
        name: "Tomógrafo Principal",
        modalityType: "CT",
        aeTitle: "CT01_HOSP",
      }).success,
    ).toBe(true));

  it("rechaza name vacío", () =>
    expect(
      imagingModalityCreateInput.safeParse({
        establishmentId: u,
        code: "X",
        name: "",
        modalityType: "CR",
      }).success,
    ).toBe(false));

  it("list aplica defaults activeOnly=true, limit=50", () => {
    const r = imagingModalityListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.activeOnly).toBe(true);
      expect(r.data.limit).toBe(50);
    }
  });
});

describe("imagingOrderCreateInput", () => {
  it("acepta orden mínima con default priority=ROUTINE", () => {
    const r = imagingOrderCreateInput.safeParse({
      encounterId: u,
      establishmentId: u,
      patientId: u,
      modalityType: "CR",
      studyDescription: "Rx tórax PA",
      clinicalIndication: "Tos persistente",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.priority).toBe("ROUTINE");
  });

  it("rechaza clinicalIndication vacía", () =>
    expect(
      imagingOrderCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        modalityType: "CR",
        studyDescription: "x",
        clinicalIndication: "",
      }).success,
    ).toBe(false));

  it("acepta priority STAT", () =>
    expect(
      imagingOrderCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        modalityType: "CT",
        studyDescription: "TC cráneo s/c",
        clinicalIndication: "TCE severo",
        priority: "STAT",
      }).success,
    ).toBe(true));
});

describe("imagingOrderListInput", () => {
  it("default limit=50", () => {
    const r = imagingOrderListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("rechaza limit > 200", () =>
    expect(imagingOrderListInput.safeParse({ limit: 500 }).success).toBe(false));
});

describe("imagingOrderUpdateStatusInput / cancelInput", () => {
  it("acepta update status SCHEDULED con accession", () =>
    expect(
      imagingOrderUpdateStatusInput.safeParse({
        id: u,
        status: "ACQUIRED",
        accessionNumber: "ACC-2026-001",
      }).success,
    ).toBe(true));

  it("rechaza id no-UUID", () =>
    expect(
      imagingOrderUpdateStatusInput.safeParse({ id: "x", status: "ORDERED" }).success,
    ).toBe(false));

  it("cancel requiere reason no vacío", () =>
    expect(imagingOrderCancelInput.safeParse({ id: u, reason: "" }).success).toBe(
      false,
    ));
});

describe("imagingReportCreateInput / signInput", () => {
  it("acepta reporte mínimo", () =>
    expect(
      imagingReportCreateInput.safeParse({
        orderId: u,
        findings: "Sin alteraciones",
        impression: "Estudio normal",
      }).success,
    ).toBe(true));

  it("rechaza findings vacío", () =>
    expect(
      imagingReportCreateInput.safeParse({
        orderId: u,
        findings: "",
        impression: "x",
      }).success,
    ).toBe(false));

  it("sign requiere orderId UUID", () =>
    expect(imagingReportSignInput.safeParse({ orderId: u }).success).toBe(true));
});

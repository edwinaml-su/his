/**
 * Tests del schema §18 RIS/PACS.
 * Beta.9 hardening layer 1: state machine, DICOM enum, SLA constants, validate input.
 */
import { describe, it, expect } from "vitest";
import {
  imagingModalityTypeEnum,
  dicomModalityEnum,
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
  imagingReportValidateInput,
  VALID_STATUS_TRANSITIONS,
  SLA_MINUTES,
  RADIATION_DOSE_MODALITIES,
} from "../imaging";

const u = "00000000-0000-0000-0000-000000000001";

describe("imagingModalityTypeEnum / dicomModalityEnum / imagingOrderStatusEnum / imagingPriorityEnum", () => {
  it.each(["CR", "CT", "MR", "US", "MG", "OTHER"])("modality %s válido", (m) =>
    expect(imagingModalityTypeEnum.safeParse(m).success).toBe(true),
  );

  it.each(["CT", "MR", "US", "XR", "MG", "NM", "PT", "DX", "RF"])(
    "dicomCode %s válido",
    (code) => expect(dicomModalityEnum.safeParse(code).success).toBe(true),
  );

  it("dicomCode inválido rechazado", () =>
    expect(dicomModalityEnum.safeParse("CR").success).toBe(false));

  it.each(["ORDERED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "REPORTED", "VALIDATED", "CANCELLED"])(
    "status %s válido",
    (s) => expect(imagingOrderStatusEnum.safeParse(s).success).toBe(true),
  );

  it("ACQUIRED ya no está en el enum", () =>
    expect(imagingOrderStatusEnum.safeParse("ACQUIRED").success).toBe(false));

  it.each(["STAT", "URGENT", "ROUTINE"])("priority %s válido", (p) =>
    expect(imagingPriorityEnum.safeParse(p).success).toBe(true),
  );

  it("priority desconocida inválida", () =>
    expect(imagingPriorityEnum.safeParse("HIGH").success).toBe(false));
});

describe("SLA_MINUTES — urgency derivation", () => {
  it("STAT = 60 min", () => expect(SLA_MINUTES.STAT).toBe(60));
  it("URGENT = 240 min", () => expect(SLA_MINUTES.URGENT).toBe(240));
  it("ROUTINE = 1440 min", () => expect(SLA_MINUTES.ROUTINE).toBe(1440));
});

describe("VALID_STATUS_TRANSITIONS — state machine", () => {
  it("ORDERED → SCHEDULED and CANCELLED only", () => {
    expect(VALID_STATUS_TRANSITIONS.ORDERED).toEqual(
      expect.arrayContaining(["SCHEDULED", "CANCELLED"]),
    );
    expect(VALID_STATUS_TRANSITIONS.ORDERED).toHaveLength(2);
  });

  it("SCHEDULED → IN_PROGRESS and CANCELLED only", () => {
    expect(VALID_STATUS_TRANSITIONS.SCHEDULED).toEqual(
      expect.arrayContaining(["IN_PROGRESS", "CANCELLED"]),
    );
    expect(VALID_STATUS_TRANSITIONS.SCHEDULED).toHaveLength(2);
  });

  it("IN_PROGRESS → COMPLETED and CANCELLED only", () => {
    expect(VALID_STATUS_TRANSITIONS.IN_PROGRESS).toEqual(
      expect.arrayContaining(["COMPLETED", "CANCELLED"]),
    );
    expect(VALID_STATUS_TRANSITIONS.IN_PROGRESS).toHaveLength(2);
  });

  it("COMPLETED → REPORTED only", () => {
    expect(VALID_STATUS_TRANSITIONS.COMPLETED).toEqual(["REPORTED"]);
  });

  it("REPORTED → VALIDATED only", () => {
    expect(VALID_STATUS_TRANSITIONS.REPORTED).toEqual(["VALIDATED"]);
  });

  it("VALIDATED and CANCELLED are terminal (no transitions)", () => {
    expect(VALID_STATUS_TRANSITIONS.VALIDATED).toHaveLength(0);
    expect(VALID_STATUS_TRANSITIONS.CANCELLED).toHaveLength(0);
  });
});

describe("RADIATION_DOSE_MODALITIES", () => {
  it("includes CT, XA, MG", () => {
    expect(RADIATION_DOSE_MODALITIES).toEqual(
      expect.arrayContaining(["CT", "XA", "MG"]),
    );
  });
});

describe("imagingModalityCreateInput — with dicomCode", () => {
  it("acepta modalidad CT con dicomCode CT y aeTitle", () =>
    expect(
      imagingModalityCreateInput.safeParse({
        establishmentId: u,
        code: "CT-01",
        name: "Tomógrafo Principal",
        modalityType: "CT",
        dicomCode: "CT",
        aeTitle: "CT01_HOSP",
      }).success,
    ).toBe(true));

  it("acepta modalidad sin dicomCode (opcional)", () =>
    expect(
      imagingModalityCreateInput.safeParse({
        establishmentId: u,
        code: "MR-01",
        name: "MRI 1.5T",
        modalityType: "MR",
      }).success,
    ).toBe(true));

  it("rechaza dicomCode inválido", () =>
    expect(
      imagingModalityCreateInput.safeParse({
        establishmentId: u,
        code: "CR-01",
        name: "CR Suite",
        modalityType: "CR",
        dicomCode: "CR", // CR not in DicomModality enum
      }).success,
    ).toBe(false));

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

describe("imagingOrderUpdateStatusInput", () => {
  it("acepta update status COMPLETED con accession", () =>
    expect(
      imagingOrderUpdateStatusInput.safeParse({
        id: u,
        status: "COMPLETED",
        accessionNumber: "ACC-2026-001",
      }).success,
    ).toBe(true));

  it("acepta radiation dose fields", () =>
    expect(
      imagingOrderUpdateStatusInput.safeParse({
        id: u,
        status: "COMPLETED",
        radiationDoseDap: 250.5,
        radiationDoseCtdi: 12.3,
      }).success,
    ).toBe(true));

  it("rechaza radiation dose negativa", () =>
    expect(
      imagingOrderUpdateStatusInput.safeParse({
        id: u,
        status: "COMPLETED",
        radiationDoseDap: -10,
      }).success,
    ).toBe(false));

  it("rechaza CANCELLED via updateStatus (usar cancel)", () =>
    expect(
      imagingOrderUpdateStatusInput.safeParse({ id: u, status: "CANCELLED" }).success,
    ).toBe(false));

  it("rechaza id no-UUID", () =>
    expect(
      imagingOrderUpdateStatusInput.safeParse({ id: "x", status: "COMPLETED" }).success,
    ).toBe(false));
});

describe("imagingOrderCancelInput", () => {
  it("cancel requiere reason no vacío", () =>
    expect(imagingOrderCancelInput.safeParse({ id: u, reason: "" }).success).toBe(
      false,
    ));

  it("cancel acepta reason válido", () =>
    expect(imagingOrderCancelInput.safeParse({ id: u, reason: "Paciente desistió" }).success).toBe(
      true,
    ));
});

describe("imagingReportCreateInput / signInput / validateInput", () => {
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

  it("validate requiere orderId UUID", () =>
    expect(imagingReportValidateInput.safeParse({ orderId: u }).success).toBe(true));

  it("validate rechaza id inválido", () =>
    expect(imagingReportValidateInput.safeParse({ orderId: "bad" }).success).toBe(false));
});

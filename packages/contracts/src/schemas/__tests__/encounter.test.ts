/**
 * Tests del schema Zod de Encounter (admit / transfer / discharge / list).
 */
import { describe, it, expect } from "vitest";
import {
  admitSchema,
  transferSchema,
  dischargeSchema,
  encounterListSchema,
} from "../encounter";

const u = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

describe("admitSchema", () => {
  const valid = {
    patientId: u(1),
    admissionType: "EMERGENCY",
    currencyId: u(2),
  };

  it("acepta input mínimo", () => {
    expect(admitSchema.safeParse(valid).success).toBe(true);
  });

  it.each(["EMERGENCY", "SCHEDULED", "TRANSFER_IN", "BIRTH", "NEWBORN"])(
    "acepta admissionType=%s",
    (t) => {
      expect(admitSchema.safeParse({ ...valid, admissionType: t }).success).toBe(true);
    },
  );

  it("rechaza admissionType desconocido", () => {
    expect(admitSchema.safeParse({ ...valid, admissionType: "URGENT" }).success).toBe(false);
  });

  it("rechaza patientId no-UUID", () => {
    expect(admitSchema.safeParse({ ...valid, patientId: "x" }).success).toBe(false);
  });

  it("requiere currencyId (admisión sin moneda no tiene sentido contable)", () => {
    const { currencyId, ...rest } = valid;
    void currencyId;
    expect(admitSchema.safeParse(rest).success).toBe(false);
  });
});

describe("transferSchema", () => {
  const valid = {
    encounterId: u(3),
    toServiceId: u(4),
    reason: "Cambio a UCI por deterioro clínico",
  };

  it("acepta traslado mínimo (origen opcional)", () => {
    expect(transferSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza reason demasiado corto (<2)", () => {
    expect(transferSchema.safeParse({ ...valid, reason: "x" }).success).toBe(false);
  });

  it("rechaza reason > 200 chars", () => {
    expect(
      transferSchema.safeParse({ ...valid, reason: "a".repeat(201) }).success,
    ).toBe(false);
  });

  it("permite especificar fromBedId/toBedId opcionales", () => {
    const r = transferSchema.safeParse({ ...valid, fromBedId: u(5), toBedId: u(6) });
    expect(r.success).toBe(true);
  });
});

describe("dischargeSchema", () => {
  const valid = { encounterId: u(7), dischargeType: "MEDICAL" };

  it.each(["MEDICAL", "VOLUNTARY", "TRANSFER_OUT", "ABSCONDED", "DEATH", "AGAINST_MEDICAL_ADVICE"])(
    "acepta dischargeType=%s",
    (t) => {
      expect(dischargeSchema.safeParse({ ...valid, dischargeType: t }).success).toBe(true);
    },
  );

  it("rechaza dischargeType desconocido", () => {
    expect(dischargeSchema.safeParse({ ...valid, dischargeType: "FUGA" }).success).toBe(false);
  });
});

describe("encounterListSchema — defaults y paginación", () => {
  it("defaults status=OPEN, page=1, pageSize=20", () => {
    const r = encounterListSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe("OPEN");
      expect(r.data.page).toBe(1);
      expect(r.data.pageSize).toBe(20);
    }
  });

  it("rechaza pageSize > 100", () => {
    expect(encounterListSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});

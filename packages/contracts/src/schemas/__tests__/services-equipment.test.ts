/**
 * Tests del schema §20 Services & Equipment (Wave 8 / Beta.11 hardening layer 1).
 */
import { describe, it, expect } from "vitest";
import {
  equipmentStatusEnum,
  criticalityLevelEnum,
  pmScheduleStatusEnum,
  calibrationResultEnum,
  equipmentCreateInput,
  equipmentListInput,
  equipmentSetStatusInput,
  getOverduePmInput,
  getExpiringCertificationsInput,
  pmScheduleCreateInput,
  pmScheduleListInput,
  pmScheduleCompleteInput,
  pmScheduleCancelInput,
  calibrationLogCreateInput,
  calibrationLogListInput,
  isValidTransition,
  EQUIPMENT_STATUS_TRANSITIONS,
  registrarGiaiInput,
  generarGiaiInput,
  actualizarUbicacionInput,
  historialUbicacionesInput,
} from "../services-equipment";

const u = "00000000-0000-0000-0000-000000000001";
const past = new Date("2026-01-01");
const future = new Date("2027-01-01");

describe("enums", () => {
  it.each(["OPERATIONAL", "UNDER_MAINTENANCE", "OUT_OF_SERVICE", "RETIRED", "BROKEN"])(
    "equipment status %s válido",
    (s) => expect(equipmentStatusEnum.safeParse(s).success).toBe(true),
  );

  it("equipment status UNKNOWN inválido", () =>
    expect(equipmentStatusEnum.safeParse("UNKNOWN").success).toBe(false));

  it.each(["LOW", "MEDIUM", "HIGH", "CRITICAL"])(
    "criticality %s válido",
    (c) => expect(criticalityLevelEnum.safeParse(c).success).toBe(true),
  );

  it("criticality EXTREME inválido", () =>
    expect(criticalityLevelEnum.safeParse("EXTREME").success).toBe(false));

  it.each(["PLANNED", "COMPLETED", "OVERDUE", "CANCELLED"])(
    "PM status %s válido",
    (s) => expect(pmScheduleStatusEnum.safeParse(s).success).toBe(true),
  );

  it.each(["PASS", "FAIL", "CONDITIONAL"])("calibration result %s válido", (r) =>
    expect(calibrationResultEnum.safeParse(r).success).toBe(true),
  );

  it("calibration result XYZ inválido", () =>
    expect(calibrationResultEnum.safeParse("XYZ").success).toBe(false));
});

describe("isValidTransition / EQUIPMENT_STATUS_TRANSITIONS", () => {
  it("OPERATIONAL → UNDER_MAINTENANCE permitido", () =>
    expect(isValidTransition("OPERATIONAL", "UNDER_MAINTENANCE")).toBe(true));

  it("OPERATIONAL → BROKEN permitido", () =>
    expect(isValidTransition("OPERATIONAL", "BROKEN")).toBe(true));

  it("OPERATIONAL → RETIRED no permitido", () =>
    expect(isValidTransition("OPERATIONAL", "RETIRED")).toBe(false));

  it("UNDER_MAINTENANCE → OPERATIONAL permitido", () =>
    expect(isValidTransition("UNDER_MAINTENANCE", "OPERATIONAL")).toBe(true));

  it("UNDER_MAINTENANCE → BROKEN no permitido", () =>
    expect(isValidTransition("UNDER_MAINTENANCE", "BROKEN")).toBe(false));

  it("BROKEN → UNDER_MAINTENANCE permitido", () =>
    expect(isValidTransition("BROKEN", "UNDER_MAINTENANCE")).toBe(true));

  it("OUT_OF_SERVICE → RETIRED permitido", () =>
    expect(isValidTransition("OUT_OF_SERVICE", "RETIRED")).toBe(true));

  it("OUT_OF_SERVICE → OPERATIONAL no permitido", () =>
    expect(isValidTransition("OUT_OF_SERVICE", "OPERATIONAL")).toBe(false));

  it("RETIRED tiene lista vacía de transiciones", () =>
    expect(EQUIPMENT_STATUS_TRANSITIONS["RETIRED"]).toHaveLength(0));

  it("RETIRED → OPERATIONAL no permitido", () =>
    expect(isValidTransition("RETIRED", "OPERATIONAL")).toBe(false));
});

describe("equipmentCreateInput", () => {
  it("acepta input mínimo", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: u,
        assetTag: "AT-001",
        name: "Monitor de signos vitales",
      }).success,
    ).toBe(true));

  it("criticality default MEDIUM", () => {
    const r = equipmentCreateInput.safeParse({
      establishmentId: u,
      assetTag: "AT-001",
      name: "Monitor",
    });
    if (r.success) expect(r.data.criticality).toBe("MEDIUM");
  });

  it("acepta criticality HIGH + certificationExpiresAt", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: u,
        assetTag: "AT-002",
        name: "Ventilador",
        criticality: "HIGH",
        certificationExpiresAt: future,
      }).success,
    ).toBe(true));

  it("rechaza assetTag vacío", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: u,
        assetTag: "",
        name: "X",
      }).success,
    ).toBe(false));

  it("rechaza UUID inválido", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: "no-uuid",
        assetTag: "AT",
        name: "X",
      }).success,
    ).toBe(false));

  it("acepta todos los campos", () =>
    expect(
      equipmentCreateInput.safeParse({
        establishmentId: u,
        assetTag: "AT-003",
        name: "Ventilador",
        manufacturer: "Hamilton",
        model: "G5",
        serialNumber: "SN-12345",
        category: "VENTILADOR",
        location: "UCI sala 3",
        installDate: past,
        criticality: "CRITICAL",
        certificationExpiresAt: future,
      }).success,
    ).toBe(true));
});

describe("equipmentListInput / setStatusInput", () => {
  it("activeOnly default true, limit default 50", () => {
    const r = equipmentListInput.safeParse({});
    if (r.success) {
      expect(r.data.activeOnly).toBe(true);
      expect(r.data.limit).toBe(50);
    }
  });

  it("acepta filtro por criticality", () =>
    expect(
      equipmentListInput.safeParse({ criticality: "CRITICAL" }).success,
    ).toBe(true));

  it("setStatus acepta uuid + status válido", () =>
    expect(
      equipmentSetStatusInput.safeParse({ id: u, status: "UNDER_MAINTENANCE" }).success,
    ).toBe(true));

  it("setStatus acepta BROKEN", () =>
    expect(
      equipmentSetStatusInput.safeParse({ id: u, status: "BROKEN" }).success,
    ).toBe(true));

  it("setStatus rechaza status inválido", () =>
    expect(equipmentSetStatusInput.safeParse({ id: u, status: "X" }).success).toBe(false));

  it("setStatus acepta maintenanceReason", () =>
    expect(
      equipmentSetStatusInput.safeParse({
        id: u,
        status: "UNDER_MAINTENANCE",
        maintenanceReason: "Falla en sensor de presión",
      }).success,
    ).toBe(true));
});

describe("getOverduePmInput", () => {
  it("defaults limit=50", () => {
    const r = getOverduePmInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("acepta establishmentId", () =>
    expect(getOverduePmInput.safeParse({ establishmentId: u }).success).toBe(true));

  it("rechaza limit > 200", () =>
    expect(getOverduePmInput.safeParse({ limit: 201 }).success).toBe(false));
});

describe("getExpiringCertificationsInput", () => {
  it("defaults daysAhead=60, limit=50", () => {
    const r = getExpiringCertificationsInput.safeParse({});
    if (r.success) {
      expect(r.data.daysAhead).toBe(60);
      expect(r.data.limit).toBe(50);
    }
  });

  it("acepta daysAhead personalizado", () =>
    expect(getExpiringCertificationsInput.safeParse({ daysAhead: 30 }).success).toBe(true));

  it("rechaza daysAhead=0", () =>
    expect(getExpiringCertificationsInput.safeParse({ daysAhead: 0 }).success).toBe(false));

  it("rechaza daysAhead > 365", () =>
    expect(getExpiringCertificationsInput.safeParse({ daysAhead: 366 }).success).toBe(false));
});

describe("pmScheduleCreateInput / complete / cancel", () => {
  it("acepta input válido", () =>
    expect(
      pmScheduleCreateInput.safeParse({
        equipmentId: u,
        scheduledAt: future,
        taskNotes: "PM trimestral",
      }).success,
    ).toBe(true));

  it("complete acepta sólo id", () =>
    expect(pmScheduleCompleteInput.safeParse({ id: u }).success).toBe(true));

  it("cancel rechaza id no-UUID", () =>
    expect(pmScheduleCancelInput.safeParse({ id: "abc" }).success).toBe(false));

  it("list filtra por status", () =>
    expect(pmScheduleListInput.safeParse({ status: "PLANNED" }).success).toBe(true));
});

describe("GS1 — registrarGiaiInput", () => {
  it("acepta GIAI con prefijo 7 dígitos + referencia alfanumérica", () => {
    const r = registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: "7410398AT001" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.giaiCode).toBe("7410398AT001");
  });

  it("normaliza entrada escaneada cruda con AI explícito (8004<giai>) SOLO cuando es inequívoca", () => {
    // Inequívoca: la cadena completa NO es un GIAI válido (>30 chars) pero el
    // resto tras el AI sí — se despoja el 8004.
    const giaiLargo = "7410398" + "B".repeat(21); // 28 chars, GIAI válido
    const r = registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: "8004" + giaiLargo });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.giaiCode).toBe(giaiLargo);
  });

  it("NO despoja el 8004 cuando la cadena completa ya es un GIAI válido (prefijo de empresa que empieza con 8004)", () => {
    // Ambigua: "80047410398AT001" es un GIAI válido por sí mismo (prefijo
    // numérico de 11 dígitos + referencia) — recortarlo a ciegas corrompería
    // un código legítimo (hallazgo pre-pr-review CC-0029).
    const r = registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: "80047410398AT001" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.giaiCode).toBe("80047410398AT001");
  });

  it("acepta longitud total exactamente 30 caracteres", () => {
    const giai = "7410398" + "A".repeat(23);
    expect(
      registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: giai }).success,
    ).toBe(true);
  });

  it("rechaza GIAI con más de 30 caracteres", () => {
    const giai = "7410398" + "A".repeat(24);
    expect(
      registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: giai }).success,
    ).toBe(false);
  });

  it("rechaza GIAI con prefijo de menos de 7 dígitos", () =>
    expect(
      registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: "741039AT001" }).success,
    ).toBe(false));

  it("rechaza GIAI sin referencia de activo (solo prefijo)", () =>
    expect(
      registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: "7410398" }).success,
    ).toBe(false));

  it("rechaza GIAI con caracteres fuera de alfanumérico", () =>
    expect(
      registrarGiaiInput.safeParse({ equipmentId: u, giaiCode: "7410398AT-001" }).success,
    ).toBe(false));

  it("requiere equipmentId UUID", () =>
    expect(
      registrarGiaiInput.safeParse({ equipmentId: "no-uuid", giaiCode: "7410398AT001" }).success,
    ).toBe(false));
});

describe("GS1 — generarGiaiInput", () => {
  it("acepta equipmentId UUID", () =>
    expect(generarGiaiInput.safeParse({ equipmentId: u }).success).toBe(true));

  it("rechaza equipmentId no-UUID", () =>
    expect(generarGiaiInput.safeParse({ equipmentId: "no-uuid" }).success).toBe(false));

  it("rechaza input vacío", () =>
    expect(generarGiaiInput.safeParse({}).success).toBe(false));
});

describe("GS1 — actualizarUbicacionInput", () => {
  it("acepta GLN de 13 dígitos", () =>
    expect(
      actualizarUbicacionInput.safeParse({
        equipmentId: u,
        glnUbicacion: "7890000000001",
      }).success,
    ).toBe(true));

  it("acepta GLN con bizStep opcional", () =>
    expect(
      actualizarUbicacionInput.safeParse({
        equipmentId: u,
        glnUbicacion: "7890000000001",
        bizStep: "transporting",
      }).success,
    ).toBe(true));

  it("rechaza GLN con 12 dígitos", () =>
    expect(
      actualizarUbicacionInput.safeParse({
        equipmentId: u,
        glnUbicacion: "789000000001",
      }).success,
    ).toBe(false));

  it("rechaza GLN con letras", () =>
    expect(
      actualizarUbicacionInput.safeParse({
        equipmentId: u,
        glnUbicacion: "789ABC0000001",
      }).success,
    ).toBe(false));
});

describe("GS1 — historialUbicacionesInput", () => {
  it("defaults limit=50", () => {
    const r = historialUbicacionesInput.safeParse({ equipmentId: u });
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("rechaza limit=0", () =>
    expect(
      historialUbicacionesInput.safeParse({ equipmentId: u, limit: 0 }).success,
    ).toBe(false));

  it("rechaza limit > 200", () =>
    expect(
      historialUbicacionesInput.safeParse({ equipmentId: u, limit: 201 }).success,
    ).toBe(false));
});

describe("calibrationLogCreateInput", () => {
  it("acepta input válido", () =>
    expect(
      calibrationLogCreateInput.safeParse({
        equipmentId: u,
        calibratedAt: past,
        result: "PASS",
        nextDueAt: future,
      }).success,
    ).toBe(true));

  it("rechaza nextDueAt anterior a calibratedAt", () =>
    expect(
      calibrationLogCreateInput.safeParse({
        equipmentId: u,
        calibratedAt: future,
        result: "PASS",
        nextDueAt: past,
      }).success,
    ).toBe(false));

  it("acepta sin nextDueAt", () =>
    expect(
      calibrationLogCreateInput.safeParse({
        equipmentId: u,
        calibratedAt: past,
        result: "FAIL",
      }).success,
    ).toBe(true));

  it("list default limit=50", () => {
    const r = calibrationLogListInput.safeParse({});
    if (r.success) expect(r.data.limit).toBe(50);
  });
});

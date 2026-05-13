/**
 * Tests del schema §12 Emergency.
 * Valida forma del contrato Zod y los helpers puros añadidos en Beta.4
 * hardening (state machine, LWBS detection, observation timer, re-triage).
 */
import { describe, it, expect } from "vitest";
import {
  emergencyDispositionEnum,
  emergencyArrivalModeEnum,
  emergencyNoteCategoryEnum,
  emergencyVisitCreateInput,
  emergencyVisitListInput,
  emergencyVisitDispositionInput,
  emergencyVisitStartObservationInput,
  emergencyVisitEndObservationInput,
  emergencyNoteCreateInput,
  emergencyVitalRecordInput,
  lwbsCheckInput,
  canTransitionEmergencyDisposition,
  isTerminalEmergencyDisposition,
  detectLwbsCandidate,
  computeObservationDuration,
  shouldTriggerRetriage,
  LWBS_DEFAULT_TIMEOUT_MIN,
} from "../emergency";

const u = "00000000-0000-0000-0000-000000000001";

describe("emergencyDispositionEnum", () => {
  it.each([
    "PENDING",
    "DISCHARGED",
    "ADMITTED",
    "TRANSFERRED",
    "LWBS",
    "AMA",
    "DECEASED",
  ])("acepta disposition %s", (s) =>
    expect(emergencyDispositionEnum.safeParse(s).success).toBe(true),
  );
  it("rechaza desconocida", () =>
    expect(emergencyDispositionEnum.safeParse("OBSERVATION").success).toBe(false));
});

describe("emergencyArrivalModeEnum / emergencyNoteCategoryEnum", () => {
  it("arrivalMode AMBULANCE válido", () =>
    expect(emergencyArrivalModeEnum.safeParse("AMBULANCE").success).toBe(true));
  it("note category OBSERVATION válido", () =>
    expect(emergencyNoteCategoryEnum.safeParse("OBSERVATION").success).toBe(true));
});

describe("emergencyVisitCreateInput", () => {
  it("aplica default arrivalMode=WALK_IN", () => {
    const r = emergencyVisitCreateInput.safeParse({
      encounterId: u,
      establishmentId: u,
      patientId: u,
      chiefComplaint: "Dolor torácico",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.arrivalMode).toBe("WALK_IN");
  });

  it("acepta arrivalMode AMBULANCE y treatingId", () => {
    const r = emergencyVisitCreateInput.safeParse({
      encounterId: u,
      establishmentId: u,
      patientId: u,
      chiefComplaint: "Trauma craneal",
      arrivalMode: "AMBULANCE",
      treatingId: u,
    });
    expect(r.success).toBe(true);
  });

  it("rechaza chiefComplaint vacío", () =>
    expect(
      emergencyVisitCreateInput.safeParse({
        encounterId: u,
        establishmentId: u,
        patientId: u,
        chiefComplaint: "",
      }).success,
    ).toBe(false));
});

describe("emergencyVisitListInput", () => {
  it("aplica default limit=50", () => {
    const r = emergencyVisitListInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("rechaza limit > 200", () =>
    expect(emergencyVisitListInput.safeParse({ limit: 999 }).success).toBe(false));
});

describe("emergencyVisitDispositionInput", () => {
  it("acepta disposition LWBS sin notes", () =>
    expect(
      emergencyVisitDispositionInput.safeParse({ id: u, disposition: "LWBS" }).success,
    ).toBe(true));

  it("rechaza disposition vacía", () =>
    expect(
      emergencyVisitDispositionInput.safeParse({ id: u, disposition: "" }).success,
    ).toBe(false));
});

describe("emergencyVisit start/end observation", () => {
  it("start observation requiere id UUID", () =>
    expect(emergencyVisitStartObservationInput.safeParse({ id: u }).success).toBe(true));
  it("end observation rechaza id no-UUID", () =>
    expect(emergencyVisitEndObservationInput.safeParse({ id: "x" }).success).toBe(false));
});

describe("emergencyNoteCreateInput", () => {
  it("acepta nota válida", () =>
    expect(
      emergencyNoteCreateInput.safeParse({
        visitId: u,
        category: "REASSESSMENT",
        body: "Mejoría tras analgesia",
      }).success,
    ).toBe(true));

  it("rechaza body vacío", () =>
    expect(
      emergencyNoteCreateInput.safeParse({
        visitId: u,
        category: "OBSERVATION",
        body: "",
      }).success,
    ).toBe(false));
});

// ---------------------------------------------------------------------------
// Beta.4 — state machine
// ---------------------------------------------------------------------------

describe("canTransitionEmergencyDisposition", () => {
  it.each([
    ["PENDING", "DISCHARGED"],
    ["PENDING", "ADMITTED"],
    ["PENDING", "TRANSFERRED"],
    ["PENDING", "LWBS"],
    ["PENDING", "AMA"],
    ["PENDING", "DECEASED"],
  ] as const)("permite %s -> %s", (from, to) =>
    expect(canTransitionEmergencyDisposition(from, to)).toBe(true),
  );

  it.each([
    ["DISCHARGED", "ADMITTED"],
    ["ADMITTED", "DISCHARGED"],
    ["LWBS", "ADMITTED"],
    ["AMA", "PENDING"],
    ["DECEASED", "DISCHARGED"],
    ["TRANSFERRED", "AMA"],
  ] as const)("rechaza %s -> %s (terminal)", (from, to) =>
    expect(canTransitionEmergencyDisposition(from, to)).toBe(false),
  );

  it("rechaza PENDING -> PENDING (no-op debe manejarse upstream)", () =>
    expect(canTransitionEmergencyDisposition("PENDING", "PENDING")).toBe(false));
});

describe("isTerminalEmergencyDisposition", () => {
  it("PENDING NO es terminal", () =>
    expect(isTerminalEmergencyDisposition("PENDING")).toBe(false));
  it.each(["DISCHARGED", "ADMITTED", "TRANSFERRED", "LWBS", "AMA", "DECEASED"] as const)(
    "%s es terminal",
    (d) => expect(isTerminalEmergencyDisposition(d)).toBe(true),
  );
});

// ---------------------------------------------------------------------------
// Beta.4 — LWBS detection
// ---------------------------------------------------------------------------

describe("detectLwbsCandidate", () => {
  const baseNow = new Date("2026-05-13T12:00:00Z");

  it("LWBS_DEFAULT_TIMEOUT_MIN = 240 (4h)", () => {
    expect(LWBS_DEFAULT_TIMEOUT_MIN).toBe(240);
  });

  it("flag candidate: PENDING + sin treating + elapsed >= timeout", () => {
    const arrived = new Date(baseNow.getTime() - 250 * 60 * 1000); // 250 min
    const r = detectLwbsCandidate({
      visit: { disposition: "PENDING", arrivedAt: arrived, treatingId: null },
      now: baseNow,
    });
    expect(r.isCandidate).toBe(true);
    expect(r.reason).toBe("OK");
    expect(r.elapsedMinutes).toBe(250);
    expect(r.timeoutMinutes).toBe(240);
  });

  it("no flag si dentro del timeout", () => {
    const arrived = new Date(baseNow.getTime() - 30 * 60 * 1000);
    const r = detectLwbsCandidate({
      visit: { disposition: "PENDING", arrivedAt: arrived, treatingId: null },
      now: baseNow,
    });
    expect(r.isCandidate).toBe(false);
    expect(r.reason).toBe("WITHIN_TIMEOUT");
  });

  it("no flag si tiene treatingId", () => {
    const arrived = new Date(baseNow.getTime() - 500 * 60 * 1000);
    const r = detectLwbsCandidate({
      visit: { disposition: "PENDING", arrivedAt: arrived, treatingId: u },
      now: baseNow,
    });
    expect(r.isCandidate).toBe(false);
    expect(r.reason).toBe("HAS_TREATING");
  });

  it("no flag si disposition != PENDING", () => {
    const arrived = new Date(baseNow.getTime() - 500 * 60 * 1000);
    const r = detectLwbsCandidate({
      visit: {
        disposition: "DISCHARGED",
        arrivedAt: arrived,
        treatingId: null,
      },
      now: baseNow,
    });
    expect(r.isCandidate).toBe(false);
    expect(r.reason).toBe("ALREADY_DISPOSITIONED");
  });

  it("acepta timeout override", () => {
    const arrived = new Date(baseNow.getTime() - 35 * 60 * 1000);
    const r = detectLwbsCandidate({
      visit: { disposition: "PENDING", arrivedAt: arrived, treatingId: null },
      now: baseNow,
      timeoutMinutes: 30,
    });
    expect(r.isCandidate).toBe(true);
    expect(r.timeoutMinutes).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Beta.4 — observation timer
// ---------------------------------------------------------------------------

describe("computeObservationDuration", () => {
  const now = new Date("2026-05-13T12:00:00Z");

  it("retorna 0 / closed si nunca inició", () => {
    const r = computeObservationDuration({
      observationStartedAt: null,
      observationEndedAt: null,
      now,
    });
    expect(r.minutes).toBe(0);
    expect(r.isOpen).toBe(false);
  });

  it("calcula minutos abiertos (sin endedAt)", () => {
    const started = new Date(now.getTime() - 75 * 60 * 1000);
    const r = computeObservationDuration({
      observationStartedAt: started,
      observationEndedAt: null,
      now,
    });
    expect(r.minutes).toBe(75);
    expect(r.isOpen).toBe(true);
  });

  it("calcula minutos cerrados (con endedAt)", () => {
    const started = new Date(now.getTime() - 120 * 60 * 1000);
    const ended = new Date(now.getTime() - 30 * 60 * 1000);
    const r = computeObservationDuration({
      observationStartedAt: started,
      observationEndedAt: ended,
      now,
    });
    expect(r.minutes).toBe(90);
    expect(r.isOpen).toBe(false);
  });

  it("nunca retorna negativo si endedAt < startedAt (defensa)", () => {
    const started = new Date(now.getTime());
    const ended = new Date(now.getTime() - 60 * 60 * 1000);
    const r = computeObservationDuration({
      observationStartedAt: started,
      observationEndedAt: ended,
      now,
    });
    expect(r.minutes).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Beta.4 — re-triage trigger
// ---------------------------------------------------------------------------

describe("shouldTriggerRetriage", () => {
  it("sin previous: usa solo umbrales absolutos críticos", () => {
    const r = shouldTriggerRetriage({
      previous: null,
      current: { spo2: 88 },
    });
    expect(r.shouldRetriage).toBe(true);
    expect(r.reasons[0]).toMatch(/SpO2/);
  });

  it("SpO2 caída de 4+ puntos gatilla retriage", () => {
    const r = shouldTriggerRetriage({
      previous: { spo2: 98 },
      current: { spo2: 94 },
    });
    expect(r.shouldRetriage).toBe(true);
  });

  it("HR salto >= 30 gatilla", () => {
    const r = shouldTriggerRetriage({
      previous: { heartRate: 80 },
      current: { heartRate: 115 },
    });
    expect(r.shouldRetriage).toBe(true);
  });

  it("RR absoluto >= 25 gatilla aunque no haya previous", () => {
    const r = shouldTriggerRetriage({
      previous: null,
      current: { respiratoryRate: 28 },
    });
    expect(r.shouldRetriage).toBe(true);
  });

  it("sistólica baja absoluta gatilla", () => {
    const r = shouldTriggerRetriage({
      previous: { systolicBp: 130 },
      current: { systolicBp: 85 },
    });
    expect(r.shouldRetriage).toBe(true);
    // Tanto absoluto como delta deben aparecer.
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("dolor salto >= 4 gatilla", () => {
    const r = shouldTriggerRetriage({
      previous: { painScale: 2 },
      current: { painScale: 8 },
    });
    expect(r.shouldRetriage).toBe(true);
  });

  it("vitales estables NO gatillan", () => {
    const r = shouldTriggerRetriage({
      previous: {
        heartRate: 80,
        respiratoryRate: 16,
        spo2: 98,
        systolicBp: 130,
        painScale: 2,
      },
      current: {
        heartRate: 82,
        respiratoryRate: 17,
        spo2: 97,
        systolicBp: 128,
        painScale: 3,
      },
    });
    expect(r.shouldRetriage).toBe(false);
    expect(r.reasons.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Beta.4 — inputs nuevos
// ---------------------------------------------------------------------------

describe("lwbsCheckInput", () => {
  it("default dryRun=true, limit=100", () => {
    const r = lwbsCheckInput.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dryRun).toBe(true);
      expect(r.data.limit).toBe(100);
    }
  });
  it("rechaza timeoutMinutes < 15", () =>
    expect(lwbsCheckInput.safeParse({ timeoutMinutes: 5 }).success).toBe(false));
  it("rechaza limit > 500", () =>
    expect(lwbsCheckInput.safeParse({ limit: 999 }).success).toBe(false));
});

describe("emergencyVitalRecordInput", () => {
  it("acepta vitales válidos", () => {
    const r = emergencyVitalRecordInput.safeParse({
      visitId: u,
      heartRate: 88,
      spo2: 97,
      temperatureC: 37.2,
    });
    expect(r.success).toBe(true);
  });
  it("rechaza spo2 > 100", () =>
    expect(emergencyVitalRecordInput.safeParse({ visitId: u, spo2: 105 }).success).toBe(false));
  it("rechaza temperatureC < 28", () =>
    expect(
      emergencyVitalRecordInput.safeParse({ visitId: u, temperatureC: 25 }).success,
    ).toBe(false));
  it("acepta sólo visitId (todos vitales opcionales)", () =>
    expect(emergencyVitalRecordInput.safeParse({ visitId: u }).success).toBe(true));
});

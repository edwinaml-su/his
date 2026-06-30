import { describe, it, expect } from "vitest";
import {
  computeAlertasVitales,
  evaLabel,
  imcFrom,
  imcClasificacion,
  ictFrom,
  ictClasificacion,
  glasgowTotal,
  glasgowSeveridad,
  fppNaegele,
  gestacionDesdeFur,
  esFemenino,
  puedeEmbarazo,
} from "../signos-vitales";

// ─── computeAlertasVitales ───────────────────────────────────────────────────

describe("computeAlertasVitales", () => {
  it("sin alertas cuando todos los valores son normales", () => {
    expect(
      computeAlertasVitales({
        saturacionO2: 95,
        presionSistolica: 120,
        presionDiastolica: 80,
        temperatura: 37,
        frecuenciaCardiaca: 75,
        frecuenciaRespiratoria: 16,
        dolorEva: 3,
      }),
    ).toEqual([]);
  });

  it("ignora valores ausentes (undefined y null)", () => {
    expect(computeAlertasVitales({})).toEqual([]);
    expect(computeAlertasVitales({ saturacionO2: null })).toEqual([]);
    expect(computeAlertasVitales({ frecuenciaCardiaca: undefined })).toEqual([]);
  });

  it("ignora NaN", () => {
    expect(computeAlertasVitales({ temperatura: NaN })).toEqual([]);
  });

  // SpO2
  it("SpO₂ baja: < 90 dispara alerta", () => {
    expect(computeAlertasVitales({ saturacionO2: 89 })).toContain("SpO₂ baja");
  });
  it("SpO₂ baja: = 89 (justo dentro)", () => {
    expect(computeAlertasVitales({ saturacionO2: 89 })).toContain("SpO₂ baja");
  });
  it("SpO₂ baja: = 90 NO dispara alerta", () => {
    expect(computeAlertasVitales({ saturacionO2: 90 })).not.toContain("SpO₂ baja");
  });

  // Crisis hipertensiva — sistólica
  it("crisis hipertensiva: sistólica >= 180", () => {
    expect(computeAlertasVitales({ presionSistolica: 180 })).toContain("Crisis hipertensiva");
  });
  it("crisis hipertensiva: sistólica = 179 NO dispara", () => {
    expect(computeAlertasVitales({ presionSistolica: 179 })).not.toContain("Crisis hipertensiva");
  });

  // Crisis hipertensiva — diastólica
  it("crisis hipertensiva: diastólica >= 110", () => {
    expect(computeAlertasVitales({ presionDiastolica: 110 })).toContain("Crisis hipertensiva");
  });
  it("crisis hipertensiva: diastólica = 109 NO dispara", () => {
    expect(computeAlertasVitales({ presionDiastolica: 109 })).not.toContain("Crisis hipertensiva");
  });

  // Hipotensión
  it("hipotensión: sistólica < 90", () => {
    expect(computeAlertasVitales({ presionSistolica: 89 })).toContain("Hipotensión");
  });
  it("hipotensión: sistólica = 90 NO dispara", () => {
    expect(computeAlertasVitales({ presionSistolica: 90 })).not.toContain("Hipotensión");
  });

  // Temperatura — fiebre alta
  it("fiebre alta: temperatura >= 39.5", () => {
    expect(computeAlertasVitales({ temperatura: 39.5 })).toContain("Fiebre alta");
  });
  it("fiebre alta: temperatura = 39.4 NO dispara", () => {
    expect(computeAlertasVitales({ temperatura: 39.4 })).not.toContain("Fiebre alta");
  });

  // Temperatura — hipotermia
  it("hipotermia: temperatura <= 35", () => {
    expect(computeAlertasVitales({ temperatura: 35 })).toContain("Hipotermia");
  });
  it("hipotermia: temperatura = 35.1 NO dispara", () => {
    expect(computeAlertasVitales({ temperatura: 35.1 })).not.toContain("Hipotermia");
  });

  // FC taquicardia
  it("taquicardia: FC > 120", () => {
    expect(computeAlertasVitales({ frecuenciaCardiaca: 121 })).toContain("Taquicardia");
  });
  it("taquicardia: FC = 120 NO dispara", () => {
    expect(computeAlertasVitales({ frecuenciaCardiaca: 120 })).not.toContain("Taquicardia");
  });

  // FC bradicardia
  it("bradicardia: FC < 50", () => {
    expect(computeAlertasVitales({ frecuenciaCardiaca: 49 })).toContain("Bradicardia");
  });
  it("bradicardia: FC = 50 NO dispara", () => {
    expect(computeAlertasVitales({ frecuenciaCardiaca: 50 })).not.toContain("Bradicardia");
  });

  // FR taquipnea
  it("taquipnea: FR > 24", () => {
    expect(computeAlertasVitales({ frecuenciaRespiratoria: 25 })).toContain("Taquipnea");
  });
  it("taquipnea: FR = 24 NO dispara", () => {
    expect(computeAlertasVitales({ frecuenciaRespiratoria: 24 })).not.toContain("Taquipnea");
  });

  // FR bradipnea
  it("bradipnea: FR < 10", () => {
    expect(computeAlertasVitales({ frecuenciaRespiratoria: 9 })).toContain("Bradipnea");
  });
  it("bradipnea: FR = 10 NO dispara", () => {
    expect(computeAlertasVitales({ frecuenciaRespiratoria: 10 })).not.toContain("Bradipnea");
  });

  // Dolor EVA
  it("dolor intenso: EVA >= 7", () => {
    expect(computeAlertasVitales({ dolorEva: 7 })).toContain("Dolor intenso");
  });
  it("dolor intenso: EVA = 6 NO dispara", () => {
    expect(computeAlertasVitales({ dolorEva: 6 })).not.toContain("Dolor intenso");
  });

  // Múltiples alertas simultáneas
  it("múltiples alertas simultáneas", () => {
    const alertas = computeAlertasVitales({
      saturacionO2: 85,
      presionSistolica: 85,
      temperatura: 40,
      frecuenciaCardiaca: 130,
      frecuenciaRespiratoria: 26,
      dolorEva: 8,
    });
    expect(alertas).toContain("SpO₂ baja");
    expect(alertas).toContain("Hipotensión");
    expect(alertas).toContain("Fiebre alta");
    expect(alertas).toContain("Taquicardia");
    expect(alertas).toContain("Taquipnea");
    expect(alertas).toContain("Dolor intenso");
  });
});

// ─── evaLabel ────────────────────────────────────────────────────────────────

describe("evaLabel", () => {
  it("0 → Sin dolor", () => {
    expect(evaLabel(0)).toBe("Sin dolor");
  });
  it("1 → Dolor leve", () => {
    expect(evaLabel(1)).toBe("Dolor leve");
  });
  it("3 → Dolor leve (límite superior de la banda)", () => {
    expect(evaLabel(3)).toBe("Dolor leve");
  });
  it("4 → Dolor moderado", () => {
    expect(evaLabel(4)).toBe("Dolor moderado");
  });
  it("6 → Dolor moderado (límite superior de la banda)", () => {
    expect(evaLabel(6)).toBe("Dolor moderado");
  });
  it("7 → Dolor intenso", () => {
    expect(evaLabel(7)).toBe("Dolor intenso");
  });
  it("9 → Dolor intenso (límite superior de la banda)", () => {
    expect(evaLabel(9)).toBe("Dolor intenso");
  });
  it("10 → Dolor máximo", () => {
    expect(evaLabel(10)).toBe("Dolor máximo");
  });
});

// ─── IMC (§10.6) ─────────────────────────────────────────────────────────────

describe("imcFrom / imcClasificacion", () => {
  it("imcFrom = peso / talla²", () => {
    expect(imcFrom(70, 1.75)).toBeCloseTo(22.86, 2);
  });

  // Cortes OMS: <18.5 bajo · <25 normal · <30 sobrepeso · ≥30 obesidad
  it("18.4 → bajo peso", () => expect(imcClasificacion(18.4).key).toBe("bajo"));
  it("18.5 → normal (límite inferior)", () => expect(imcClasificacion(18.5).key).toBe("normal"));
  it("24.9 → normal", () => expect(imcClasificacion(24.9).key).toBe("normal"));
  it("25 → sobrepeso (límite inferior)", () => expect(imcClasificacion(25).key).toBe("sobrepeso"));
  it("29.9 → sobrepeso", () => expect(imcClasificacion(29.9).key).toBe("sobrepeso"));
  it("30 → obesidad (límite inferior)", () => expect(imcClasificacion(30).key).toBe("obesidad"));
});

// ─── Índice cintura-talla (§10.7) ────────────────────────────────────────────

describe("ictFrom / ictClasificacion", () => {
  it("ictFrom = cintura(cm) / (talla(m) × 100)", () => {
    expect(ictFrom(90, 1.6)).toBeCloseTo(0.5625, 4);
  });

  // Cortes spec §10.7: <0.5 saludable · <0.6 riesgo aumentado · ≥0.6 riesgo alto
  it("0.49 → saludable", () => expect(ictClasificacion(0.49).key).toBe("saludable"));
  it("0.5 → riesgo aumentado (límite inferior)", () =>
    expect(ictClasificacion(0.5).key).toBe("riesgoAumentado"));
  it("0.59 → riesgo aumentado", () => expect(ictClasificacion(0.59).key).toBe("riesgoAumentado"));
  it("0.6 → riesgo alto (límite inferior)", () =>
    expect(ictClasificacion(0.6).key).toBe("riesgoAlto"));
});

// ─── Glasgow (§10.5) ─────────────────────────────────────────────────────────

describe("glasgowTotal / glasgowSeveridad", () => {
  it("suma las 3 respuestas", () => expect(glasgowTotal(4, 5, 6)).toBe(15));
  it("null si falta alguna respuesta", () => {
    expect(glasgowTotal(null, 5, 6)).toBeNull();
    expect(glasgowTotal(4, null, 6)).toBeNull();
    expect(glasgowTotal(4, 5, null)).toBeNull();
  });

  // Severidad: Leve 13–15 · Moderado 9–12 · Grave 3–8
  it("15 → Leve", () => expect(glasgowSeveridad(15)).toBe("Leve"));
  it("13 → Leve (límite inferior)", () => expect(glasgowSeveridad(13)).toBe("Leve"));
  it("12 → Moderado", () => expect(glasgowSeveridad(12)).toBe("Moderado"));
  it("9 → Moderado (límite inferior)", () => expect(glasgowSeveridad(9)).toBe("Moderado"));
  it("8 → Grave (límite superior)", () => expect(glasgowSeveridad(8)).toBe("Grave"));
  it("3 → Grave", () => expect(glasgowSeveridad(3)).toBe("Grave"));
});

// ─── Gineco-obstétrico (§10.4) ───────────────────────────────────────────────

describe("fppNaegele", () => {
  // Midday-local evita la ambigüedad de zona horaria del parse date-only (UTC).
  it("regla de Naegele: +1 año −3 meses +7 días", () => {
    const fpp = fppNaegele("2025-05-15T12:00:00");
    expect(fpp).not.toBeNull();
    expect(fpp!.getFullYear()).toBe(2026);
    expect(fpp!.getMonth()).toBe(1); // febrero
    expect(fpp!.getDate()).toBe(22);
  });
  it("cadena vacía → null", () => expect(fppNaegele("")).toBeNull());
  it("fecha inválida → null", () => expect(fppNaegele("no-es-fecha")).toBeNull());
});

describe("gestacionDesdeFur", () => {
  const fur = "2025-01-01T12:00:00";
  it("calcula semanas y días desde la FUR", () => {
    const g = gestacionDesdeFur(fur, new Date("2025-01-19T12:00:00"));
    expect(g).toEqual({ semanas: 2, dias: 4, label: "2 sem 4 d" });
  });
  it("ref anterior a la FUR → null", () => {
    expect(gestacionDesdeFur(fur, new Date("2024-12-01T12:00:00"))).toBeNull();
  });
  it("cadena vacía → null", () => expect(gestacionDesdeFur("")).toBeNull());
});

// ─── Condicionales por sexo/edad (§10.4 gating) ──────────────────────────────

describe("esFemenino", () => {
  it("'F' / 'f' / ' F ' → true", () => {
    expect(esFemenino("F")).toBe(true);
    expect(esFemenino("f")).toBe(true);
    expect(esFemenino(" F ")).toBe(true);
  });
  it("'M', vacío, null, undefined → false", () => {
    expect(esFemenino("M")).toBe(false);
    expect(esFemenino("")).toBe(false);
    expect(esFemenino(null)).toBe(false);
    expect(esFemenino(undefined)).toBe(false);
  });
});

describe("puedeEmbarazo", () => {
  it("femenino en edad fértil (10–55) → true", () => {
    expect(puedeEmbarazo("F", 25)).toBe(true);
    expect(puedeEmbarazo("F", 10)).toBe(true);
    expect(puedeEmbarazo("F", 55)).toBe(true);
  });
  it("fuera del rango fértil → false", () => {
    expect(puedeEmbarazo("F", 9)).toBe(false);
    expect(puedeEmbarazo("F", 56)).toBe(false);
  });
  it("masculino o edad ausente → false", () => {
    expect(puedeEmbarazo("M", 25)).toBe(false);
    expect(puedeEmbarazo("F", null)).toBe(false);
  });
});

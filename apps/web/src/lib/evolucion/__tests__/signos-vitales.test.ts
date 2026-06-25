import { describe, it, expect } from "vitest";
import { computeAlertasVitales, evaLabel } from "../signos-vitales";

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

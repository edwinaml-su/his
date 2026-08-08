/**
 * CC-0016 — Tests unitarios de la derivación pura del catálogo de imágenes.
 * No toca BD; verifica los conteos reales de aplicar RE_CONTRASTE/RE_AYUNO/
 * autorización sobre los 292 nombres literales del mockup
 * (docs/CC/0016/mockup_modulo_imagenes.html).
 *
 * Conteos verificados ejecutando la derivación real (node -e, ver historial
 * de la tarea CC-0016): 40 contraste, 24 ayuno, 36 autorización — coinciden
 * con el hint del diseño aprobado por @Orq.
 */
import { describe, it, expect } from "vitest";
import {
  CATS,
  RAW,
  RE_CONTRASTE,
  RE_AYUNO,
  PREF,
  DURACION_MIN_BY_CAT,
  MODALITY_TYPE_BY_CAT,
  construirCatalogo,
} from "../lib/imagenes-catalogo-derivacion.mjs";

describe("RAW — catálogo fuente", () => {
  it("tiene exactamente 292 prestaciones en 5 categorías", () => {
    const total = Object.values(RAW).reduce((acc, arr) => acc + arr.length, 0);
    expect(total).toBe(292);
  });

  it("respeta los conteos por categoría del mockup", () => {
    expect(RAW.esp).toHaveLength(36);
    expect(RAW.rx).toHaveLength(70);
    expect(RAW.rm).toHaveLength(53);
    expect(RAW.tac).toHaveLength(71);
    expect(RAW.usg).toHaveLength(62);
  });

  it("CATS trae las 5 categorías en el orden del mockup", () => {
    expect(CATS.map((c) => c.id)).toEqual(["esp", "rx", "rm", "tac", "usg"]);
  });
});

describe("construirCatalogo", () => {
  const catalogo = construirCatalogo();

  it("genera 292 items", () => {
    expect(catalogo).toHaveLength(292);
  });

  it("genera códigos únicos con prefijo + correlativo pad-3", () => {
    const codes = new Set(catalogo.map((i) => i.code));
    expect(codes.size).toBe(292);
    expect(catalogo.find((i) => i.name === "ARTERIOGRAFIA AORTA Y MIEMBROS INFERIORES").code).toBe(
      "EE001",
    );
    expect(catalogo.find((i) => i.name === "RX ABDOMEN").code).toBe("RX001");
    expect(catalogo.find((i) => i.name === "UROTOMOGRAFIA").code).toBe(
      PREF.tac + "071",
    );
  });

  it("deriva exactamente 40 prestaciones con contraste (RE_CONTRASTE real sobre los 292 nombres)", () => {
    expect(catalogo.filter((i) => i.contraste)).toHaveLength(40);
  });

  it("deriva exactamente 24 prestaciones con ayuno (RE_AYUNO real sobre los 292 nombres)", () => {
    expect(catalogo.filter((i) => i.ayuno)).toHaveLength(24);
  });

  it("deriva exactamente 36 prestaciones con autorización (= todas las de Estudios Especiales)", () => {
    const auth = catalogo.filter((i) => i.autorizacion);
    expect(auth).toHaveLength(36);
    expect(auth.every((i) => i.cat === "esp")).toBe(true);
  });

  it("asigna duración estimada por categoría", () => {
    for (const item of catalogo) {
      expect(item.duracionMin).toBe(DURACION_MIN_BY_CAT[item.cat]);
    }
    expect(DURACION_MIN_BY_CAT).toEqual({ rm: 40, tac: 25, esp: 60, usg: 20, rx: 15 });
  });

  it("asigna modalityType DICOM lógico por categoría", () => {
    expect(MODALITY_TYPE_BY_CAT).toEqual({ esp: "XA", rx: "CR", rm: "MR", tac: "CT", usg: "US" });
    for (const item of catalogo) {
      expect(item.modalityType).toBe(MODALITY_TYPE_BY_CAT[item.cat]);
    }
  });

  it("casos puntuales de RE_CONTRASTE (angio/urografía/pielograma sí; simple no)", () => {
    const byName = Object.fromEntries(catalogo.map((i) => [i.name, i]));
    expect(byName["TOMOGRAFIA ANGIO ABDOMINAL"].contraste).toBe(true);
    expect(byName["RX UROGRAFIA ESCRETORA"].contraste).toBe(true);
    expect(byName["RX PIELOGRAMA"].contraste).toBe(true);
    expect(byName["RX TORAX"].contraste).toBe(false);
    expect(byName["ULTRASONIDO RENAL"].contraste).toBe(false);
  });

  it("casos puntuales de RE_AYUNO (abdominal/vías biliares/vesical sí; extremidades no)", () => {
    const byName = Object.fromEntries(catalogo.map((i) => [i.name, i]));
    expect(byName["ULTRASONIDO ABDOMINAL"].ayuno).toBe(true);
    expect(byName["ULTRASONIDO VIAS BILIARES"].ayuno).toBe(true);
    expect(byName["ULTRASONIDO VESICAL"].ayuno).toBe(true);
    expect(byName["RX TORAX"].ayuno).toBe(false);
    expect(byName["ULTRASONIDO RODILLA DERECHA"].ayuno).toBe(false);
  });
});

describe("RE_CONTRASTE / RE_AYUNO — regex exactas del mockup", () => {
  it("RE_CONTRASTE matchea las palabras clave esperadas", () => {
    expect(RE_CONTRASTE.test("TOMOGRAFIA CORONARIA")).toBe(true);
    expect(RE_CONTRASTE.test("TOMOGRAFIA COLUMNA MIELOTAC")).toBe(true);
    expect(RE_CONTRASTE.test("RX TUBO DIGESTIVO SUPERIOR")).toBe(true);
  });

  it("RE_AYUNO matchea las palabras clave esperadas", () => {
    expect(RE_AYUNO.test("R. MAGNETICA COLEDOCO")).toBe(true);
    expect(RE_AYUNO.test("ULTRASONIDO PROSTATA")).toBe(true);
  });
});

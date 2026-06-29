import { describe, it, expect } from "vitest";
import {
  parseDocumento,
  validarNumeroDocumento,
  type TipoDocumento,
} from "../parse-documento";

describe("parseDocumento — §7 simulación", () => {
  it("DUI devuelve la muestra del mockup (mapea 1:1 a campos del formulario)", () => {
    const d = parseDocumento("raw-pdf417", "DUI");
    expect(d).toMatchObject({
      tipoDocumento: "DUI",
      numeroDocumento: "04829175-0",
      primerNombre: "María",
      segundoNombre: "Fernanda",
      primerApellido: "Hernández",
      segundoApellido: "Portillo",
      apellidoCasada: "de Castellanos",
      sexoBiologico: "FEMENINO",
      fechaNacimiento: "1990-07-14",
    });
  });

  it("cada tipo devuelve su propio tipoDocumento + sexo válido", () => {
    (["DUI", "PASAPORTE", "CARNET_RESIDENTE"] as TipoDocumento[]).forEach((t) => {
      const d = parseDocumento("raw", t);
      expect(d.tipoDocumento).toBe(t);
      expect(["MASCULINO", "FEMENINO"]).toContain(d.sexoBiologico);
      expect(d.fechaNacimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe("validarNumeroDocumento — §7 patrones por tipo", () => {
  it("DUI exige ########-#", () => {
    expect(validarNumeroDocumento("DUI", "04829175-3")).toBe(true);
    expect(validarNumeroDocumento("DUI", "048291753")).toBe(false);
    expect(validarNumeroDocumento("DUI", "ABC")).toBe(false);
  });

  it("Pasaporte alfanumérico 6–9 (normaliza a mayúsculas)", () => {
    expect(validarNumeroDocumento("PASAPORTE", "a1234567")).toBe(true);
    expect(validarNumeroDocumento("PASAPORTE", "AB12")).toBe(false);
  });

  it("Carnet de Residente permisivo", () => {
    expect(validarNumeroDocumento("CARNET_RESIDENTE", "RES-0098231")).toBe(true);
    expect(validarNumeroDocumento("CARNET_RESIDENTE", "x")).toBe(false);
  });
});

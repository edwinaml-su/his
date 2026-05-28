// @vitest-environment jsdom
/**
 * Tests del componente <Abbr term="..."/>.
 */
import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Abbr } from "../abbr";
import { lookupAbbreviation, listAbbreviations } from "../../lib/abbreviations";

describe("Abbr", () => {
  it("renderiza el término dentro de <abbr> con title que incluye ES y EN", () => {
    render(<Abbr term="UUID" />);
    const el = screen.getByText("UUID");
    expect(el.tagName).toBe("ABBR");
    expect(el.getAttribute("title")).toContain("Identificador Único Universal");
    expect(el.getAttribute("title")).toContain("Universally Unique Identifier");
  });

  it("renderiza solo ES cuando no hay traducción en inglés (ej. DUI)", () => {
    render(<Abbr term="DUI" />);
    const el = screen.getByText("DUI");
    const title = el.getAttribute("title") ?? "";
    expect(title).toContain("Documento Único de Identidad");
    expect(title).not.toMatch(/\(EN\)/);
  });

  it("acepta children custom como display text", () => {
    render(<Abbr term="HIS">SIS-HOSP</Abbr>);
    expect(screen.getByText("SIS-HOSP")).toBeInTheDocument();
    // El title se computa del lookup, no del children.
    expect(screen.getByText("SIS-HOSP").getAttribute("title")).toContain(
      "Hospital Information System",
    );
  });

  it("failsafe: si el término no existe, renderiza span sin tooltip", () => {
    render(<Abbr term="XYZNOEXISTE" />);
    const el = screen.getByText("XYZNOEXISTE");
    expect(el.tagName).toBe("SPAN");
    expect(el.getAttribute("title")).toBeNull();
  });
});

describe("lookupAbbreviation", () => {
  it("matchea case-sensitive primero (eMAR)", () => {
    expect(lookupAbbreviation("eMAR")?.es).toMatch(/Medicamentos/);
  });

  it("matchea case-insensitive como fallback", () => {
    expect(lookupAbbreviation("uuid")?.es).toContain("Identificador");
  });

  it("devuelve null para términos desconocidos", () => {
    expect(lookupAbbreviation("FOOBAR")).toBeNull();
  });

  it("devuelve null para string vacío", () => {
    expect(lookupAbbreviation("")).toBeNull();
  });
});

describe("listAbbreviations", () => {
  it("devuelve lista ordenada alfabéticamente con al menos 30 abreviaturas", () => {
    const all = listAbbreviations();
    expect(all.length).toBeGreaterThanOrEqual(30);
    // Verifica orden alfabético.
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.term.localeCompare(all[i - 1]!.term)).toBeGreaterThanOrEqual(0);
    }
  });

  it("incluye términos clave del HIS (DUI, NTEC, ECE, MRN, GSRN)", () => {
    const terms = listAbbreviations().map((a) => a.term);
    expect(terms).toContain("DUI");
    expect(terms).toContain("NTEC");
    expect(terms).toContain("ECE");
    expect(terms).toContain("MRN");
    expect(terms).toContain("GSRN");
  });
});

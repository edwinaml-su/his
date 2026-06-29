// @vitest-environment jsdom
/**
 * Tests de PatientContextBar — el "segundo header" persistente del paciente
 * (CC-0008 §B). Foco: la ranura de alerta LGBTIQ+ (nombre de pila) que se
 * agregó en este control de cambios, además de un par de aserciones de humo
 * sobre identidad y alergias para no regresar el resto de la barra.
 */
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PatientContextBar } from "../patient-context-bar";

const basePatient = {
  id: "p1",
  firstName: "María",
  lastName: "Hernández",
  mrn: "SV8400001",
  birthDate: new Date(1990, 6, 14),
  biologicalSexCode: "F",
};

describe("PatientContextBar — alerta LGBTIQ+", () => {
  afterEach(() => cleanup());

  it("muestra el chip de nombre de pila cuando lgbtiq=true y hay preferredName", () => {
    render(
      <PatientContextBar
        patient={basePatient}
        alerts={{ lgbtiq: true, preferredName: "Alex" }}
      />,
    );

    expect(screen.getByText(/Nombre de pila: Alex/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Persona de la comunidad LGBTIQ\+\. Nombre de pila: Alex/),
    ).toBeInTheDocument();
  });

  it("cae a la etiqueta LGBTIQ+ cuando no hay preferredName", () => {
    render(
      <PatientContextBar patient={basePatient} alerts={{ lgbtiq: true }} />,
    );

    expect(screen.getByText("LGBTIQ+")).toBeInTheDocument();
  });

  it("NO muestra la alerta LGBTIQ+ cuando lgbtiq es falso/ausente", () => {
    render(
      <PatientContextBar
        patient={basePatient}
        alerts={{ preferredName: "Alex" }}
      />,
    );

    expect(screen.queryByText(/Nombre de pila/)).not.toBeInTheDocument();
    expect(screen.queryByText("LGBTIQ+")).not.toBeInTheDocument();
  });

  it("renderiza identidad básica y chips de alergias (humo de la barra)", () => {
    render(
      <PatientContextBar
        patient={basePatient}
        alerts={{
          allergies: [{ name: "Penicilina", severity: "SEVERE" }],
          lgbtiq: true,
          preferredName: "Alex",
        }}
      />,
    );

    expect(screen.getByText("María Hernández")).toBeInTheDocument();
    expect(screen.getByText(/MRN SV8400001/)).toBeInTheDocument();
    expect(screen.getByText(/Alergia: Penicilina/)).toBeInTheDocument();
    expect(screen.getByText(/Nombre de pila: Alex/)).toBeInTheDocument();
  });
});

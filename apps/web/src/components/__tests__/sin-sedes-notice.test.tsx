// @vitest-environment jsdom
/**
 * Tests de <SinSedesNotice /> — aviso interino para orgs sin establecimientos
 * (fuera-de-alcance FIX-establishment-list-uuid §5). Componente puro sin
 * mocks; el wiring real (reemplazar el combo de sede vacío en /turnos,
 * /consultorios, /organizations/habitaciones y /organizations/camas) queda
 * cubierto por revisión manual + E2E.
 */
import * as React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SinSedesNotice } from "../sin-sedes-notice";

afterEach(() => cleanup());

describe("<SinSedesNotice />", () => {
  it("muestra el mensaje acordado para orgs sin sedes", () => {
    render(<SinSedesNotice />);
    expect(
      screen.getByText("Esta organización no tiene sedes configuradas."),
    ).toBeInTheDocument();
  });
});

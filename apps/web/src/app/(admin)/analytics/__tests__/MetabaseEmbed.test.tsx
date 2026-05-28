// @vitest-environment jsdom
/**
 * MetabaseEmbed.test.tsx — Tests del componente MetabaseEmbed.
 *
 * Casos:
 * 1. Renderiza iframe cuando el server action retorna una URL valida.
 * 2. Sin JWT (resultado unconfigured) → muestra fallback "Configurando dashboard...".
 * 3. Error de permiso → muestra mensaje de error legible.
 * 4. Error de red/fetch → muestra error generico.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MetabaseEmbed } from "../_components/MetabaseEmbed";

// Mock del server action — simula la respuesta del servidor sin requerir Node/session.
vi.mock("../_actions/metabase-jwt", () => ({
  getMetabaseEmbedToken: vi.fn(),
}));

import { getMetabaseEmbedToken } from "../_actions/metabase-jwt";

const mockGetToken = vi.mocked(getMetabaseEmbedToken);

describe("MetabaseEmbed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza el iframe cuando el token se obtiene correctamente", async () => {
    mockGetToken.mockResolvedValueOnce({
      token: "eyJhbGciOiJIUzI1NiJ9.test.sig",
      iframeUrl: "https://bi.avante.com.sv/embed/dashboard/eyJhbGciOiJIUzI1NiJ9.test.sig",
    });

    render(<MetabaseEmbed kpiId="K-CLI-01" title="Dashboard K-CLI-01 — Censo de camas" />);

    // Muestra loading mientras espera.
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Luego muestra el iframe.
    const iframe = await screen.findByTitle("Dashboard K-CLI-01 — Censo de camas");
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute("src", expect.stringContaining("embed/dashboard"));
  });

  it("muestra fallback de configuracion cuando el dashboard no esta configurado", async () => {
    mockGetToken.mockResolvedValueOnce({
      error: "Dashboard K-CLI-01 no configurado. Contacte al administrador.",
    });

    render(<MetabaseEmbed kpiId="K-CLI-01" title="Dashboard Censo" />);

    await waitFor(() => {
      expect(screen.getByText("Dashboard pendiente de configuración")).toBeInTheDocument();
    });

    // No debe haber iframe.
    expect(screen.queryByRole("iframe")).not.toBeInTheDocument();
  });

  it("muestra error legible cuando el usuario no tiene permiso", async () => {
    mockGetToken.mockResolvedValueOnce({
      error: "Sin permiso para ver este dashboard",
    });

    render(<MetabaseEmbed kpiId="K-FIN-01" title="Dashboard Revenue" />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Sin permiso para ver este dashboard")).toBeInTheDocument();
    });
  });

  it("degrada a estado 'pendiente' cuando la Server Action lanza", async () => {
    // Comportamiento intencional post-fix: si la action falla (red, deploy
    // parcial, getCurrentUser/getTenantContext lanza), el componente cae a
    // "unconfigured" en lugar de mostrar banner rojo "Error de conexión".
    // El error sigue disponible en console.error para debugging.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockGetToken.mockRejectedValueOnce(new Error("Network error"));

    render(<MetabaseEmbed kpiId="K-OPS-01" title="Dashboard Transfusiones" />);

    await waitFor(() => {
      expect(screen.getByText("Dashboard pendiente de configuración")).toBeInTheDocument();
    });
    // No alert rojo.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Pero sí se loguea para debugging.
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("el iframe tiene sandbox restrictivo", async () => {
    mockGetToken.mockResolvedValueOnce({
      token: "test-token",
      iframeUrl: "https://bi.avante.com.sv/embed/dashboard/test-token",
    });

    render(<MetabaseEmbed kpiId="K-CLI-02" title="LOS Dashboard" />);

    const iframe = await screen.findByTitle("LOS Dashboard");
    expect(iframe).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-popups allow-forms"
    );
  });
});

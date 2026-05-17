// @vitest-environment jsdom
/**
 * Tests de TrazabilidadPage — GS1 EPCIS Query Layer.
 *
 * Estrategia: mock de @/lib/trpc/react vía alias resuelto + mock de next/navigation.
 * No necesita DB — verifica comportamiento de UI con datos simulados.
 *
 * Casos:
 *   1. Renderiza el título y el formulario de búsqueda.
 *   2. Modo GLN muestra campo "GLN (ubicación)" por defecto.
 *   3. Sin resultados tras submit muestra mensaje vacío.
 *   4. Con resultados muestra tabla con eventos.
 *   5. Error de query muestra mensaje de error.
 *   6. Botón Limpiar resetea el estado (sección resultados desaparece).
 *   7. Modo Equipo muestra campo UUID.
 *
 * @QA — E2E (Playwright): buscar GLN real devuelve timeline con datos de Supabase.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mocks de infraestructura Next.js ─────────────────────────────────────────

vi.mock("next/navigation", () => ({
  usePathname: () => "/gs1/trazabilidad",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// ─── Mock tRPC — intercepta ANTES de que page.tsx lo importe ─────────────────
// El alias "@" resuelve a "apps/web/src" según vitest.config.ts.
// vi.mock usa el path que la página importa: "@/lib/trpc/react".

const mockUseQuery = vi.fn();

vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    epcisQuery: {
      queryByGln: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
      queryByEquipment: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
      queryByOrigin: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
      queryRecent: { useQuery: (...args: unknown[]) => mockUseQuery(...args) },
    },
  },
}));

import TrazabilidadPage from "../page";

// ─── Estado base del mock ─────────────────────────────────────────────────────

const idleState = {
  data: undefined,
  isFetching: false,
  isError: false,
  error: null,
};

const emptyState = { ...idleState, data: [] };

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    equipment_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    gln_destino: "7891234567890",
    gln_origen: "7890987654321",
    registrado_por: null,
    registrado_en: new Date("2026-03-01T10:00:00Z"),
    notas: "traslado de prueba",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TrazabilidadPage", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(idleState);
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue(idleState);
  });

  afterEach(() => {
    cleanup();
  });

  // ── 1. Renderiza título y formulario ─────────────────────────────────────────

  it("renderiza el título y el formulario de búsqueda", () => {
    render(<TrazabilidadPage />);

    expect(screen.getByText("Trazabilidad GS1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buscar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeInTheDocument();
  });

  // ── 2. Modo GLN por defecto ───────────────────────────────────────────────────

  it("el modo GLN por defecto muestra campo 'GLN (ubicación)'", () => {
    render(<TrazabilidadPage />);

    expect(screen.getByLabelText("GLN (ubicación)")).toBeInTheDocument();
  });

  // ── 3. Sin resultados muestra mensaje vacío ───────────────────────────────────

  it("muestra mensaje vacío cuando no hay eventos", async () => {
    mockUseQuery.mockReturnValue(emptyState);
    render(<TrazabilidadPage />);

    const input = screen.getByLabelText("GLN (ubicación)");
    fireEvent.change(input, { target: { value: "7891234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => {
      expect(
        screen.getByText(/No se encontraron eventos/i),
      ).toBeInTheDocument();
    });
  });

  // ── 4. Con resultados muestra tabla ──────────────────────────────────────────

  it("muestra tabla de eventos cuando hay resultados", async () => {
    const events = [makeEvent()];
    mockUseQuery.mockReturnValue({ ...idleState, data: events });
    render(<TrazabilidadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => {
      expect(screen.getByText("7891234567890")).toBeInTheDocument();
      expect(screen.getByText("traslado de prueba")).toBeInTheDocument();
    });
  });

  // ── 5. Error de query muestra mensaje de error ───────────────────────────────

  it("muestra error cuando la query falla", async () => {
    mockUseQuery.mockReturnValue({
      ...idleState,
      isError: true,
      error: { message: "Sin permiso" },
    });
    render(<TrazabilidadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => {
      expect(screen.getByText(/Sin permiso/i)).toBeInTheDocument();
    });
  });

  // ── 6. Limpiar oculta sección de resultados ───────────────────────────────────

  it("botón Limpiar oculta la sección de resultados", async () => {
    mockUseQuery.mockReturnValue(emptyState);
    render(<TrazabilidadPage />);

    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => {
      expect(screen.getByText(/No se encontraron eventos/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(screen.queryByText(/No se encontraron eventos/i)).not.toBeInTheDocument();
  });

  // ── 7. Etiquetas de rango de fecha se renderizan ──────────────────────────────

  it("renderiza campos de rango de fecha 'Desde' y 'Hasta'", () => {
    render(<TrazabilidadPage />);

    expect(screen.getByLabelText("Desde")).toBeInTheDocument();
    expect(screen.getByLabelText("Hasta")).toBeInTheDocument();
  });
});

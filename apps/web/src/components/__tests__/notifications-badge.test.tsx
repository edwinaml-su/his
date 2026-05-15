/**
 * Beta.15 (US.B15.3.2) — Tests del NotificationsBadge.
 *
 * Verifica:
 *   - Funciones puras `formatBadgeCount` y `buildAriaLabel` (cap "99+",
 *     singular vs plural, aria sin notificaciones).
 *   - Render condicional del pill: count=0 oculto, count>0 visible.
 *   - Cap visual "99+" cuando count > 99.
 *
 * Patrón: mockeamos `@/lib/trpc/react` para devolver respuestas controladas
 * de `useQuery` sin tocar la red ni un QueryClient real.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock del módulo tRPC ANTES del import del componente. El factory devuelve
// un `useQuery` configurable via `setMockCount` (helper local) en cada test.
let mockCount = 0;
function setMockCount(n: number) {
  mockCount = n;
}
vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    notifications: {
      unreadCount: {
        useQuery: () => ({ data: { count: mockCount } }),
      },
    },
  },
}));

import {
  NotificationsBadge,
  formatBadgeCount,
  buildAriaLabel,
} from "../notifications-badge";

describe("formatBadgeCount", () => {
  it("muestra el número tal cual hasta 99", () => {
    expect(formatBadgeCount(0)).toBe("0");
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(5)).toBe("5");
    expect(formatBadgeCount(99)).toBe("99");
  });

  it("cap a '99+' cuando count > 99", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(120)).toBe("99+");
    expect(formatBadgeCount(9999)).toBe("99+");
  });
});

describe("buildAriaLabel", () => {
  it("formatea singular y plural correctamente", () => {
    expect(buildAriaLabel(0)).toBe("Sin notificaciones sin leer");
    expect(buildAriaLabel(1)).toBe("1 notificación sin leer");
    expect(buildAriaLabel(2)).toBe("2 notificaciones sin leer");
    expect(buildAriaLabel(5)).toBe("5 notificaciones sin leer");
  });
});

describe("<NotificationsBadge />", () => {
  beforeEach(() => {
    cleanup();
  });

  it("count=0 → solo icono, sin pill numérico", () => {
    setMockCount(0);
    render(<NotificationsBadge />);

    // El link siempre está. Aria-label refleja sin-notificaciones.
    const link = screen.getByRole("link", { name: "Sin notificaciones sin leer" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/notifications");

    // No hay pill cuando count=0.
    expect(screen.queryByTestId("notifications-badge-count")).not.toBeInTheDocument();
  });

  it("count=5 → muestra '5'", () => {
    setMockCount(5);
    render(<NotificationsBadge />);

    const link = screen.getByRole("link", { name: "5 notificaciones sin leer" });
    expect(link).toBeInTheDocument();

    const pill = screen.getByTestId("notifications-badge-count");
    expect(pill).toHaveTextContent("5");
  });

  it("count=120 → muestra '99+'", () => {
    setMockCount(120);
    render(<NotificationsBadge />);

    const pill = screen.getByTestId("notifications-badge-count");
    expect(pill).toHaveTextContent("99+");

    // aria-label conserva el conteo real (mejor para lector de pantalla).
    const link = screen.getByRole("link", { name: "120 notificaciones sin leer" });
    expect(link).toBeInTheDocument();
  });
});

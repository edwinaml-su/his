// @vitest-environment jsdom
/**
 * Beta.15 (US.B15.3.2) + CC-0031 Fase 2 — Tests del NotificationsBadge.
 *
 * Verifica:
 *   - Funciones puras `formatBadgeCount`, `buildAriaLabel`, `buildBreakdownLabel`.
 *   - El contador combina `notifications.unreadCount` + `workflowInbox.contadorBadge`
 *     (antes de CC-0031 la campana solo mostraba `unreadCount`, siempre 0 en
 *     prod — ver docs/audit/2026-09-15_cobertura/00-*.md §0/§13).
 *   - Render condicional del pill: total=0 oculto, total>0 visible.
 *   - Cap visual "99+" cuando total > 99.
 *   - El menú desplegable trae el desglose + links a /notifications y /tareas.
 *
 * Patrón: mockeamos `@/lib/trpc/react` para devolver respuestas controladas
 * de `useQuery` sin tocar la red ni un QueryClient real.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock del módulo tRPC ANTES del import del componente. Los factories
// devuelven respuestas configurables via los helpers locales `setMock*`.
let mockNotifCount = 0;
let mockTaskTotal = 0;
function setMockNotifCount(n: number) {
  mockNotifCount = n;
}
function setMockTaskTotal(n: number) {
  mockTaskTotal = n;
}
vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    notifications: {
      unreadCount: {
        useQuery: () => ({ data: { count: mockNotifCount } }),
      },
    },
    workflowInbox: {
      contadorBadge: {
        useQuery: () => ({ data: { total: mockTaskTotal, overdue: 0 } }),
      },
    },
  },
}));

import {
  NotificationsBadge,
  formatBadgeCount,
  buildAriaLabel,
  buildBreakdownLabel,
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

describe("buildBreakdownLabel", () => {
  it("combina notificaciones + tareas con singular/plural correcto", () => {
    expect(buildBreakdownLabel(0, 0)).toBe("0 notificaciones · 0 tareas de tu rol");
    expect(buildBreakdownLabel(1, 1)).toBe("1 notificación · 1 tarea de tu rol");
    expect(buildBreakdownLabel(3, 7)).toBe("3 notificaciones · 7 tareas de tu rol");
  });
});

describe("<NotificationsBadge />", () => {
  beforeEach(() => {
    cleanup();
    setMockNotifCount(0);
    setMockTaskTotal(0);
  });

  it("total=0 (ambas fuentes) → solo icono, sin pill numérico", () => {
    render(<NotificationsBadge />);

    const trigger = screen.getByRole("button", { name: "Sin notificaciones sin leer" });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByTestId("notifications-badge-count")).not.toBeInTheDocument();
  });

  it("suma notifications.unreadCount + workflowInbox.contadorBadge.total", () => {
    setMockNotifCount(2);
    setMockTaskTotal(3);
    render(<NotificationsBadge />);

    // 2 + 3 = 5
    const trigger = screen.getByRole("button", { name: "5 notificaciones sin leer" });
    expect(trigger).toBeInTheDocument();
    const pill = screen.getByTestId("notifications-badge-count");
    expect(pill).toHaveTextContent("5");
  });

  it("total=120 → muestra '99+' en el pill, aria-label conserva el conteo real", () => {
    setMockNotifCount(100);
    setMockTaskTotal(20);
    render(<NotificationsBadge />);

    const pill = screen.getByTestId("notifications-badge-count");
    expect(pill).toHaveTextContent("99+");
    const trigger = screen.getByRole("button", { name: "120 notificaciones sin leer" });
    expect(trigger).toBeInTheDocument();
  });

  it("el trigger expone el desglose (title) para notificaciones + tareas", () => {
    setMockNotifCount(2);
    setMockTaskTotal(3);
    render(<NotificationsBadge />);

    const trigger = screen.getByRole("button", { name: "5 notificaciones sin leer" });
    // El desglose vive en `title` (tooltip nativo) — el contenido del menú
    // (Radix Portal) solo se monta al abrir, que se cubre en QA E2E
    // (interacción real de puntero, ver nota de scope al final del archivo).
    expect(trigger).toHaveAttribute("title", "2 notificaciones · 3 tareas de tu rol");
  });
});

// NOTA @QA — cobertura E2E pendiente (Playwright, interacción de puntero real):
// abrir el menú (click en el trigger), verificar que aparecen los 2
// DropdownMenuItem ("Notificaciones (N)" → /notifications, "Mis tareas (M)"
// → /tareas) y que navegan correctamente. jsdom + Radix Portal no simula
// pointer capture de forma confiable sin `@testing-library/user-event`
// (no instalado en este workspace) — se dejó fuera de este PR para no
// introducir una dependencia nueva solo para un test.

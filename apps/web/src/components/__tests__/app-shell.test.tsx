// @vitest-environment jsdom
/**
 * DoD.2 (WCAG 2.4.1) — Tests del skip link en AppShell.
 *
 * Verifica:
 *   - Existe un enlace "Saltar al contenido principal" apuntando a #main-content.
 *   - El <main> tiene id="main-content" y tabIndex={-1}.
 *   - El link tiene clase sr-only (invisible por defecto).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// AppShell usa usePathname — mock mínimo para evitar error de contexto Next.js.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// next/link renderiza como <a> en jsdom con este mock.
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

import { AppShell } from "../app-shell";

describe("<AppShell /> — skip link WCAG 2.4.1", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renderiza el skip link apuntando a #main-content", () => {
    render(<AppShell>contenido</AppShell>);
    const link = screen.getByRole("link", {
      name: "Saltar al contenido principal",
    });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("el skip link tiene clase sr-only (invisible por defecto)", () => {
    render(<AppShell>contenido</AppShell>);
    const link = screen.getByRole("link", {
      name: "Saltar al contenido principal",
    });
    expect(link.className).toContain("sr-only");
  });

  it("el <main> tiene id='main-content' y tabIndex=-1", () => {
    render(<AppShell>contenido</AppShell>);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});

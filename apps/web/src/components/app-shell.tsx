"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Bed,
  Stethoscope,
  ClipboardList,
  Building2,
  Settings,
  History,
} from "lucide-react";
import { cn } from "@his/ui/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patients", label: "Pacientes", icon: Users },
  { href: "/admission", label: "Admisión", icon: ClipboardList },
  { href: "/beds", label: "Camas", icon: Bed },
  { href: "/triage", label: "Triage", icon: Stethoscope },
  { href: "/organizations", label: "Organizaciones", icon: Building2 },
  { href: "/users", label: "Usuarios", icon: Users },
  { href: "/audit", label: "Auditoría", icon: History },
  { href: "/catalogs/gender", label: "Catálogos", icon: Settings },
];

export function AppShell({
  children,
  topbar,
}: {
  children: React.ReactNode;
  topbar?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido principal
      </a>
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar-background md:flex md:flex-col">
        <div className="border-b p-4">
          <p className="text-base font-bold">HIS Avante</p>
          <p className="text-xs text-muted-foreground">El Salvador</p>
        </div>
        <nav className="flex-1 space-y-1 p-2" aria-label="Principal">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4">
          <div className="text-sm text-muted-foreground">{topbar}</div>
        </header>
        <main id="main-content" tabIndex={-1} className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

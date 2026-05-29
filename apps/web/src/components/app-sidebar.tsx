"use client";

/**
 * AppSidebar — navegación lateral desktop construida con primitivos Shadcn Sidebar.
 * Consume SECTIONS de nav-sections.ts (Tarea 2a) sin modificarlos.
 * Mobile Sheet sigue en app-shell.tsx (Tarea 2c).
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@his/ui/components/sidebar";
import { isItemVisible } from "./nav-visibility";
import { SECTIONS } from "./nav-sections";

interface AppSidebarProps {
  roleCodes: string[];
  assignedServiceUnitCodes: string[];
  isCrossServiceRole: boolean;
}

export function AppSidebar({
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
}: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/avante-logo.svg"
          alt="AVANTE Complejo Hospitalario"
          className="h-8 w-auto brightness-0 invert"
        />
      </SidebarHeader>

      <SidebarContent>
        {SECTIONS.map((section, idx) => {
          const visibleItems = section.items.filter((item) =>
            isItemVisible(item, roleCodes, assignedServiceUnitCodes, isCrossServiceRole),
          );
          if (visibleItems.length === 0) return null;
          return (
            <React.Fragment key={section.label}>
              {idx > 0 && <SidebarSeparator />}
              <SidebarGroup>
                <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive =
                        pathname === item.href ||
                        pathname.startsWith(item.href + "/");
                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            tooltip={item.label}
                          >
                            <Link
                              href={item.href}
                              aria-label={`${item.label} — ${item.description}`}
                            >
                              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                              <span className="truncate group-data-[state=collapsed]:hidden">
                                {item.label}
                              </span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </React.Fragment>
          );
        })}
      </SidebarContent>

      {/* Footer vacío — user menu permanece en top bar (Tarea 2c lo revisará) */}
      <SidebarFooter />
    </Sidebar>
  );
}

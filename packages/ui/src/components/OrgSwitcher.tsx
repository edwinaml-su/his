"use client";

import * as React from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./dropdown-menu";

export interface OrgOption {
  id: string;
  name: string;
  establishmentId?: string;
  establishmentName?: string;
}

interface OrgSwitcherProps {
  current: OrgOption | null;
  options: OrgOption[];
  onSwitch: (org: OrgOption) => void;
  className?: string;
}

/**
 * Selector de organización + establecimiento activo (TDR §5.2).
 * Muestra la org+sede actual y permite cambiarla.
 */
export function OrgSwitcher({ current, options, onSwitch, className }: OrgSwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-[260px] justify-between", className)}
          aria-label="Cambiar organización"
        >
          <span className="flex items-center gap-2 truncate">
            <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {current ? current.name : "Selecciona organización"}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[260px]" align="start">
        <DropdownMenuLabel>Organizaciones</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((opt) => {
          const isCurrent = current?.id === opt.id;
          return (
            <DropdownMenuItem
              key={opt.id}
              onSelect={() => onSwitch(opt)}
              className="flex items-center justify-between"
            >
              <span className="truncate">{opt.name}</span>
              {isCurrent && <Check className="h-4 w-4" aria-label="actual" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

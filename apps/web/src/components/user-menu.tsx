"use client";

/**
 * UserMenu — dropdown en el header con el nombre del usuario y acciones de
 * cuenta (Cerrar sesión, Preferencias).
 *
 * Antes de este componente, no existía un punto explícito de logout — solo
 * existía el auto-logout por idle (`idle-monitor.tsx`). UX gap evidente:
 * el usuario no podía cerrar sesión voluntariamente.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings, User as UserIcon, BellRing } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@his/ui/components/dropdown-menu";
import { Button } from "@his/ui/components/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface UserMenuProps {
  fullName: string;
  email?: string | null;
  noTenant?: boolean;
}

export function UserMenu({ fullName, email, noTenant }: UserMenuProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = React.useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch (err) {
      // Best-effort: incluso si Supabase falla (red), redirigimos al login;
      // el middleware se encarga de invalidar la cookie en el próximo fetch.
      console.error("[UserMenu] signOut error", err);
    }
    router.replace("/login");
    router.refresh();
  }

  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-2 sm:px-3"
          aria-label={`Menú de usuario de ${fullName}`}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
            aria-hidden
          >
            {initials || <UserIcon className="h-4 w-4" />}
          </span>
          <span className="hidden truncate text-sm font-medium sm:inline">
            {fullName}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate font-semibold">{fullName}</span>
          {email && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          )}
          {noTenant && (
            <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
              Sin organización asignada
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/notifications" className="cursor-pointer">
            <BellRing className="mr-2 h-4 w-4" aria-hidden />
            Preferencias de notificación
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/feedback" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" aria-hidden />
            Mi feedback (NPS)
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          disabled={signingOut}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden />
          {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

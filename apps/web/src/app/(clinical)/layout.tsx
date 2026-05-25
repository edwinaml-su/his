import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NotificationsBadge } from "@/components/notifications-badge";
import { OrgRoleSwitcher } from "@/components/org-role-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { PerfTracker } from "@/components/perf-tracker";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

export default async function ClinicalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();

  return (
    <AppShell
      topbar={
        <div className="flex w-full items-center justify-between gap-2 sm:gap-4">
          <span className="hidden truncate text-sm sm:inline">
            <span className="font-medium text-foreground">{user.fullName}</span>
            {!tenant && (
              <span className="ml-2 text-muted-foreground">— sin organización asignada</span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {tenant ? <NotificationsBadge /> : null}
            {tenant ? <OrgRoleSwitcher /> : null}
            <ThemeToggle />
          </div>
        </div>
      }
    >
      {children}
      <PerfTracker />
    </AppShell>
  );
}

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NotificationsBadge } from "@/components/notifications-badge";
import { OrgRoleSwitcher } from "@/components/org-role-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { DensityToggle } from "@/components/density-toggle";
import { UserMenu } from "@/components/user-menu";
import { PerfTracker } from "@/components/perf-tracker";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

export default async function ClinicalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();

  return (
    <AppShell
      roleCodes={tenant?.roleCodes ?? []}
      assignedServiceUnitCodes={tenant?.assignedServiceUnitCodes ?? []}
      isCrossServiceRole={tenant?.isCrossServiceRole ?? false}
      chatAuth={{
        userId: user.id,
        organizationId: tenant?.organizationId,
      }}
      topbar={
        <div className="flex w-full items-center justify-end gap-1 sm:gap-2">
          {tenant ? <NotificationsBadge /> : null}
          {tenant ? <OrgRoleSwitcher /> : null}
          <DensityToggle />
          <ThemeToggle />
          <UserMenu
            fullName={user.fullName}
            email={user.email}
            noTenant={!tenant}
          />
        </div>
      }
    >
      {children}
      <PerfTracker />
    </AppShell>
  );
}

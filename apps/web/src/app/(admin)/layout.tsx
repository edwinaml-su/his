import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NotificationsBadge } from "@/components/notifications-badge";
import { OrgRoleSwitcher } from "@/components/org-role-switcher";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();

  return (
    <AppShell
      roleCodes={tenant?.roleCodes ?? []}
      topbar={
        <div className="flex w-full items-center justify-between gap-4">
          <span className="truncate text-sm">
            <span className="font-medium text-foreground">{user.fullName}</span>
            {!tenant && (
              <span className="ml-2 text-muted-foreground">— sin organización asignada</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {tenant ? <NotificationsBadge /> : null}
            {tenant ? <OrgRoleSwitcher /> : null}
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

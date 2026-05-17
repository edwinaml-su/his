import { redirect } from "next/navigation";
import { prisma } from "@his/database";
import { AppShell } from "@/components/app-shell";
import { NotificationsBadge } from "@/components/notifications-badge";
import { OrgSwitcherClient } from "@/components/org-switcher-client";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();

  // Trade name de la org actual para mostrarlo en el topbar.
  const orgName = tenant
    ? (
        await prisma.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { tradeName: true, legalName: true },
        })
      )?.tradeName ?? null
    : null;

  return (
    <AppShell
      roleCodes={tenant?.roleCodes ?? []}
      topbar={
        <div className="flex w-full items-center justify-between gap-4">
          <span className="truncate">
            <span className="font-medium text-foreground">{user.fullName}</span>
            {tenant && orgName ? (
              <>
                <span className="px-2">·</span>
                <span className="text-foreground">{orgName}</span>
                {tenant.roleCodes.length > 0 ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({tenant.roleCodes.join(", ")})
                  </span>
                ) : null}
              </>
            ) : (
              <span className="ml-2">— sin organización asignada</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {tenant ? <NotificationsBadge /> : null}
            {tenant ? <OrgSwitcherClient currentOrgId={tenant.organizationId} /> : null}
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

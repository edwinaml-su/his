import { redirect } from "next/navigation";
import { prisma } from "@his/database";
import { AppShell } from "@/components/app-shell";
import { OrgSwitcherClient } from "@/components/org-switcher-client";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

export default async function ClinicalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();

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
          {tenant ? <OrgSwitcherClient currentOrgId={tenant.organizationId} /> : null}
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

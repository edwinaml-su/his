import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

export default async function ClinicalLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();
  return (
    <AppShell
      topbar={
        <span>
          <span className="font-medium text-foreground">{user.fullName}</span>
          {tenant ? <span className="px-2">·</span> : null}
          {tenant ? <span>Roles: {tenant.roleCodes.join(", ")}</span> : null}
        </span>
      }
    >
      {children}
    </AppShell>
  );
}

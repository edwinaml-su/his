import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getTenantContext();

  return (
    <AppShell
      topbar={
        tenant ? (
          <span>
            <span className="font-medium text-foreground">{user.fullName}</span>
            <span className="px-2">·</span>
            <span>Org: {tenant.organizationId.slice(0, 8)}…</span>
          </span>
        ) : (
          <span>Sin organización asignada — contacta al administrador.</span>
        )
      }
    >
      {children}
    </AppShell>
  );
}

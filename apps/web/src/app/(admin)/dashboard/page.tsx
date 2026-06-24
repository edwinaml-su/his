import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { getCurrentUser, getTenantContext } from "@/lib/auth/session";
import { KioskAutoRedirect } from "@/components/kiosk-auto-redirect";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const tenant = await getTenantContext();
  return (
    <div className="space-y-6">
      {/* En tablets/kioskos redirige al modo kiosko full-screen (no-op en desktop). */}
      <KioskAutoRedirect />
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Bienvenido/a, {user?.fullName ?? "usuario"}.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Tu organización</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {tenant ? (
              <>
                <p>Org ID: <span className="font-mono">{tenant.organizationId}</span></p>
                <p>País: <span className="font-mono">{tenant.countryId}</span></p>
                <p className="mt-2">Roles: {tenant.roleCodes.join(", ") || "—"}</p>
              </>
            ) : (
              <p>Sin organización asignada.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Atajos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <a className="block text-primary underline-offset-4 hover:underline" href="/patients">Buscar paciente</a>
            <a className="block text-primary underline-offset-4 hover:underline" href="/admission">Nueva admisión</a>
            <a className="block text-primary underline-offset-4 hover:underline" href="/triage">Cola de triage</a>
            <a className="block text-primary underline-offset-4 hover:underline" href="/beds">Mapa de camas</a>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Estado del sistema</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            MVP en desarrollo — algunas vistas son stubs marcadas con TODO.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

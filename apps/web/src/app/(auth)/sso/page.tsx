"use client";

/**
 * US-2.5 — Página de inicio SSO (selector de proveedor).
 *
 * MVP STUB. Lista proveedores configurados (mock) y, al hacer click, llama
 * al Server Action `initiateSsoLogin` que en MVP retorna NOT_CONFIGURED.
 * Mostramos un dialog explicando que SSO se activa en Sprint 2.
 *
 * Diseño UX:
 *   - Vista 1 (default): input email — autorouting si dominio matchea provider.
 *   - Vista 2: lista de botones por provider configurado (fallback).
 *   - Click en provider => Server Action => modal explicativo.
 *
 * NO usa /login del flujo principal: ese form ya está cerrado (auth lockup
 * hecho por otro equipo). Esta página es ENTRADA ALTERNA a SSO únicamente.
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Alert, AlertDescription } from "@his/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import {
  initiateSsoLogin,
  listSsoProvidersForLogin,
  resolveProviderByEmail,
} from "@/app/actions/sso";
import type { SsoProvider } from "@his/contracts/schemas/sso";

interface ProviderRow {
  id: string;
  provider: SsoProvider;
  displayName: string;
  organizationDomain?: string;
}

/**
 * Mapping a iconos / labels por provider. En vez de imágenes, usamos texto
 * para no añadir assets nuevos al MVP.
 */
const PROVIDER_LABELS: Record<SsoProvider, { short: string; tagline: string }> = {
  GOOGLE_WORKSPACE: { short: "Google", tagline: "Iniciar con Google Workspace" },
  AZURE_AD: { short: "Microsoft", tagline: "Iniciar con Microsoft 365" },
  WORKOS: { short: "WorkOS", tagline: "Iniciar con SSO Empresarial (SAML)" },
  AUTH0: { short: "Auth0", tagline: "Iniciar con Auth0" },
};

export default function SsoPage() {
  const [email, setEmail] = React.useState("");
  const [providers, setProviders] = React.useState<ProviderRow[]>([]);
  const [loadingProviders, setLoadingProviders] = React.useState(true);
  const [busyProviderId, setBusyProviderId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<{
    title: string;
    message: string;
  } | null>(null);

  // Cargar listado al montar.
  React.useEffect(() => {
    let cancelled = false;
    listSsoProvidersForLogin()
      .then((rows) => {
        if (cancelled) return;
        setProviders(
          rows.map((r) => ({
            id: r.id ?? "",
            provider: r.provider,
            displayName: r.displayName,
            organizationDomain: r.organizationDomain,
          })),
        );
      })
      .catch(() => {
        // Best-effort. Si falla, lista queda vacía y ofrecemos volver a /login.
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEmailContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const match = await resolveProviderByEmail(email);
    if (!match || !match.id) {
      setDialog({
        title: "Dominio no configurado",
        message:
          `No encontramos un proveedor SSO para el dominio "${email.split("@")[1] ?? ""}". ` +
          "Contacta al admin de tu organización o usa login con email + contraseña.",
      });
      return;
    }
    await triggerLogin(match.id, match.provider);
  };

  const triggerLogin = async (providerId: string, provider: SsoProvider) => {
    setBusyProviderId(providerId);
    try {
      const res = await initiateSsoLogin({
        provider,
        providerId,
        redirectTo: "/dashboard",
      });

      if (res.ok) {
        // Sprint 2: redirect al IdP.
        window.location.href = res.redirectUrl;
        return;
      }

      // MVP path: siempre cae aquí (NOT_CONFIGURED).
      setDialog({
        title: "SSO en preparación",
        message: res.message,
      });
    } catch (err) {
      setDialog({
        title: "Error inesperado",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo iniciar el flujo SSO. Intenta de nuevo o usa login estándar.",
      });
    } finally {
      setBusyProviderId(null);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Iniciar sesión con SSO</CardTitle>
          <CardDescription>
            Accede usando la cuenta corporativa de tu organización.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Vista email — autorouting */}
          <form onSubmit={handleEmailContinue} className="space-y-3">
            <Label htmlFor="sso-email">Correo corporativo</Label>
            <Input
              id="sso-email"
              type="email"
              placeholder="usuario@hospital.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <Button type="submit" className="w-full" disabled={!email}>
              Continuar
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">o elige proveedor</span>
            </div>
          </div>

          {/* Lista de providers */}
          {loadingProviders ? (
            <p className="text-sm text-muted-foreground text-center">Cargando proveedores...</p>
          ) : providers.length === 0 ? (
            <Alert>
              <AlertDescription>
                No hay proveedores SSO configurados para esta instancia.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => {
                const label = PROVIDER_LABELS[p.provider];
                const busy = busyProviderId === p.id;
                return (
                  <Button
                    key={p.id}
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => triggerLogin(p.id, p.provider)}
                    disabled={busy}
                  >
                    <span className="font-medium">{label.short}</span>
                    <span className="ml-2 truncate text-muted-foreground">
                      — {p.displayName}
                    </span>
                    {busy ? <span className="ml-auto text-xs">...</span> : null}
                  </Button>
                );
              })}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Volver a login con contraseña
          </Link>
        </CardFooter>
      </Card>

      <Dialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.title}</DialogTitle>
            <DialogDescription>{dialog?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setDialog(null)}>Entendido</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
